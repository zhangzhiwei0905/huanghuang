# ranked-continue-stuck-on-settlement

## Goal

排位赛结算后点击"继续匹配"，倒计时结束却仍停留在结算页、无法进入新一局。用户反馈单人排位和好友组队排位都疑似受影响。

## Root Cause

`apps/miniprogram/src/pages/room/index.tsx` 的 `continueCompetitiveMatch()` 组队排位分支（`originRoomCode !== null`）在跳转回原房间前，从未调用 `competitiveApi.acknowledge(matchId)` 确认刚结算的比赛。

服务端 `database.ts` 的 `getCurrentCompetitiveMatch()` 把"已结算但未确认（`acknowledged_at IS NULL`）"的比赛仍视为"当前进行中"。于是回到原房间后，房间页面的匹配轮询立刻把这场旧的、未确认的比赛误判为"重新匹配成功"，弹出倒计时；倒计时结束后 `roomCtrl.openRoom()` 又把 `room` 设置回同一个 `roundSettlement` 不为空的旧结算房间，视觉上等同于"卡在结算页"。

单人排位分支本身在 `competitiveApi.queue()` 内部会正确 acknowledge 旧比赛，静态代码追踪未发现同款确定性 bug；用户报告的"单人也有问题"暂未复现确认，留作后续观察项。

此 bug 是 7/31 引入"防止组队被拆散、回原房间"逻辑的提交（`68f1c5c`）的遗留缺口——加了回原房间的分支，但漏加配套的 acknowledge 调用。

## Fix

`continueCompetitiveMatch()` 组队分支内，在 `roomApi.get(originRoomCode)` 之前先 `await competitiveApi.acknowledge(matchId)`，与单人分支、`returnFromCompetitiveMatch()` 的既有做法保持一致。acknowledge 或获取原房间失败时仍 fall through 到原有的单人重新排队兜底逻辑（确认 `acknowledgeCompetitiveMatchResult` 对已确认比赛重复调用是幂等的，不会抛错）。

Commit: `73a7688` (apps/miniprogram/src/pages/room/index.tsx, +5 行)

## Acceptance Criteria

- [x] 组队排位"继续匹配"倒计时结束后能正常进入新一局，不再卡在结算页
- [x] `tsc --noEmit`（miniprogram）通过
- [x] `vitest run apps/server/src/room-service.test.ts`（60 tests）全部通过，无回归
- [x] 单人排位兜底路径（原房间已解散时回落到单人排队）未被破坏

## Notes

- 部署：仅前端改动，无需重新部署后端 docker 容器；小程序需要重新编译并提交微信审核。
- 单人排位是否独立存在同款问题，需要用户在这次修复上线后单独复测确认；如仍复现，怀疑点在 `matchmakingResponse()`（`index.ts:139-160`）里 `rooms.hasMember()` 校验的潜在时序竞态。
- 后续架构统一见任务 `08-01-unify-ranked-continue-room-flow`（已实施）：acknowledge 同步解锁房间（R2）、统一继续/返回路径（R1）、10 秒自动兜底（R3）、房主踢人（R4）。本次 acknowledge 缺失修复本身被保留，作为统一流程的前置基础。
