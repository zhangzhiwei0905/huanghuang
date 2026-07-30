# 执行计划：段位匹配阶梯改为按大段扩容

## 步骤

1. 确认 `apps/server` 是否已经依赖 `@huanghuang/game-engine`；没有则在 `apps/server/package.json` 补 workspace 依赖并跑一次安装。
2. 在 `apps/server/src/matchmaking-algorithm.ts` 新增 `matchmakingMajorTierRange(waitMs)`，删除旧 `matchmakingRange`（先 grep 确认调用方只有 `mutuallyCompatible` 和 `selectBotFillGroup`）。
3. 改 `mutuallyCompatible` 用 `majorIndexForRankLevel` 计算大段距离并调用新阈值函数。
4. 改 `selectBotFillGroup` 里对应的段位校验逻辑，同步大段口径。
5. 更新 `apps/miniprogram/src/lib/matchmakingPresentation.ts` 的 `matchmakingRangeLabel` 文案与判断阈值。
6. 更新 `.trellis/spec/backend/team-matchmaking.md`。
7. 更新/新增测试：
   - `apps/server/src/matchmaking-algorithm.test.ts`：覆盖同大段/相邻大段/2 大段/超出范围四档，含跨大段边界的 rankLevel 取值（如某大段最低级 vs 上一大段最高级）。
   - `apps/server/src/matchmaking-service.test.ts`：确认组队跳过校验的既有用例（如 `rankLevel` 0/10/20/30 的 4 人队）仍然通过（这条不该被本次改动影响，因为走的是 partyId 分支）。
8. 跑 `apps/server` 和 `apps/miniprogram` 相关测试套件。

## 验证命令

```bash
cd apps/server && npm test -- matchmaking-algorithm matchmaking-service
cd apps/miniprogram && npm test -- matchmakingPresentation
```

## 回滚点

- 每步都是独立可回滚的小改动；第 2-4 步是核心逻辑，建议合成一个 commit；第 5-6 步文案/文档可拆一个 commit。
