# 执行清单：匹配算法简化（统一单排/组队排位）

1. `matchmaking-algorithm.ts`：`mutuallyCompatible` 去掉段位距离判断（只保留 party 不拆散约束）；删除 `matchmakingMajorTierRange`/`majorTierDistance` 死代码；`compareGroups` 删除 `groupSpread`/`totalPairDistance` 段位相关排序项；`selectBotFillGroup` 机器人筛选改为"空闲机器人随机打乱取前N个"，去掉段位过滤与 `lastMatchedAt` 排序。
2. 检查 `RankedBotCandidate` 类型是否还需要 `rankLevel`/`lastMatchedAt` 字段，若无其他用途一并清理，同步调整 `matchmaking-service.ts` 里构造 `idleBots` 的代码。
3. 更新 `matchmaking-algorithm.ts` 现有单测：删除/更新断言"段位差超范围应不兼容"、"应优先选段位差小的组合"的用例；补充"段位差很大也能撮合"、"机器人补位结果随机"、"1人组队与单排规则一致"的用例。
4. 跑 `matchmaking-service.ts` 相关集成测试，确认 `tick()` 行为符合预期（真人凑桌、超时机器人补位、party不拆散）。
5. `tsc` 编译 + lint 检查 server 包。
6. 如时间允许，本地起服务用两个不同段位的测试账号手动验证：单排也能跨段位撮合；组队排位1人排队体验与单排一致。

## 验证命令

- `pnpm --filter @huanghuang/server test`
- `pnpm --filter @huanghuang/server typecheck`
