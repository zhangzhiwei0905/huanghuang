# implement: unify-ranked-continue-room-flow

执行顺序：服务端能力先行（同步解锁、踢人接口）→ 客户端统一续局函数 → 客户端 10 秒兜底 → 回归测试与手工验证。每一步完成后跑一次对应验证命令，全部通过再进入下一步。

## Step 1 — 房间同步解锁（服务端）

- [x] `apps/server/src/room-service.ts`：把 `reconcileTeamMatchQueues()` 内部单房间判定逻辑抽成 `reconcileTeamMatchQueueForRoom(room: RoomState): boolean`（私有方法），`reconcileTeamMatchQueues()` 改为遍历调用它
- [x] `apps/server/src/index.ts`：`/api/competitive/matches/:matchId/acknowledge` 路由里，`matchmaking.acknowledgeResult()` 成功后：
  - 用 `database.getCompetitiveMatchPlayer(matchId, session.id)?.partyId` 找到关联房间
  - 房间存在且 `mode === "TEAM_MATCH"` 时调用 `rooms.reconcileTeamMatchQueueForRoom(room)`
  - 若返回 `true`，广播 `sockets.to(room.id).emit("room:update", { version: room.version })`
- [x] 单测（`room-service.test.ts`）：模拟一个组队房间两名成员都 acknowledge 后，直接（不调用 `tick`/`reconcileTeamMatchQueues`）断言房间 `readySessionIds === []` 且 `teamQueueStartedAt === null`
- [x] 验证：`npx vitest run apps/server/src/room-service.test.ts`

## Step 2 — 房主踢人接口（服务端）

- [x] `packages/protocol`：新增 `kickMemberInputSchema`（**按座位 `{ targetSeat: Seat }` 落地**，原因见 error-handling.md：投影不透出 sessionId，sessionId 即承载凭证）
- [x] `apps/server/src/room-service.ts`：新增 `kickMember(hostSessionId, code, targetSeat)`，复用 `leaveRoom` 的座位释放逻辑，按 design.md §5 的分支返回 `null | "FORBIDDEN" | "NOT_A_MEMBER" | "ACTION_NOT_AVAILABLE" | RoomState`
- [x] `apps/server/src/index.ts`：新增 `POST /api/rooms/:code/kick` 路由，参考 `/dissolve` 路由的鉴权/响应风格
- [x] 单测（`room-service.test.ts`）：房主踢人成功、非房主踢人 403、踢自己 409、排队/匹配中踢人 409、目标非成员 404
- [x] 验证：`npx vitest run apps/server/src/room-service.test.ts`

## Step 3 — 统一续局/返回函数（客户端）

- [x] `apps/miniprogram/src/api/http.ts`：`roomApi` 新增 `kick(roomCode, targetSeat)`
- [x] `apps/miniprogram/src/pages/room/index.tsx`：
  - 新增 `settleAndReturnToRoom(matchId, { autoReady, autoStartIfOwner })`，按 design.md §3 实现（acknowledge → 解析/新建原房间 → autoReady → autoStartIfOwner，静默吞掉自动开局失败）
  - 删除旧的 `competitiveApi.queue({ previousMatchId, allowBots })` 直接重新入队分支（不再有正常触发路径）
  - `continueCompetitiveMatch()`/`returnFromCompetitiveMatch()` 改为调用 `settleAndReturnToRoom(matchId, { autoReady: true, autoStartIfOwner: true })` / `settleAndReturnToRoom(matchId, { autoReady: false, autoStartIfOwner: false })`
  - 同步更新第 793/800 行左右"空壳结算页"（`room === null` 场景）里对这两个函数的调用点
- [x] `apps/server/src/room-service.test.ts` 那条"solo 没有 originRoomCode"测试：改成通过 `enqueueParty`（party size 1）构造 solo fixture，断言 `originRoomCode` 非 null，反映当前真实入口路径
- [x] 验证：`cd apps/miniprogram && npm run typecheck`；`npx vitest run apps/server/src/room-service.test.ts`

## Step 4 — 结算页 10 秒自动兜底（客户端）

- [x] `apps/miniprogram/src/pages/room/index.tsx`：按 design.md §4 加计时器 effect，10 秒无操作调用 `settleAndReturnToRoom(matchId, { autoReady: false, autoStartIfOwner: false })`
- [x] 验证：`cd apps/miniprogram && npm run typecheck`

## Step 5 — 房主踢人 UI（客户端）

- [x] `apps/miniprogram/src/pages/room/index.tsx`：房间成员列表中，`room.isOwner && room.mode === "TEAM_MATCH" && !teamQueued && !teamMatched` 时给非房主座位加"踢出"按钮
- [x] 二次确认：`Taro.showModal` 确认后调用 `roomCtrl.kick(seat.seat)`
- [x] 验证：`cd apps/miniprogram && npm run typecheck`

## Step 6 — 全量回归与手工验证

- [x] `npx vitest run`（全量后端测试：44 文件 / 450 用例全过）
- [x] `cd apps/miniprogram && npm run typecheck`
- [x] `cd apps/miniprogram && npm run build:weapp`（确认编译通过）——trellis-check 复跑时本次沙箱环境下 Webpack 编译成功（3.11s，仅有预期外的 `pages/room/index.js` 体积告警，与本次改动无关），此前报告的 Rust 原生组件 panic 未复现
- [ ] 手工验证清单（记录到 check.jsonl 或本文件勾选）：
  - [ ] 单人排位：结算页点"继续游戏" → 自动回房间、自动准备、自动开局成功，无需额外点击
  - [ ] 组队排位房主：点"继续游戏"、队友未准备 → 回房间显示"等待好友准备"，无报错
  - [ ] 组队排位非房主：点"继续游戏" → 回房间且已自动准备；点"返回房间" → 回房间且未准备
  - [ ] 原房间已解散场景：两按钮均能自动新建房间进入，不报错
  - [ ] 结算页静置 10 秒 → 自动回到房间（未准备状态）
  - [ ] 房主踢出空闲成员 → 被踢者本地/下次交互提示非成员；排队中尝试踢人被拒绝
  - [ ] 人机对战（BOT）结算页"退出到主页/继续游戏"行为与改动前一致

## Review Gate

全部 Step 完成、全量测试通过、手工验证清单勾完后，进入 Trellis Phase 3（spec 更新 + commit），并同步更新 `08-01-ranked-continue-stuck-on-settlement`（已归档任务）的关联说明。
