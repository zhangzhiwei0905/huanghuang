# 排位赛匹配体验优化

## Goal

用户（黄金3）邀请好友（黑铁3）组队排位时，因段位差过大导致长时间等不到匹配；匹配成功后没有任何过渡就直接跳进房间；匹配过程还会偶发"卡死"——轮询循环挂掉后既不提示也不跳转，只能强制刷新小程序才能进房。本任务把这三个问题一起修掉，让排位匹配的等待、成功、进房体验和好友房一致地顺畅、可靠。

来源：用户 2026-07-29 实测反馈（3 个问题打包提出）。

## Background（调研结论，供子任务复用）

- 匹配算法：`apps/server/src/matchmaking-algorithm.ts` 的 `matchmakingRange(waitMs)` 按**原始 rankLevel 数值差**分阶梯（<10s→2，<20s→5，<40s→10，≥40s→∞），组队内部完全跳过段位校验，但组队 vs 外部对手/机器人仍按每个成员各自的 rankLevel 差值校验 → 段位差越大越容易被迫等到"全服不限"档位。
- 匹配成功过渡：好友房有 `RoundStartOverlay`（`apps/miniprogram/src/pages/room/index.tsx:245-258`，配合 `apps/miniprogram/src/lib/roomTransitions.ts` 的 `shouldShowRoundStart`），排位赛没有对应机制——`applyMatchmakingResponse`（`apps/miniprogram/src/pages/index/index.tsx:316-352`）一发现 `MATCHED` 就直接 `Taro.navigateTo`。排位房服务端创建时 `stage` 直接是 `"PLAYING"`（`apps/server/src/room-service.ts:1279-1280`、`:1415-1416`），不会经过 `WAITING`，所以不能直接复用好友房那套 stage 触发逻辑，需要在首页匹配成功回调里单独触发倒计时层。
- 卡死根因：排位匹配全靠 HTTP 轮询（`index/index.tsx` 371-401 的链式 `setTimeout` + `useDidShow` 兜底），服务端 `matchmaking-service.ts` 的 `tick()` 明明算出了 `changedSessionIds`/`matches`（用于判断谁刚被匹配上），但 `apps/server/src/index.ts` 里 `tickMatchmaking()` 直接把这个返回值丢弃，没有任何推送通道。7-29 的 `07-29-ranked-match-stuck-fix` 只修了几个客户端死结（按钮卡住、重复跳转、结算页返回栈问题），PRD 里明确写了"socket 推送重构本轮不做，作为后续独立任务"——本任务就是那个后续任务。

## Requirements

三个独立可验证的子任务：

1. **[[07-30-rank-tier-matchmaking-widening]]** 段位匹配阶梯改为按大段（`majorIndexForRankLevel`，每 5 级一大段）计算距离，而不是原始 rankLevel 数值差。
2. **[[07-30-ranked-match-found-countdown]]** 排位匹配成功后，跳房间前插入类似好友房 `RoundStartOverlay` 的"匹配成功"倒计时过渡层。
3. **[[07-30-matchmaking-socket-push]]** 服务端匹配成功时通过 socket 主动推送给客户端，从架构上根治轮询卡死；HTTP 轮询降级为兜底，并加超时兜底重置 + 房间页加载时的"是否已匹配"兜底检查。

## Acceptance Criteria（跨子任务）

- [ ] 段位差极大（如黄金3 vs 黑铁3）的组队排位，匹配等待时间应明显缩短，且不再需要等到"全服不限"档位才能凑齐。
- [ ] 排位赛匹配成功后，用户能看到一个短暂的"匹配成功"过渡/倒计时页面，再进入房间；视觉/交互与好友房倒计时风格一致。
- [ ] 匹配成功事件通过 socket 主动推送，客户端不再仅依赖轮询发现匹配结果；即使客户端轮询/回调异常，也有独立兜底路径能让玩家正常进房，无需手动刷新小程序。
- [ ] 三个子任务互不阻塞对方交付，可独立实现、独立验收；子任务 2（倒计时）依赖子任务 3 推送的"匹配成功"事件作为触发时机（在子任务 2 的 prd/implement 中写明这一顺序要求）。
- [ ] 现有测试（`matchmaking-algorithm.test.ts`、`matchmaking-service.test.ts`、`roomTransitions.test.ts` 等）全部更新并通过；`.trellis/spec/backend/team-matchmaking.md` 同步更新。

## Notes

- 本任务不改变"组队内部跳过段位校验"的既有设计（好友组队匹配彼此不因段位差被拒绝），只改组队/单人对外匹配时的段位距离度量单位。
- 子任务 3 范围较大（新增匹配阶段的 socket 通道），需要 design.md + implement.md；子任务 1、2 视复杂度决定是否需要 design.md。
