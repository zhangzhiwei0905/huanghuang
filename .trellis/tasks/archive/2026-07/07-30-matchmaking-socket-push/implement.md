# 执行计划：排位匹配成功 socket 推送 + 卡死兜底

## 步骤

1. **服务端推送**：`apps/server/src/index.ts` 的 `tickMatchmaking()` 里，`matchmaking.tick()` 返回后，若 `result.changedSessionIds.length > 0` 调用 `notifySocial(result.changedSessionIds, "MATCHMAKING")`。
2. **`useSocial` 透传 reason**：`apps/miniprogram/src/hooks/useSocial.ts` 加可选的 `onUpdate?: (reason: string) => void` 参数，`handleUpdate` 里既 `refresh()` 也把 reason 转发出去（用 ref 存回调，避免进入 effect 依赖数组）。
3. **首页接线**：
   - 把 371-401 行轮询 effect 里"拉状态 + 应用响应 + 错误处理"这段抽成一个稳定引用的函数（`refreshMatchmakingStatus`）。
   - 轮询 effect 改为调用这个抽出来的函数，行为不变（链式 setTimeout + `nextMatchmakingPollDelayMs` 动态延迟保留）。
   - `useSocial(identityState === "loggedIn" && identity !== null, (reason) => { if (reason === "MATCHMAKING") void refreshMatchmakingStatus(); })`。
4. **`matchedRoomOpeningRef` 超时兜底**：
   - 新增 `matchedRoomOpeningSinceRef`，在 `applyMatchmakingResponse` 设置 `matchedRoomOpeningRef.current = true` 的同时记录时间戳。
   - 新增一个独立的 `setInterval` 心跳 effect（每 2s，`matchmaking.status !== "IDLE"` 时启用），超过 8s 未复位就强制清空 `matchedRoomOpeningRef`/`matchedRoomOpeningSinceRef`/`openedMatchRoomKeyRef` 并立即 `refreshMatchmakingStatus()` 重试。
5. **（可选，视时间预算）房间页兜底核实**：`pages/room/index.tsx` 挂载读取到 `huanghuang_open_room` 的路径上，额外拉一次 `competitiveApi.status()` 核对，不一致则以服务端为准。
6. **测试**：
   - 服务端：`apps/server/src/index.test.ts`（如果存在覆盖 `tickMatchmaking`/socket 的测试文件；否则在 matchmaking 相关测试里新增）验证匹配成功后 `notifySocial`/对应 socket 事件被触发一次，且只对 `changedSessionIds` 里的 session 触发。
   - 客户端：`useSocial` 新增测试覆盖"收到 `social:update` 时正确调用 `onUpdate(reason)`"；`index/index.tsx` 相关的纯函数（若抽出到 `matchmakingRecovery.ts` 一类的文件）新增测试覆盖"心跳超时后正确复位并允许重试"逻辑。
   - 回归：现有 `matchmakingRecovery.test.ts`（如果存在）、`useRoom` 相关测试、房间内 socket 功能（`room:update`/`room:chat`）不受影响。
7. 手动验证（真机/开发者工具）：
   - 正常匹配路径：确认从"排队"到"进房"的耗时相比原先 1s 轮询间隔有明显缩短（应接近服务端 tick 间隔）。
   - 断网模拟：开发者工具里模拟 socket 连接失败，确认轮询兜底仍能在几秒内发现匹配并跳转。
   - 卡死复现：人为让 `matchedRoomOpeningRef` 保持 true（可临时注释掉 `.finally()` 复位来测试，测试后记得改回来/或在测试文件里直接单测这段纯逻辑），确认 8s 后自动复位并重试成功进房，无需手动刷新小程序。

## 验证命令

```bash
cd apps/server && npm test
cd apps/miniprogram && npm test
```

## 回滚点

- 步骤 1（服务端推送）与步骤 2-4（客户端）可以分两个 commit，任一出问题都能独立 revert，互不影响对方是否生效（客户端即使推送不生效，轮询兜底和心跳复位仍然独立工作）。
