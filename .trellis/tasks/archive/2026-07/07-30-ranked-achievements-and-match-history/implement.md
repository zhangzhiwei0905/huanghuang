# Implement Plan: 硬来由/软来由成就 + 历史战绩查看

## Ordered Checklist

### Step 1 — Protocol
1. `packages/protocol/src/competitive.ts`：
   - `competitiveAchievementActionSchema` 追加 `"HARD_LAIYOU"`, `"SOFT_LAIYOU"`。
   - `competitiveAchievementTotalsSchema` 追加 `hardLaiyou`, `softLaiyou`。
   - 新增 `competitiveMatchOutcomeSchema`, `competitiveMatchHistoryEntrySchema`, `competitiveMatchHistoryPageSchema` 及对应导出类型（见 design.md）。
2. `pnpm --filter @huanghuang/protocol build`（或 `pnpm -r --filter @huanghuang/protocol typecheck`）确认无编译错误，供下游包引用。

### Step 2 — Server 数据层 (`apps/server/src/database.ts`)
1. 类型层：`CompetitiveAchievementAction`、`CompetitiveProfileRow`、`PublicCompetitiveProfileRow` 追加新字段；新增 `CompetitiveMatchHistoryEntry` 类型。
2. Schema 初始化：additive ALTER 语句数组追加 `hard_laiyou_count` / `soft_laiyou_count`。
3. 修改 `migrateCompetitiveActionEventsCheckConstraint()`：判定标记换成 `"HARD_LAIYOU"`，CHECK 列表和中间表名同步更新（design.md 已给出目标 SQL）。
4. `COMPETITIVE_PROFILE_COLUMNS` / `PUBLIC_COMPETITIVE_PROFILE_COLUMNS` 追加列别名。
5. `recordCompetitiveAchievement()` 的 `counterColumn` map 追加两项。
6. 新增 `listCompetitiveMatchHistory(sessionId, { limit, beforeMatchId })` 只读方法（含 SQL `CASE` 推导 outcome，见 design.md）。

### Step 3 — Server 房间逻辑 (`apps/server/src/room-service.ts`)
1. `competitiveAchievementAction()` 签名改为接收 `Pick<EffectDescriptor, "action" | "winType" | "laiyou">`，`"WIN"` 分支按 `laiyou` + `winType` 判定 `HARD_LAIYOU` / `SOFT_LAIYOU`。
2. 调用点 `competitiveAchievementEvent()` 里改传整个 `descriptor`。
3. `matchmaking-service.ts` / `social-service.ts` / `room-service.ts` 三处 achievements 字面量追加 `hardLaiyou` / `softLaiyou` 映射。

### Step 4 — Server 历史战绩接口
1. `matchmaking-service.ts` 新增 `getMatchHistory(session, beforeMatchId?)`，内部算 `crossedMajor`（用 `majorIndexForRankLevel`）。
2. `index.ts` 新增 `GET /api/competitive/matches`（紧邻 `/api/competitive/profile`），session 鉴权 + `WECHAT_LINK_REQUIRED` 处理与现有 `/api/competitive/profile` 一致。

### Step 5 — 小程序 API 客户端
1. `apps/miniprogram/src/api/http.ts`：`competitiveApi` 追加 `matchHistory(beforeMatchId?)`。

### Step 6 — 小程序 UI
1. `PlayerProfileModal.tsx`：
   - 成就展示区追加"硬来由""软来由"。
   - 新增 `onViewMatchHistory` prop，`isSelf` 时渲染"历史战绩"按钮。
2. 新建 `MatchHistoryModal.tsx` + `MatchHistoryModal.scss`：分页拉取、渲染胜/负/流局、倍率、段位加星（含跨段提示）、空态、加载更多。
3. `pages/index/index.tsx`：接入 `matchHistoryOpen` state 与 `MatchHistoryModal`。

### Step 7 — 测试
1. 服务端单测（`apps/server/src/room-service.test.ts` 或新文件）：
   - 硬来由/软来由胡牌后 `competitive_profiles` 对应计数 +1，非来由胡牌不计入任何成就。
   - `competitive_action_events` CHECK 约束迁移：模拟旧表结构（不含 HARD_LAIYOU）能正确 rebuild 并保留旧行。
2. `database.test.ts`（如存在，否则新建）：`listCompetitiveMatchHistory` 按 `settledAt` 倒序、游标分页、`outcome` 推导（WIN/LOSS/DRAW）、`limit` 生效。
3. `apps/server/src/competitive-database.test.ts`：视既有测试结构追加新列迁移与历史查询的用例。
4. 小程序侧：`PlayerProfileModal` 新增两项成就渲染的快照/单测（如有既有测试文件）；`MatchHistoryModal` 基本渲染测试（胜/负/流局三种行的展示是否符合预期文案）。

## Validation Commands

```bash
pnpm -r --if-present typecheck
pnpm test
pnpm lint
```

## Risky Files / Rollback Points

- `apps/server/src/database.ts`：`migrateCompetitiveActionEventsCheckConstraint()` 的 rebuild 逻辑改动风险最高（涉及表重建），务必在事务内执行并有单测覆盖"老库迁移"路径。回滚点：改动前先确认现有 `RELEASE_WILDCARD` 迁移测试仍然通过，再叠加新枚举值的等价测试。
- `apps/server/src/room-service.ts` 的 `competitiveAchievementAction()` 签名变更是唯一的破坏性签名改动，改动前后需确认唯一调用点已同步更新，且现有测试（`room-service.test.ts`）关于 EXPOSED_KONG 等既有成就的用例仍然通过。

## Follow-up Checks Before `task.py start`

- [x] Inline (Claude Code) 工作流，跳过 sub-agent-dispatch 的 JSONL manifest 门槛（Phase 2 通过 `trellis-before-dev` 直接加载上下文）。
