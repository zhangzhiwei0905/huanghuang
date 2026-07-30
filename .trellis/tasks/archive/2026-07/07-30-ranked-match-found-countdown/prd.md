# 排位匹配成功倒计时页面

## Goal

好友房里"全员已准备"后会有一个"游戏开始"倒计时过渡层（`RoundStartOverlay`），排位赛匹配成功后完全没有这一步，直接从"正在寻找其他玩家"跳进房间。给排位赛匹配成功也加上同风格的过渡，避免"突然被扔进一局游戏"的割裂感。

## Background

- 参考实现：`apps/miniprogram/src/pages/room/index.tsx:245-258` 的 `RoundStartOverlay` 组件 + `apps/miniprogram/src/pages/room/index.scss:1642-1721` 的样式（`round-start-overlay*`，`position: fixed; inset: 0; z-index: 50`）+ `apps/miniprogram/src/lib/roomTransitions.ts` 的 `ROUND_START_COUNTDOWN_SECONDS = 3` 常量。
- 排位赛匹配成功的判定/跳转逻辑：`apps/miniprogram/src/pages/index/index.tsx:316-352` 的 `applyMatchmakingResponse`，一旦 `response.state.status === "MATCHED"` 就直接 `Taro.navigateTo({ url: "/pages/room/index" })`。
- 排位房服务端创建时 `stage` 直接是 `"PLAYING"`（不经过 `"WAITING"`，见 `apps/server/src/room-service.ts:1279-1280` / `:1415-1416`），所以不能照搬好友房那套"靠 stage 从 WAITING 变 PLAYING 触发倒计时"的机制——排位赛的倒计时必须在**首页**匹配成功回调里独立触发，在 `navigateTo` 之前插入倒计时，倒计时结束后再跳转，而不是跳转后在房间页里补一个倒计时。
- 依赖关系：本任务的"匹配成功"触发时机，优先用 [[07-30-matchmaking-socket-push]] 新增的推送事件作为触发信号（更即时、更可靠）；如果该任务尚未合入，退化为沿用现有轮询发现 `MATCHED` 状态的时机触发，两者用同一个"匹配成功"回调入口，不需要重复实现两套触发逻辑。

## Requirements

1. 在首页（`apps/miniprogram/src/pages/index/index.tsx`）新增一个"匹配成功"全屏过渡层组件（可复用或提炼 `RoundStartOverlay` 的样式/结构，避免样式重复写两遍——评估是否把 `RoundStartOverlay` 提炼成公共组件供两个页面 import，而不是复制粘贴一份）。
2. 触发时机：`applyMatchmakingResponse` 检测到 `status === "MATCHED"` 且尚未开始过渡时，先展示过渡层、开始倒计时，倒计时结束后再执行原有的 `Taro.navigateTo` 跳转逻辑；倒计时期间已有的去重/防重复跳转机制（`matchedRoomOpeningRef`、`openedMatchRoomKeyRef`）保持有效，不能被新的倒计时状态绕过或重复触发。
3. 倒计时时长与好友房一致（3 秒），文案改为契合"匹配成功"场景（如"匹配成功"/"即将进入牌局"），不要照抄"全员已准备"的文案。
4. 倒计时期间用户如果退出/切后台再切回（`useDidShow`/`useDidHide`），过渡层状态要能正确恢复或跳过，不能卡在倒计时里出不去（可参考现有 `pageVisibleRef` 处理方式）。
5. 不改变匹配失败/取消排队等其他状态的现有 UI。

## Acceptance Criteria

- [x] 排位赛匹配成功后，用户先看到 ~3 秒的"匹配成功"过渡层，再进入房间，视觉风格与好友房倒计时一致（同样的全屏 overlay、halo、数字动画）。——`RoundStartOverlay` 提炼为共享组件（`components/RoundStartOverlay.tsx`），首页用 `eyebrow="匹配成功" title="即将开局"`，房间页保留原文案。
- [x] 过渡层展示期间不会因为轮询/推送反复触发重复倒计时或重复跳转。——`openedMatchRoomKeyRef` 在进入倒计时前就已认领该 match key，`useDidShow` 在 `pendingMatchNavigation !== null` 时不再重置该 key/重新拉取状态。
- [x] 过渡层期间切后台再切回前台，能正确处理，不出现卡死或白屏。——**选择"用真实时间戳重算，必要时直接跳过倒计时立即跳转"**：`matchFoundAt` 是墙钟时间戳，`remainingRoundStartSeconds` 每次都用 `Date.now()`/推送的 `matchmakingNow` 重新计算剩余秒数；`useDidShow` 里额外做一次同样的重算，若已到期直接跳转，不等下一次 250ms tick。
- [x] 好友房原有的 `RoundStartOverlay` 行为不受影响（无论是否提炼为公共组件）。——纯重构抽成共享组件，`roomTransitions.test.ts` 全部通过，未改变房间页的触发/渲染逻辑。
- [x] 新增/更新相关单元测试（如过渡触发的纯函数逻辑）。——`roomTransitions.ts` 新增 `remainingRoundStartSeconds` 纯函数 + 4 个测试用例（含"挂起很久后必须为 0，不能是负数或卡在半途"的用例）。

## Notes

- 依赖顺序：建议在 [[07-30-matchmaking-socket-push]] 的推送事件到位后再联调触发时机；如果排期上需要先行，可先用现有轮询到的 `MATCHED` 状态触发，后续切换触发源时倒计时组件本身不用改。
