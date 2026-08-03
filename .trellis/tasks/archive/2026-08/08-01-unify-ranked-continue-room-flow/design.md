# design: unify-ranked-continue-room-flow

> 本文档中的代码块均为示意伪代码，用于表达数据流和函数边界，不是最终实现——具体命名、错误码、辅助函数以 `implement.md` 落地实现时的实际代码为准。

## 1. Architecture Overview

排位赛结算后的"继续/返回"从两条分叉的代码路径（solo 直接 `queue()` / team 返回 `originRoomCode` 房间）收敛成一条统一路径：**acknowledge → 同步解锁房间 → 解析/新建房间 → （可选）自动准备与自动开局**。单人和组队排位在这条路径上完全共用同一套函数，区别只体现在两个布尔开关：`autoReady`、`autoStart`（仅房主生效）。

```
RoundSettlementModal (onContinue / onLeave / 10s timeout)
        │
        ▼
continueOrReturnToRoom(matchId, { autoReady, autoStartIfOwner })   // room/index.tsx，新的统一函数
        │  1. competitiveApi.acknowledge(matchId)  → 服务端同步解锁房间（见 §2）
        │  2. roomApi.get(originRoomCode) 或 roomApi.create(...) 兜底
        │  3. autoReady ? roomApi.setReady(true) : 不操作
        │  4. autoStartIfOwner && room.isOwner ? roomCtrl.startTeamMatchmaking() 静默失败 : 不操作
        ▼
Taro.reLaunch("/pages/room/index")
```

## 2. 房间同步解锁（服务端）

**现状**：`reconcileTeamMatchQueues()`（`room-service.ts:1600-1620`）遍历所有房间，每个房间检查 `currentTeamCompetitiveMatch(room) === null` 才清空 `readySessionIds`/`teamQueueStartedAt`，由 `matchmakingTimer` 每秒调用一次（`index.ts` 附近 1021-1023）。

**改动**：把单房间的解锁判定抽成独立方法：

```ts
// room-service.ts
private reconcileTeamMatchQueueForRoom(room: RoomState): boolean {
  if (
    room.status !== "ACTIVE" ||
    room.mode !== "TEAM_MATCH" ||
    room.teamQueueStartedAt === null ||
    this.database.listMatchmakingPartyEntries(room.id).length > 0 ||
    this.currentTeamCompetitiveMatch(room) !== null
  ) {
    return false;
  }
  room.readySessionIds = [];
  room.teamQueueStartedAt = null;
  room.waitingExpiresAt = new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString();
  room.version += 1;
  this.save(room);
  return true;
}

reconcileTeamMatchQueues(): RoomState[] {
  const changed: RoomState[] = [];
  for (const room of this.roomsByCode.values()) {
    if (this.reconcileTeamMatchQueueForRoom(room)) changed.push(room);
  }
  return changed;
}
```

`acknowledge` 路由（`index.ts:624-638`）在 `matchmaking.acknowledgeResult()` 成功后，查出这次被确认的比赛的 `partyId`（`database.getCompetitiveMatchPlayer(matchId, sessionId)?.partyId`），如果非空且对应房间存在，调用 `rooms.reconcileTeamMatchQueueForRoom(room)`；若返回 `true`（房间被解锁），照常 `sockets.to(room.id).emit("room:update", ...)` 推送最新版本，让其他仍在房间里的成员也能立即感知解锁（不必等他们自己的下一次轮询）。

后台每秒的 `reconcileTeamMatchQueues()` 保留不变，作为非 acknowledge 触发场景（例如成员直接 `leaveRoom` 导致 `currentTeamCompetitiveMatch` 变为 null）的兜底。

## 3. 统一续局/返回函数（客户端）

`apps/miniprogram/src/pages/room/index.tsx` 里 `continueCompetitiveMatch()` / `returnFromCompetitiveMatch()` 合并重写为一个内部函数：

```ts
async function settleAndReturnToRoom(
  matchId: string,
  options: { autoReady: boolean; autoStartIfOwner: boolean },
): Promise<void> {
  try {
    Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
    await competitiveApi.acknowledge(matchId);
    const originRoomCode =
      room?.competitiveMatch?.originRoomCode ??
      roomCtrl.lastSettlement?.competitiveMatch.originRoomCode ??
      null;
    const targetRoom =
      originRoomCode !== null
        ? await roomApi.get(originRoomCode).catch(() => null)
        : null;
    const nextRoom =
      targetRoom ??
      (await roomApi.create(identity.nickname, DEFAULT_BASE_SCORE, "TEAM_MATCH", 20, "LOW"));
    roomCtrl.clearLastSettlement();
    Taro.setStorageSync("huanghuang_open_room", nextRoom);
    await Taro.reLaunch({ url: "/pages/room/index" });
    if (options.autoReady && !nextRoom.isOwner) {
      void roomApi.setReady(nextRoom.code, true).catch(() => {});
    }
    if (options.autoStartIfOwner && nextRoom.isOwner) {
      void roomApi
        .startTeamMatchmaking(nextRoom.code, getStoredMatchmakingAllowBots())
        .catch(() => {});
    }
  } catch {
    await Taro.showToast({ title: "操作失败，请重试", icon: "none" });
  }
}
```

- 房主的"已准备"是隐式的（`prepareTeamMatch` 只检查非房主成员），所以 `autoReady` 对房主是 no-op，只对非房主成员调用 `setReady`。
- `autoStartIfOwner` 的调用失败（`NOT_ALL_READY` / `ACTION_NOT_AVAILABLE`）被吞掉，不弹 toast——这是"尽力而为"的自动续局，失败就回落到正常的房间等待界面。
- 新建房间的兜底调用与首页 `startTeamRanked()` 用的是同一个 `roomApi.create(..., "TEAM_MATCH", ...)`，保证单人/组队入口与续局兜底路径完全一致。

两个按钮变成：

```ts
onContinue={() => void settleAndReturnToRoom(matchId, { autoReady: true, autoStartIfOwner: true })}
onLeave={() => void settleAndReturnToRoom(matchId, { autoReady: false, autoStartIfOwner: false })}
```

旧的 `competitiveApi.queue({ previousMatchId, allowBots })` 直接重新入队分支整体移除——它现在没有正常触发路径（所有比赛都带 `originRoomCode`），保留只会增加认知负担。`allowBots` 存储读取（`getStoredMatchmakingAllowBots()`）在 `autoStartIfOwner` 分支里继续复用。

## 4. 结算页 10 秒自动兜底

`RoundSettlementModal` 保持是无状态展示组件不变；计时器放在调用方（`room/index.tsx` 渲染 `RoundSettlementModal` 的地方）：

```ts
useEffect(() => {
  if (room?.roundSettlement === null || room?.mode !== "MATCH") return;
  const matchId = room.competitiveMatch?.matchId;
  if (matchId === undefined) return;
  const timer = setTimeout(() => {
    void settleAndReturnToRoom(matchId, { autoReady: false, autoStartIfOwner: false });
  }, 10_000);
  return () => clearTimeout(timer);
}, [room?.roundSettlement, room?.competitiveMatch?.matchId]);
```

计时器依赖 `roundSettlement`/`matchId`，一旦玩家手动点击任一按钮触发 `reLaunch`，组件卸载，`clearTimeout` 自然生效，不需要额外的"是否已操作"标记。

## 5. 房主踢人（新增）

### 服务端

`room-service.ts` 新增：

```ts
kickMember(hostSessionId: string, code: string, targetSessionId: string): RoomActionResult | "FORBIDDEN" | "NOT_A_MEMBER" | "ACTION_NOT_AVAILABLE" {
  const room = this.roomsByCode.get(code);
  if (room?.status !== "ACTIVE") return null;
  if (room.mode !== "TEAM_MATCH") return "ACTION_NOT_AVAILABLE";
  if (room.ownerSessionId !== hostSessionId) return "FORBIDDEN";
  if (targetSessionId === hostSessionId) return "ACTION_NOT_AVAILABLE";
  if (room.teamQueueStartedAt !== null || this.database.listMatchmakingPartyEntries(room.id).length > 0) {
    return "ACTION_NOT_AVAILABLE"; // 排队/匹配中不可踢人
  }
  if (!humanSessionIds(room).includes(targetSessionId)) return "NOT_A_MEMBER";
  // 复用 leaveRoom 的座位释放/广播逻辑，target 视角触发
  return this.leaveRoom(targetSessionId, code);
}
```

`index.ts` 新增路由，参考 `/dissolve` 的鉴权/响应风格：

```ts
app.post<{ Params: { code: string }; Body: { targetSessionId: string } }>(
  "/api/rooms/:code/kick",
  (request, reply) => {
    const session = sessions.resolve(request);
    if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = kickMemberInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
    const result = rooms.kickMember(session.id, request.params.code, parsed.data.targetSessionId);
    if (result === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    if (result === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
    if (result === "NOT_A_MEMBER") return reply.code(404).send({ error: "NOT_A_MEMBER" });
    if (result === "ACTION_NOT_AVAILABLE") return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
    sockets.to(result.id).emit("room:update", { version: result.version });
    return rooms.project(result, session.id);
  },
);
```

`kickMemberInputSchema`（`packages/protocol`）新增一个简单 schema：`{ targetSessionId: string }`。

### 客户端

- `apps/miniprogram/src/api/http.ts` 的 `roomApi` 新增 `kick(code, targetSessionId)`。
- `room/index.tsx` 房间成员列表里，仅 `room.isOwner && room.mode === "TEAM_MATCH" && !teamQueued && !teamMatched` 时，非房主座位旁渲染"踢出"按钮；点击弹 `Taro.showModal` 二次确认，确认后调用 `roomCtrl.kick(seat.sessionId)`。

## 6. 数据流 / 时序图（组队续局，房主视角）

```
房主点击"继续游戏"
  → POST /acknowledge            (服务端: 标记 acknowledged_at, 同步检查+解锁房间, 广播 room:update)
  → GET /rooms/:originCode       (拿到已解锁的房间投影: readySessionIds=[], teamQueueStartedAt=null)
  → reLaunch 进房间
  → POST /rooms/:code/team-matchmaking   (autoStartIfOwner, 若队友未准备 → 409 NOT_ALL_READY, 静默忽略)
```

若队友也点了"继续游戏"（`autoReady`），他们的 `POST /rooms/:code/ready` 请求会与房主的自动开局请求并发——即便房主的自动开局请求先到达失败，房间的 `room:update` 广播（ready 变化 + 后续队友的 ready 广播）会让房主客户端的房间页面重新渲染出"开始匹配"可点状态，房主需要再手动点一次（这是可接受的：不为"多人同时点继续"做自动重试开局，避免复杂的竞态处理）。

## 7. 测试策略

- `room-service.test.ts` 新增：
  - `reconcileTeamMatchQueueForRoom` 单房间同步解锁的单测（替换/补充现有依赖 tick 的测试）
  - `kickMember`：房主踢人成功、非房主踢人 403、踢自己 409、排队中踢人 409、目标不是成员 404
- 更新 `apps/server/src/room-service.test.ts:1786` 那个"solo 没有 originRoomCode"的测试fixture：改为通过 `enqueueParty`（而不是裸 `upsertMatchmakingEntry`）构造 solo 场景，使其反映当前真实入口路径（solo 也有 originRoomCode）；不再断言 `soloProjection.competitiveMatch?.originRoomCode` 为 null。
- 前端 `continueCompetitiveMatch`/`settleAndReturnToRoom` 目前没有单元测试基础设施（纯 Taro 页面函数），本次不新增前端自动化测试，依赖手工验证（单人、房主组队、非房主组队、原房间已解散、10 秒兜底、踢人各跑一遍）。

## 8. 回滚

本次改动都在现有房间/比赛模型上做行为调整，不涉及数据库 schema 变更，回滚只需 revert 代码提交、重新部署即可，无需数据迁移回退。
