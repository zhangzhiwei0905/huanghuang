# 组队排位与个人信息页体验优化

## Goal

一批小程序端体验修复 + 组队排位匹配机制调整，来源于同一轮用户排查反馈。父任务只做汇总与跨子任务验收，具体实现分别在子任务中规划执行。

## 子任务

1. [07-31-match-history-entry-feedback](../07-31-match-history-entry-feedback/prd.md) — 历史战绩入口在请求失败/未绑定微信时静默隐藏，需要给出可见提示。
2. [07-31-rank-badge-size-unify](../07-31-rank-badge-size-unify/prd.md) — 段位徽章整体缩小，且8个段位素材需要重新对齐，视觉大小统一。
3. [07-31-profile-modal-scrollable](../07-31-profile-modal-scrollable/prd.md) — 个人信息/历史战绩弹窗在小程序端用 `View`+CSS overflow 无法手势滚动，需要换成 `ScrollView`。
4. [07-31-team-matchmaking-bot-fill](../07-31-team-matchmaking-bot-fill/prd.md) — 匹配算法简化：单排/组队排位统一为同一套不考虑段位的逻辑，短暂尝试真人匹配后随机机器人补位（组队1人=单排）。
5. [07-31-ranked-continue-team-bug](../07-31-ranked-continue-team-bug/prd.md) — 组队排位结算后点"继续游戏"会让队伍解散变成单人排位，需要修复为回到队伍继续排队。

## Requirements

- 各子任务独立规划、独立实现、独立验收，互不阻塞。
- 子任务4（匹配简化）与子任务5（续局丢队伍）都涉及 `matchmaking-service.ts`/`matchmaking-algorithm.ts`，实现顺序建议先做4再做5，避免互相冲突返工（5的设计假设基于4已完成的"组队排位独立管线"结构）。

## Acceptance Criteria

- [x] 5个子任务全部完成并通过各自验收标准。
- [x] 子任务4是全局改动：单人排位的匹配范围也会一并放开、不再按段位限制（这是有意为之，不是回归）。
- [x] 子任务5（续局）不影响单人排位的续局行为，仅改变组队排位来源的续局路径。
- [x] 小程序端 TypeScript 编译通过，服务端 TypeScript 编译通过，无新增 lint 错误。

## Notes

- 子任务4、5建议按顺序实现（先4后5），因为5的技术方案依赖4把组队排位撮合管线独立出来之后的结构。
- 子任务1、2、3互相独立，可并行/任意顺序处理。
