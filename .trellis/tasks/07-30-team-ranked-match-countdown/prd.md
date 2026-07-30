# 组队排位匹配成功倒计时

## Goal

组队排位（`TEAM_MATCH`）匹配成功后，应和个人排位一样先展示"匹配成功"倒计时动画，再进入对局，而不是直接跳转。两处匹配成功后的用户体验应保持一致。

## Background / Root Cause

今天（2026-07-30）commit `7f95802` 为**首页个人排位**加了"匹配成功"倒计时（`RoundStartOverlay`），但组队排位的匹配成功处理逻辑完全在 `pages/room/index.tsx` 内单独实现，这次改动完全没有触碰到它：

- `apps/miniprogram/src/pages/room/index.tsx:484-508` 的 `poll()` 轮询 `competitiveApi.status()`，一旦 `response.state.status === "MATCHED"` 就**同步直接**调用 `roomCtrl.openRoom(response.room)`，没有任何倒计时/过渡状态。
- `RoundStartOverlay` 组件虽然已经 import 到这个页面（`room/index.tsx:29`, 渲染于 `1424-1425`），但只用于"全员已准备→开局"这个不相关的场景（`roundStartCountdown`，由 `shouldShowRoundStart` 驱动，即房间 `WAITING→PLAYING` 的 stage 切换），从未接到"排位匹配到人"这个事件上。
- 对照组：`apps/miniprogram/src/pages/index/index.tsx` 中 `applyMatchmakingResponse`（342-378 行）在检测到 `MATCHED` 时，会先 `setPendingMatchNavigation({ navigationKey, room, matchFoundAt: Date.now() })`，配合 `remainingRoundStartSeconds`（wall-clock 计算，`lib/roomTransitions.ts:19-25`）驱动倒计时，倒计时结束（`index.tsx:494-505`）才真正 `openMatchedRoom`。

此外，`room/index.tsx:361` 的 `useSocial(true)` 没有传 `onUpdate` 回调，服务端针对组队匹配同样会推送 `social:update` (`reason: "MATCHMAKING"`)（`apps/server/src/index.ts:187-190`），但房间页把这个推送直接丢弃（`useSocial.ts:82-85`，`onUpdateRef.current` 为 `undefined`），只能依赖自己的 1 秒轮询，比首页排位反应慢。首页的对照实现见 `index.tsx:311-317`。

## Requirements

1. `room/index.tsx` 中组队排位轮询检测到 `status === "MATCHED"` 时，不再立即 `openRoom`，而是先展示 `RoundStartOverlay`（文案与首页一致：`eyebrow="匹配成功"`, `title="即将开局"`），倒计时使用与首页相同的 `remainingRoundStartSeconds` wall-clock 方式（而非 `roundStartCountdown` 现有的每秒递减写法），保证 App 切后台再切回时倒计时不会被重置或卡住。
2. 倒计时结束后再调用 `roomCtrl.openRoom(response.room)` 进入对局。
3. 同一个 `matchId` 只触发一次倒计时/跳转，避免轮询重复触发（1 秒轮询期间可能对同一个 MATCHED 状态请求多次）。
4. `useSocial(true)` 改为 `useSocial(true, onUpdate)`，在收到 `reason === "MATCHMAKING"` 的推送时触发一次组队匹配状态刷新，逻辑与 `index.tsx:311-317` 对齐，减少对 1 秒轮询的依赖。
5. 不改动"全员已准备→开局"（`roundStartCountdown` / `shouldShowRoundStart`）这条已有逻辑，两个倒计时来源互不影响，可共用同一个 `RoundStartOverlay` 渲染位置（互斥展示）。

## Out of Scope

- 首页个人排位倒计时逻辑本身（已实现，不改动）。
- `matchedRoomOpeningRef`/心跳强制重置等首页特有的、针对 `Taro.navigateTo` 跨页面竞态的保护机制——组队排位这里 `openRoom` 只是切换同一房间页内的房间状态，不涉及跨页面导航，不需要搬运这套机制。
- 服务端匹配/推送逻辑（已确认组队和个人排位共用同一套 `matchmaking-service.ts` tick 和 `social:update` 推送，无需改动）。

## Acceptance Criteria

- [x] 组队排位匹配到对手后，先看到"匹配成功 / 即将开局"倒计时覆盖层，倒计时结束后才进入对局牌桌。
- [x] 倒计时期间将小程序切到后台再切回前台，倒计时能正确反映真实经过时间（不重置、不卡住）——复用 `remainingRoundStartSeconds` 的 wall-clock 计算。
- [x] 同一次匹配不会重复弹出倒计时或重复跳转——用 `openedTeamMatchIdRef` 按 `matchId` 去重。
- [x] 组队排位页在收到服务端 `MATCHMAKING` socket 推送时能主动刷新状态，而不是只依赖 1 秒轮询——`useSocial(true, onUpdate)`。
- [x] "全员已准备→开局"的现有倒计时行为不受影响——两个倒计时来源互斥渲染，`roundStartCountdown` 逻辑未改动。
- [x] `pnpm --filter miniprogram typecheck`、`pnpm -w run lint`、`pnpm run test` 全部通过（447 测试全绿，改动文件本身 prettier 格式也通过）。

## Technical Notes

- 复用 `apps/miniprogram/src/lib/roomTransitions.ts` 中已有的 `remainingRoundStartSeconds` 和 `ROUND_START_COUNTDOWN_SECONDS`（无需新增 lib 函数）。
- 不复用 `lib/matchmakingRecovery.ts` 里 `matchmakingRoomNavigationKey` / `shouldOpenMatchmakingRoom`：这两个函数是为首页"轮询+推送+心跳三路并发、且需要跨页面 `Taro.navigateTo`"设计的去重方案，组队排位这里只有单一轮询源、且 `openRoom` 是页内状态切换，直接用一个 `matchId` ref 去重即可，避免引入不适用的抽象。
- 新增状态大致对应 `index.tsx` 的 `pendingMatchNavigation`：在 `room/index.tsx` 里新增 `pendingTeamMatchNavigation`（`{ room, matchFoundAt }`）+ 一个 250ms tick 的 `teamMatchFoundNow`，渲染时与既有 `roundStartCountdown` 互斥判断，谁非空就渲染谁的 `RoundStartOverlay`。
