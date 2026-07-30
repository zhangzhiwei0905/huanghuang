# 排位匹配段位阶梯改为按大段扩容

## Goal

组队排位时若两人段位差较大（如黄金3 邀请黑铁3），当前匹配阶梯按**原始 rankLevel 数值差**计算，导致原本只差 1 个大段（如黄金→白银，raw 差值可达 6~9）的玩家也被迫等到较晚的档位才能匹配。改成按**大段**（major tier）距离扩容，让"差不多段位"的组合更快匹配上，语义上也更符合玩家对"段位"的理解。

## Background

- 现状代码：`apps/server/src/matchmaking-algorithm.ts:30-52`
  ```ts
  export function matchmakingRange(waitMs: number): number {
    if (waitMs < 10_000) return 2;
    if (waitMs < 20_000) return 5;
    if (waitMs < 40_000) return 10;
    return Number.POSITIVE_INFINITY;
  }
  function mutuallyCompatible(left, right, now): boolean {
    if (left.partyId !== undefined && left.partyId === right.partyId) return true;
    const distance = Math.abs(left.rankLevel - right.rankLevel);
    return distance <= matchmakingRange(waitMs(left, now)) && distance <= matchmakingRange(waitMs(right, now));
  }
  ```
- 大段换算函数已存在：`packages/game-engine/src/competitive-rank.ts:44-50` 的 `majorIndexForRankLevel(rankLevel) = Math.min(Math.floor(rankLevel / 5), 7)`（每 5 级一个大段，共 8 个大段：黑铁/青铜/白银/黄金/铂金/钻石/星耀/雀神）。`matchmaking-algorithm.ts` 目前完全不依赖 `@huanghuang/game-engine`，是这次要新增的依赖。
- 组队内部（`partyId` 相同）本来就跳过段位校验，这次**不改**这一点——好友组队匹配彼此永远不因段位差被拒绝。本次只改"组队/单人 vs 外部对手或机器人"这条路径的段位距离度量单位。
- 客户端展示文案 `apps/miniprogram/src/lib/matchmakingPresentation.ts:10-15` 的 `matchmakingRangeLabel` 目前也是硬编码同一套 10/20/40 秒 + 2/5/10 级阈值，纯展示用，需要同步改成大段口径的文案。
- 已知边界：如果两名玩家大段距离本身就很大（例如相差 3 个大段以上），新旧两种口径最终都要等到"全服不限"档位（≥40s）才能凑齐——这个改动主要收益是让"1 个大段以内"的差距不再被误判进更晚的档位，而不是让极端段位差瞬间匹配。这属于预期行为，不是本任务要解决的问题（极端段位差的等待体验由同批任务里的匹配成功推送/倒计时来兜底，而不是靠无限放宽段位）。

## Requirements

1. 新增一个按"大段距离"计算的匹配范围函数（替换或包装 `matchmakingRange`），阶梯改为：
   - 等待 <10s：大段距离 ≤ 0（仅同一大段）
   - 等待 <20s：大段距离 ≤ 1（相邻大段）
   - 等待 <40s：大段距离 ≤ 2
   - 等待 ≥40s：不限（`Infinity`，与现状一致）
2. `mutuallyCompatible` 里的距离计算从 `Math.abs(left.rankLevel - right.rankLevel)` 改为 `Math.abs(majorIndexForRankLevel(left.rankLevel) - majorIndexForRankLevel(right.rankLevel))`，复用 `@huanghuang/game-engine` 的 `majorIndexForRankLevel`，不要重复实现 `Math.floor(rankLevel / 5)`。
3. `selectBotFillGroup` 里对机器人填充的段位校验（同样调用 `matchmakingRange`）要同步切换到大段口径，保证真人 vs 机器人的段位差判定和真人 vs 真人一致。
4. 组队内部（同 `partyId`）跳过段位校验的逻辑保持不变。
5. `apps/miniprogram/src/lib/matchmakingPresentation.ts` 的等待文案同步改为大段口径的描述（如"同大段内"/"相邻大段"/"2 个大段内"/"全服范围"），阈值与服务端保持一致。
6. `.trellis/spec/backend/team-matchmaking.md` 更新为新的大段口径描述。
7. 更新/新增测试：`apps/server/src/matchmaking-algorithm.test.ts`、`apps/server/src/matchmaking-service.test.ts` 中所有依赖旧 raw-level 阈值的用例，覆盖新的大段边界（含跨大段边界的等级值，如某大段最后一级 vs 下一大段第一级）。

## Acceptance Criteria

- [x] 两名 rankLevel 差恰好落在同一大段内的玩家，应在 <10s 档位即可视为段位兼容（无需等到 10-20s 档位）。
- [x] 相邻大段（大段距离 1）的玩家最迟在 10-20s 档位即可兼容。——新增回归测试证明：rankLevel 0 vs 9（相邻大段，raw 差 9）在 15s 即可匹配，旧的 raw-level 阶梯下需要等到 20-40s 档位。
- [x] 组队内部（同 partyId）成员之间的匹配继续不受段位差限制，不因本次改动被误伤。——`mutuallyCompatible` 的 partyId 短路分支未改动，既有测试（rankLevel 0/10/20/30 的 4 人队）仍通过。
- [x] 机器人填充路径（`selectBotFillGroup`）使用与真人路径一致的大段阈值。——复用同一个 `majorTierDistance` + `matchmakingMajorTierRange`。
- [x] 客户端等待提示文案与服务端新阈值语义一致，不再显示旧的"相差 N 级"数值口径。——改为"同大段内"/"相邻大段内"/"2 个大段内"/"全服范围"。
- [x] `matchmaking-algorithm.test.ts` / `matchmaking-service.test.ts` 全部通过，新增覆盖大段边界的用例。——441 个测试全部通过（含新增的相邻大段/跨 2 大段回归测试）。
- [x] `.trellis/spec/backend/team-matchmaking.md` 描述与新实现一致。

## Notes

- 依赖顺序：本子任务与 [[07-30-ranked-match-found-countdown]]、[[07-30-matchmaking-socket-push]] 相互独立，可并行实现。
