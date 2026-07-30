# Design: 硬来由/软来由成就 + 历史战绩查看

## R1: 成就

### Protocol (`packages/protocol/src/competitive.ts`)
- `competitiveAchievementActionSchema`: 追加 `"HARD_LAIYOU"`, `"SOFT_LAIYOU"`。
- `competitiveAchievementTotalsSchema`: 追加 `hardLaiyou`, `softLaiyou`（`z.number().int().nonnegative()`）。

### Server 数据层 (`apps/server/src/database.ts`)
- `CompetitiveAchievementAction` 类型追加两个字面量。
- `CompetitiveProfileRow` / `PublicCompetitiveProfileRow` 追加 `hardLaiyouCount`, `softLaiyouCount`。
- schema 初始化 additive-columns 数组（第 426-434 行）追加：
  ```
  "ALTER TABLE competitive_profiles ADD COLUMN hard_laiyou_count INTEGER NOT NULL DEFAULT 0 CHECK (hard_laiyou_count >= 0)",
  "ALTER TABLE competitive_profiles ADD COLUMN soft_laiyou_count INTEGER NOT NULL DEFAULT 0 CHECK (soft_laiyou_count >= 0)",
  ```
- `competitive_action_events` 表的 `action` 列有 CHECK 约束（建表时写死），不能用 ALTER TABLE 加新枚举值。复用现有 `migrateCompetitiveActionEventsCheckConstraint()`（第 489-530 行）的 rename→recreate→copy→drop 套路：
  - 判定条件从 `existing.sql.includes("RELEASE_WILDCARD")` 改成 `existing.sql.includes("HARD_LAIYOU")`（新目标态标记），这样同时覆盖"从未跑过任何迁移的老库"和"已有 RELEASE_WILDCARD 但没有 HARD_LAIYOU 的库"两种情况。
  - CREATE TABLE 的 CHECK 列表新增 `'HARD_LAIYOU', 'SOFT_LAIYOU'`。
  - 中间表名从 `competitive_action_events_pre_release_wildcard` 改为 `competitive_action_events_pre_laiyou`（避免和已跑过一次迁移又重新触发的历史中间表重名；由于该表用完即 DROP，重名风险仅限同一次迁移内，不影响正确性，但换个名字更清楚）。
- `GameDatabase.COMPETITIVE_PROFILE_COLUMNS` / `PUBLIC_COMPETITIVE_PROFILE_COLUMNS`（第 567-587 行）追加两列的 `AS` 别名。
- `recordCompetitiveAchievement()` 里的 `counterColumn` map（第 1858-1864 行）追加：
  ```
  HARD_LAIYOU: "hard_laiyou_count",
  SOFT_LAIYOU: "soft_laiyou_count",
  ```

### Server 房间逻辑 (`apps/server/src/room-service.ts`)
- `competitiveAchievementAction()`（第 345-359 行）的 `switch` 里，`"WIN"` 从直接 `return null` 改成：
  ```ts
  case "WIN":
    return null; // 占位，真正判断挪到调用方，因为需要 laiyou/winType
  ```
  实际上 `GameEffectAction` 只是 `Meld["kind"] | "RELEASE_WILDCARD" | "WIN"`，不带 `laiyou`/`winType`，这些字段在 `EffectDescriptor` 上（第 380-383 行）。因此 `competitiveAchievementAction()` 签名需要改为接收整个 `EffectDescriptor`（或额外传 `laiyou`/`winType`），而不是只传 `action: GameEffectAction`。改造：
  ```ts
  function competitiveAchievementAction(
    descriptor: Pick<EffectDescriptor, "action" | "winType" | "laiyou">,
  ): CompetitiveAchievementAction | null {
    switch (descriptor.action) {
      case "EXPOSED_KONG":
      case "INDICATOR_PONG_KONG":
      case "ADDED_KONG":
      case "CONCEALED_KONG":
      case "RELEASE_WILDCARD":
        return descriptor.action;
      case "WIN":
        if (!descriptor.laiyou) return null;
        return descriptor.winType === "HARD" ? "HARD_LAIYOU" : "SOFT_LAIYOU";
      case "PONG":
        return null;
    }
  }
  ```
  调用点 `competitiveAchievementEvent()`（第 846-866 行）第 855 行 `competitiveAchievementAction(descriptor.action)` 改成 `competitiveAchievementAction(descriptor)`。

### Server 只读投影 (`matchmaking-service.ts:82-88`, `social-service.ts:38-46`, `room-service.ts:302-310`)
- 三处 `achievements: {...}` 字面量都追加：
  ```ts
  hardLaiyou: profile.hardLaiyouCount,
  softLaiyou: profile.softLaiyouCount,
  ```

### 小程序 (`apps/miniprogram/src/components/PlayerProfileModal.tsx:108-129`)
- `profile-modal__achievements` 区块追加两个条目（放在"放赖"之后，因为逻辑上是放赖的后续事件）：
  ```tsx
  <View>
    <Text>硬来由</Text>
    <Text>{competitiveProfile.achievements.hardLaiyou}</Text>
  </View>
  <View>
    <Text>软来由</Text>
    <Text>{competitiveProfile.achievements.softLaiyou}</Text>
  </View>
  ```

## R2: 历史战绩

### 数据来源与查询 (`apps/server/src/database.ts`)
新增只读方法（不改任何写路径）：
```ts
export type CompetitiveMatchHistoryEntry = {
  matchId: string;
  settledAt: string;
  outcome: "WIN" | "LOSS" | "DRAW";
  multiplier: CompetitiveMultiplier | null;
  preRankLevel: number;
  postRankLevel: number;
  finalRankDelta: number;
};

listCompetitiveMatchHistory(
  sessionId: string,
  options: { limit: number; beforeMatchId?: string },
): CompetitiveMatchHistoryEntry[]
```
- SQL: `SELECT ... FROM competitive_match_players p JOIN competitive_matches m ON m.id = p.match_id WHERE p.session_id = ? AND m.status = 'SETTLED' [AND m.settled_at < (SELECT settled_at FROM competitive_matches WHERE id = ?)] ORDER BY m.settled_at DESC LIMIT ?`。
- `outcome` 推导（不新增列，直接用已有列）：`multiplier IS NULL → 'DRAW'`；否则 `final_rank_delta > 0 → 'WIN'`，`final_rank_delta <= 0 → 'LOSS'`（见 prd.md 的 Confirmed Facts，`applyCompetitiveRankTransition` 保证 WIN 的 delta 恒正、LOSS 恒 `<=0`）。可以用 SQL `CASE` 表达式直接算出 `outcome`，避免在 TS 里再判断一次。
- 分页游标用 `beforeMatchId`：先查该 match 的 `settled_at`，再查早于它的记录。首页请求不带游标。
- 返回条数固定 `limit`（由 service 层写死 20，不接受调用方传任意值，避免一次性拉全表）。

### Protocol 新类型 (`packages/protocol/src/competitive.ts`)
```ts
export const competitiveMatchOutcomeSchema = z.enum(["WIN", "LOSS", "DRAW"]);
export const competitiveMatchHistoryEntrySchema = z.object({
  matchId: z.string().min(1),
  settledAt: z.iso.datetime({ offset: true }),
  outcome: competitiveMatchOutcomeSchema,
  multiplier: competitiveMultiplierSchema.nullable(),
  finalRankDelta: z.number().int(),
  crossedMajor: z.enum(["UP", "DOWN"]).nullable(),
});
export const competitiveMatchHistoryPageSchema = z.object({
  entries: z.array(competitiveMatchHistoryEntrySchema),
  nextCursor: z.string().nullable(),
});
```
- `crossedMajor` 在 service 层用 `majorIndexForRankLevel(preRankLevel)` vs `majorIndexForRankLevel(postRankLevel)` 算出（`@huanghuang/game-engine` 已导出该函数），流局固定为 `null`。
- 之所以在 protocol 层返回 `crossedMajor` 而不是原始的 `preRankLevel`/`postRankLevel`，是因为跨段判断和展示都是纯函数，没必要让小程序侧重复引入 `majorIndexForRankLevel`。

### Server service 层 (`apps/server/src/matchmaking-service.ts`)
新增方法 `getMatchHistory(session, beforeMatchId?)`：
- 复用 `assertWechatLinked`（现有私有方法，`getProfile` 已用）。
- 调用 `database.listCompetitiveMatchHistory(session.id, { limit: 20, beforeMatchId })`。
- 对每条记录计算 `crossedMajor`，组装成 `CompetitiveMatchHistoryPage`（`nextCursor` = 最后一条的 `matchId`，不足 20 条则为 `null`）。

### 新增 HTTP 路由 (`apps/server/src/index.ts`，紧邻 `/api/competitive/profile` 之后)
```ts
app.get<{ Querystring: { before?: string } }>("/api/competitive/matches", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    return matchmaking.getMatchHistory(session, request.query.before);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "WECHAT_LINK_REQUIRED") {
      return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
    }
    throw cause;
  }
});
```
不会和已有的 `POST /api/competitive/matches/:matchId/acknowledge` 冲突（方法+路径形状都不同）。

### 小程序 API 客户端 (`apps/miniprogram/src/api/http.ts`)
`competitiveApi` 追加：
```ts
matchHistory(beforeMatchId?: string): Promise<CompetitiveMatchHistoryPage> {
  return request(
    `/api/competitive/matches${beforeMatchId !== undefined ? `?before=${beforeMatchId}` : ""}`,
  );
},
```

### 小程序 UI
- 新组件 `apps/miniprogram/src/components/MatchHistoryModal.tsx`（+ `.scss`），仿照 `PlayerProfileModal` 的 backdrop/modal 结构（`profile-backdrop` 类似样式，自己一套 `match-history-*` 类名）：
  - 打开时拉取第一页（`competitiveApi.matchHistory()`），列表底部"加载更多"按钮触发下一页（传 `nextCursor`）。
  - 每行渲染：
    - 左侧：胜/负/流局徽标（复用"流局"措辞；胜/负各自的颜色沿用应用里已有的赢家高亮色，若没有明确颜色变量就用中性的强调色，不新增设计系统）。
    - 中间：倍率（`×{multiplier}`），流局不展示（留空或"—"）。
    - 右侧：段位加星 `{finalRankDelta >= 0 ? '+' : ''}{finalRankDelta} 级`，若 `crossedMajor !== null` 追加"（升段）"/"（掉段）"。
  - 空列表状态：复用现有"无永久竞技战绩"式的空态文案，改成"暂无历史战绩"。
- `PlayerProfileModal.tsx` 新增 prop `onViewMatchHistory?: () => void`，仅在 `isSelf && competitiveProfile !== null` 时在 `profile-modal__actions` 里渲染"历史战绩"按钮。
- `pages/index/index.tsx`：新增 `matchHistoryOpen` state，`PlayerProfileModal` 的 `onViewMatchHistory` 设为 `() => setMatchHistoryOpen(true)`；`matchHistoryOpen` 为真时渲染 `<MatchHistoryModal onClose={...} />`。

## 兼容性与回滚
- 所有 DB 改动都是新增列/新增枚举值，且用现有的两种迁移套路（additive ALTER、CHECK 约束 rebuild），不影响老数据；`competitive_action_events` 的 rebuild 迁移在事务里执行，失败会整体回滚。
- 新增的 HTTP 路由和 protocol 字段都是新增，不改变现有响应形状，向后兼容。
- 如需回滚：撤销 server/miniprogram 的代码即可，新增列留在数据库里不会影响旧代码运行（旧代码不会读取新列）。
