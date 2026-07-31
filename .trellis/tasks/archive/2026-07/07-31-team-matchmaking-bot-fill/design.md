# 设计：匹配算法简化（统一单排/组队排位逻辑）

## 决策更新

用户反馈：不要拆分单排/组队两条管线，直接统一成一套不考虑段位的算法——组队排位里只有1人排队时，效果就应该等价于单人排位。这比最初设想的"拆分两条管线"简单得多：不需要区分候选者是通过 `enqueue()`（单排）还是 `enqueueParty()`（组队）进来的，统一用同一套规则处理，天然满足"1人组队=单排"。

## 改动范围

### `apps/server/src/matchmaking-algorithm.ts`

- 删除段位相关的兼容性限制：`mutuallyCompatible` 不再调用 `matchmakingMajorTierRange`/`majorTierDistance` 做距离判断，只保留"同一 party 不拆散"这一条硬约束——candidate 之间永远视为兼容（只要不拆散已有 party）。
- 删除不再使用的 `matchmakingMajorTierRange`、`majorTierDistance` 函数（死代码，直接移除，不保留过渡兼容）。
- `compareGroups` 排序去掉 `groupSpread`/`totalPairDistance` 两项段位相关比较（不再有意义），只保留 `recentOpponentPairs`（规避最近对手）+ `enqueueOrderKey`（先入先出兜底排序）两项。`groupSpread`/`totalPairDistance` 函数一并删除。
- `selectBotFillGroup` 里机器人筛选逻辑重写：去掉 `majorTierDistance` 兼容过滤，去掉按 `lastMatchedAt` 排序"优先选最久未用"的逻辑，改为对**当前空闲机器人**做一次随机打乱（Fisher-Yates 或 `Math.random()` 排序）后取所需数量。`RankedBotCandidate.rankLevel`/`lastMatchedAt` 字段若不再被任何逻辑读取，一并从类型和调用方清理掉（检查 `matchmaking-service.ts` 里构造 `idleBots` 的地方是否还需要传这两个字段）。
- `selectMatchmakingGroup`/`selectBotFillGroup` 函数签名、`tick()` 里的调用方式不变，只是内部规则变了——`matchmaking-service.ts` 的改动量很小。

### `apps/server/src/matchmaking-service.ts`

- `tick()` 结构基本不变，仍是"先跑 allowBots 的人类优先+机器人补位判断，再跑主循环反复撮合"。唯一需要调整的地方：如果 `RankedBotCandidate` 类型瘦身了（去掉 rankLevel/lastMatchedAt 相关读取），这里构造 `idleBots` 的地方要同步精简。
- 机器人补位的等待时长常量 `MATCHMAKING_BOT_FILL_WAIT_MS`（5秒）不变，继续统一适用于单排和组队。
- `allowBots` 开关机制维持现状不变（这是"是否允许机器人补位"的用户偏好开关，跟"匹配时要不要看段位"是两回事，本次不动它）——单排和组队各自现有的 `allowBots` 传参方式都不需要改。

### 不改动的部分

- `database.ts` 无需 schema 改动。
- 单排、组队两个 HTTP 入口（`/api/matchmaking/queue`、`/api/rooms/:code/team-matchmaking`）签名、校验逻辑不变。
- Party 完整性约束（`containsCompleteParties`，同一队伍不会被拆散到不同桌）不变。
- 最近对手规避逻辑（`recentOpponentPairs`）保留，不属于"段位"范畴。

## 风险与测试要点

- 由于是直接修改共享算法（不再是"新增一套 team 专用函数"），需要重新审视/更新 `matchmaking-algorithm.ts` 现有单测——凡是断言"段位差超出范围应该不兼容"或"应该优先选段位差更小的组合"的用例，都需要按新行为更新或删除；凡是断言"最近对手规避"、"party 不拆散"的用例应继续保留并通过。
- 新增测试覆盖：段位差很大的候选者也能被撮合进同一桌；机器人补位在多次运行下确实是随机的（不总是选同一批）；1人通过组队入口排队和1人通过单排入口排队，最终撮合结果规则一致。
- 这是一个全局行为变更（单排也会受影响），需要在 PR/提交说明里明确写清楚"单人排位的匹配范围也放开了，不再按段位限制"，避免后续被误认为是遗留 bug。
