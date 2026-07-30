# PRD: 硬来由/软来由成就 + 历史战绩查看

## Goal

排位赛（MATCH 模式）玩家可以：
1. 累计并查看"硬来由""软来由"胡牌次数，作为新增的两项成就统计。
2. 查看自己的历史战绩列表：每局的胜/负（含流局）、自己的倍率、以及本局的段位加星情况（如 +5 级 / -3 级），跨段时额外提示升段或掉段。

## Confirmed Facts (from codebase)

- "来由" = 胡的那张牌恰好是本家上一次放赖（RELEASE_WILDCARD）后摸到的那张牌。`RoundState.outcome.winType`（`"HARD" | "SOFT"`）+ `outcome.laiyou: boolean` 已经描述了这个事件：`laiyou === true` 时，`winType === "HARD"` 是硬来由，`winType === "SOFT"` 是软来由。定义见 `packages/protocol/src/projections.ts:77-84`。
- 现有成就体系：`competitiveAchievementActionSchema`（`packages/protocol/src/competitive.ts:37-51`）已有 `EXPOSED_KONG / INDICATOR_PONG_KONG / ADDED_KONG / CONCEALED_KONG / RELEASE_WILDCARD` 五项，存于 `competitive_profiles` 表对应列（`apps/server/src/database.ts:38-64`）。
- 成就记录只在 `room.mode === "MATCH"`（排位赛）生效，见 `apps/server/src/room-service.ts:846-866` 的 `competitiveAchievementEvent`；`competitiveAchievementAction()`（`room-service.ts:345-359`）当前对 `"WIN"` 效果返回 `null`，即胡牌从不计入任何成就 —— 这是本次要补上的缺口。
- `detectEffectDescriptor`（`room-service.ts:385-431`）在检测到 `outcome.kind === "WIN"` 时已经把 `winType` 和 `laiyou` 带入 `EffectDescriptor`，因此判断硬/软来由不需要新的规则引擎改动，只需要在 `competitiveAchievementAction()` 里为 `"WIN"` case 补充判断逻辑。
- 历史战绩所需数据已经存在，不需要新的核心数据表：
  - `competitive_matches` 表（`CompetitiveMatchRow`，`database.ts:100-111`）：`id / roomId / ruleVersion / status / resultJson / createdAt / settledAt`。
  - `competitive_match_players` 表（`CompetitiveMatchPlayerRow`，`database.ts:113-127`）：每个玩家每局一行，含 `preRankLevel / postRankLevel / rawRankDelta / finalRankDelta / protectionCards* / multiplier / acknowledgedAt`。
  - 胜/负/流局判定：`multiplier === null` → 流局（DRAW）；`multiplier !== null` 时 `finalRankDelta > 0` → 胜，`finalRankDelta <= 0` → 负（`applyCompetitiveRankTransition`，`packages/game-engine/src/competitive-rank.ts:82-150`：WIN 的 `appliedDelta` 恒为正的 `magnitude`，LOSS 的 `appliedDelta` 恒 `<= 0`，即便有保护卡也是 0 而非正数）。
  - "自己的倍率"就是该玩家这一行的 `multiplier` 列（胜方是 `winBase × laiyou × personalMultiplier`，负方是 `-payment.delta / baseScore`，流局为 `null`），已在结算时按每个玩家分别算好，见 `room-service.ts:868-947`。
  - 段位加星 = `finalRankDelta`（直接展示 `+5` / `-3`）。跨段判断：用 `majorIndexForRankLevel(preRankLevel)` 与 `majorIndexForRankLevel(postRankLevel)`（`packages/game-engine/src/competitive-rank.ts:44-50`，已导出）比较，不同则跨段，`afterMajor > beforeMajor` 为升段，反之为掉段。
- 现有相关只读接口 `GET /api/competitive/profile`（`apps/server/src/index.ts:518-529`）是最贴近的既有模式：session 鉴权、封装数据库读取。
- 小程序侧现有 `PlayerProfileModal`（`apps/miniprogram/src/components/PlayerProfileModal.tsx`）已经渲染 `competitiveProfile.achievements` 五项成就（放赖/明杠/碰亮牌/补杠/暗杠），是新增两项成就展示的自然扩展点；该弹窗对本人和其他玩家都会打开（`isSelf` 区分）。
- 首页 `index.tsx` 已有一个仅本人可见的 `profileOpen` → `PlayerProfileModal` 入口（点击账号区域），是"查看历史战绩"入口的自然挂载点。
- 荒牌/流局的既有中文措辞是"流局"（`RoundSettlementModal.tsx:52-53`）。

## Requirements

### R1: 硬来由 / 软来由成就
- 新增两个成就动作 `HARD_LAIYOU` / `SOFT_LAIYOU`，与现有 5 项同级别存于 `competitive_profiles` 表新增列（如 `hard_laiyou_count` / `soft_laiyou_count`）。
- 仅排位赛（`room.mode === "MATCH"`）计数，与现有 5 项成就行为一致。
- `competitiveAchievementAction()` 需要对 `"WIN"` 效果新增判断：`descriptor.laiyou === true` 时按 `descriptor.winType` 分流到 `HARD_LAIYOU` / `SOFT_LAIYOU`；非来由的普通胡牌仍不计入任何成就。
- `CompetitiveAchievementTotals`（protocol）、`PublicCompetitiveProfileRow`（database）、`matchmaking-service.ts` / `social-service.ts` / `room-service.ts` 里对 achievements 字段的手工映射需要同步增加这两项。
- 小程序 `PlayerProfileModal.tsx` 的成就展示区新增"硬来由""软来由"两个条目（对本人和他人都展示，与现有 5 项一致）。
- 数据库迁移：仿照 `database.ts:469-507` 已有的"检测旧表结构缺列则重建/迁移"模式，为老库补齐新列，默认值 0。

### R2: 历史战绩查看
- 入口：首页账号区域点击头像打开的 `PlayerProfileModal`（`isSelf` 时）新增"历史战绩"按钮，点击后打开新的 `MatchHistoryModal` 组件（本人专属，不对他人开放）。
- 数据来源：仅排位赛（`competitive_matches` / `competitive_match_players`），且只查询该玩家自己的已结算（`status === "SETTLED"`）记录，按 `settledAt` 倒序。
- 新增只读接口 `GET /api/competitive/matches`（或等价路径），session 鉴权，返回该 session 的历史战绩分页列表。
- 每条记录展示：
  - 胜/负/流局（流局用"流局"文案，不算胜也不算负）。
  - 自己的倍率（`multiplier` 列，流局不展示倍率或展示占位符）。
  - 段位加星：`finalRankDelta` 格式化为 `+N 级` / `-N 级`（0 时展示 `+0 级`或"未变化"）。
  - 跨段时追加"升段"或"掉段"提示（对比 `majorIndexForRankLevel(preRankLevel)` 与 `majorIndexForRankLevel(postRankLevel)`）。
- 流局（DRAW）行需要展示，标注为"流局"：不算胜也不算负，不展示倍率（或展示占位符），段位加星固定显示 `+0 级`。
- 分页：每页 20 条，支持"加载更多"（游标基于 `settledAt`/`matchId`），不额外限制历史总深度。

## Out of Scope

- 好友房 / 机器人房对局不产生 `competitive_matches` 记录，不纳入历史战绩。
- 好友房里的"来由"目前也不计入成就统计（因为成就体系整体只在 MATCH 模式生效），本次不改变这一前提。
- 查看他人的历史战绩列表（仅本人可查看自己的）。
- 历史战绩详情页（如摊牌详情、逐局录像回放）不在本次范围内，只做列表级摘要。

## Acceptance Criteria

- [x] 排位赛中打出硬来由/软来由后，`GET /api/competitive/profile` 返回的 `achievements` 里对应计数 +1；老库自动迁移出新列且默认值为 0。
- [x] `PlayerProfileModal` 展示新增的两项成就（本人与他人视角均可见）。
- [x] 首页本人 `PlayerProfileModal` 新增"历史战绩"入口，点击后展示本人的排位赛历史列表。
- [x] 每条历史记录正确展示胜/负/流局、自己的倍率、段位加星（+N 级 / -N 级），跨段时正确显示"升段"或"掉段"。
- [x] 好友房/机器人房对局不出现在历史战绩列表中。
- [x] 流局对局在列表中展示为"流局"，不展示倍率，段位加星显示 `+0 级`。
