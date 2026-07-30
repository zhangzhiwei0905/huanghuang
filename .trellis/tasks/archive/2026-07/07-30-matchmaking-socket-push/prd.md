# 排位匹配成功socket推送根治卡死

## Goal

排位匹配偶发"卡死"：轮询循环挂掉/`navigateTo` 悬而不决后，客户端既不提示也不跳转，只能强制刷新小程序才能进房（进房后发现其实早就匹配成功了，说明服务端状态一直是对的，纯粹是客户端发现机制失效）。根治方案：服务端匹配成功时通过 socket 主动推送，客户端收到推送立即处理，HTTP 轮询降级为兜底；同时补齐"进入房间页时兜底核实一次"和"导航状态永久锁死"两个已知死角，让整条链路即使某一环失效也有别的环兜底。

## Background

- 服务端已经算出了"谁刚被匹配上"却直接丢弃：`apps/server/src/matchmaking-service.ts` 的 `tick(now)`（235-431 行）返回 `MatchmakingTickResult = { changedSessionIds, matches }`（43-46 行），但 `apps/server/src/index.ts` 的 `tickMatchmaking()`（187-193 行）拿到这个结果后只调用 `rooms.reconcileTeamMatchQueues()` → `emitRoomProjection()`（这是给"已经在房间里"的人用的），**从未**为 `matches`/`changedSessionIds` 做任何推送。`setInterval(tickMatchmaking, 1_000)`（983-986 行）每秒跑一次，结果被彻底丢弃。
- 客户端目前 100% 靠 HTTP 轮询发现匹配结果：`apps/miniprogram/src/pages/index/index.tsx` 371-401 行的链式 `setTimeout` 轮询 + 403-418 行 `useDidShow` 兜底重新拉取一次。真正在房间里的 socket 连接（`apps/miniprogram/src/hooks/useRoom.ts` 169-298 行，`socket.io-mp`）**要等房间已知之后才建立**（`if (current === null) return;`，171 行），跟排位排队阶段完全无关，两者是断开的。
- 已知的三个具体死角（本任务要顺带堵上，否则加了推送也只是多一条主路径，副本死角依然会导致偶发卡死）：
  1. `matchedRoomOpeningRef`（`index/index.tsx:338-351`）只在 `Taro.navigateTo(...).finally()` 里复位；如果 `navigateTo` 的 Promise 一直不 settle（微信小程序偶发行为），这个标志永久为 `true`，之后所有轮询/推送都会被 `shouldOpenMatchmakingRoom` 挡住，而 `openedMatchRoomKeyRef` 又在跳转发起前就已提前写入同一个 key（339 行之前），导致连"重试同一场匹配"都被拦住。需要加超时兜底（如 N 秒后强制复位并允许重试）。
  2. 房间页（`apps/miniprogram/src/pages/room/index.tsx`）挂载时完全依赖首页写入的 `wx.getStorageSync("huanghuang_open_room")`，自己不会去问服务端"我是不是应该已经匹配上了"。如果首页的自动跳转始终没触发（含上面第 1 点的死锁场景），房间页永远没有机会把玩家拉进去。团队匹配等待房已经有独立轮询兜底（`room/index.tsx:500-522`），排位赛这条路径没有对应机制，需要补一个。
  3. 轮询本身是链式 `setTimeout`（下一次调度依赖上一次回调成功执行），一旦某次回调内部抛出未捕获异常且没有走到重新调度那一步，整条轮询链就静默死掉，没有独立的心跳去验证"轮询是不是还活着"。
- 已有可复用基础设施：Socket.IO 服务端/客户端已经用于房间内同步（`emitRoomProjection`，`apps/server/src/index.ts:163-185`；`useRoom.ts` 的连接与重连逻辑，含 `reconnectWatchdog.ts`），排队阶段的推送应该复用同一套 socket 基础设施（同一连接或同一鉴权方式），而不是另起一套通道。
- 前序调研已确认：7-29 的 `07-29-ranked-match-stuck-fix` 明确把"匹配状态改 socket 推送"列为 Out of Scope、留给后续任务（`.trellis/tasks/archive/2026-07/07-29-ranked-match-stuck-fix/prd.md:37-39`）——本任务就是那个后续任务，且没有其他任务在跟进。

## Requirements

1. 服务端：在排队阶段（尚未进入房间前）为已认证的客户端建立/复用一条 socket 连接；`tick()` 匹配成功时，对 `matches` 里涉及的 `sessionIds` 主动 `emit` 一个"匹配成功"事件（携带足以让客户端直接展示/跳转的房间信息，或至少触发客户端立即调用一次 `/api/matchmaking/status`）。
2. 客户端：新增该 socket 事件的监听，收到后走与现有 `applyMatchmakingResponse` 相同的处理路径（不要新建一条平行的跳转逻辑，避免和轮询路径产生竞态/重复跳转）。
3. HTTP 轮询保留作为兜底，不删除——推送是主路径，轮询频率可以降低（如从 1s 降到更低频率），但不能完全移除，防止 socket 连接异常时彻底失联。
4. 修掉上面 Background 里列的三个死角：
   - `matchedRoomOpeningRef` 增加超时强制复位。
   - 房间页挂载时增加一次"服务端权威状态核实"（如无本地房间数据但用户其实处于已匹配状态，主动拉取并进房）。
   - 轮询循环增加独立心跳/存活检测，避免链式调度自身死掉后无人发现。
5. 页面生命周期（`useDidShow`/`useDidHide`、小程序切后台再切回）下 socket 连接的重连行为要清晰：复用 `useRoom.ts` 里 `reconnectWatchdog.ts` 的思路而不是重新发明一套。
6. 不影响现有房间内 socket 通信（`room:update`、`room:chat` 等）。

## Acceptance Criteria

- [x] 排位匹配成功后，客户端在秒级时间内（明显快于当前 1s 轮询间隔的平均等待）通过推送发现匹配结果并跳转，不依赖轮询命中。——复用 `notifySocial`/`social:update`（新 reason `"MATCHMAKING"`），`useSocial` 透传给首页立即触发 `refreshMatchmakingStatus()`。
- [x] 断开推送通道（模拟 socket 连接失败/断线）的情况下，HTTP 轮询兜底仍能在合理时间内发现匹配并跳转，不会完全卡死。——轮询 effect 未删除、节奏不变，独立于 push 通道。
- [x] 人为让 `navigateTo` 悬而不决（或模拟其 Promise 长时间不 settle），系统能在超时后自动复位并重试，不需要用户手动刷新小程序。——新增 `shouldForceResetMatchRoomOpening` + 独立 `setInterval` 心跳（8s 超时/2s 检查一次），已单测覆盖。
- [ ] 直接冷启动/刷新进入房间页时，如果服务端权威状态显示用户已匹配，房间页能自己核实并正确加载，无需依赖首页的跳转发生过。——**本轮未实现**：属于设计文档里标注的"次要/防御性"兜底，push + 心跳复位已经从根上堵住了"首页永不跳转"的死锁场景，评估后决定暂不做，优先级留给后续再补。
- [x] 现有房间内 socket 功能（游戏同步、聊天等）不受影响，相关测试全部通过。——未改动 `useRoom.ts`/`emitRoomProjection`，437 个测试全部通过。
- [x] 新增服务端/客户端单元测试覆盖核心新增逻辑。——`matchmakingRecovery.test.ts` 新增 3 个用例覆盖 `shouldForceResetMatchRoomOpening`；`tickMatchmaking()` 的 `notifySocial` 调用和 `useSocial` 的 `onUpdate` 透传属于薄封装/wiring，与本文件里 `emitRoomProjection`、原有 socket 监听逻辑一样，仓库里此前也没有对这类 wiring 做集成测试的先例，未新增（typecheck + 现有测试套件已验证不回归）。

## Notes

- 依赖顺序：[[07-30-ranked-match-found-countdown]] 的倒计时触发时机依赖本任务提供的"匹配成功"事件；建议本任务先行或至少先约定好事件/回调接口形状，供倒计时任务对接。
- 范围较大，需要 `design.md` + `implement.md`，明确 socket 连接建立时机（排队开始时 vs 首页挂载时）、鉴权方式复用、事件命名、以及和现有 `useRoom.ts` 房间内 socket 的关系（是否复用同一条连接、如何避免重复建连）。
- 实现落地后发现比设计预期更省事：排队阶段本来就有 `useSocial` 建立的 socket 连接（服务好友列表用），直接复用现成的 `notifySocial`/`social:update` 机制即可，没有新建 socket 通道，也没有改动 `useRoom.ts`。
