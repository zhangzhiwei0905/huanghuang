# 设计：排位赛卡死修复与韧性

## 边界与契约

- 不改变 `POST /api/matchmaking/queue`、`DELETE /api/matchmaking/queue`、`GET /api/matchmaking/status`、`POST /api/competitive/matches/:matchId/acknowledge` 的请求/响应契约
- 不引入 socket 事件推送（明确排除在本轮之外）

## 修复点 A：首页 `returnToCompetitiveMatch` 状态不回写

`apps/miniprogram/src/pages/index/index.tsx:358`：

```ts
// 当前
} catch (cause) {
  setMatchmakingError(describeSubmitError(cause));
}
// 改为：先尝试用已拿到的 response 更新 matchmaking state，再报错
} catch (cause) {
  if (response !== undefined) applyMatchmakingResponse(response);
  setMatchmakingError(describeSubmitError(cause));
}
```

同时：
- 首页补 `Taro.useDidShow`，从房间页 `reLaunch` 回首页时强制重新拉一次 `/api/matchmaking/status`
- 轮询 effect（`index/index.tsx:295`）的 early-return 条件去掉对 MATCHED 状态的排除，MATCHED 且非托管也定期轮询确认房间是否仍然存在

## 修复点 B：空壳页 `navigateBack()`

`apps/miniprogram/src/pages/room/index.tsx:635`：`Taro.navigateBack()` → `Taro.reLaunch({ url: "/pages/index/index" })`。这是纯粹的导航方式修正，无状态影响。

## 修复点 C：`useRoom` 丢弃结算数据

`apps/miniprogram/src/hooks/useRoom.ts:96-103`：当前 `status === "CLOSED"` 时整体清空。改为：保留最后一次非 null 的 `room.competitiveMatch` 和 `roundSettlement` 到一个新的 `lastSettlement` state，供空壳页在 room 为 null 时仍能展示"继续匹配/回主页"按钮并携带 matchId。

## 修复点 D：结算阶段离开不 ack

`apps/miniprogram/src/pages/room/index.tsx:589` `leaveCurrentRoom`：当 `room.stage === "ROUND_RESULT"` 且 `room.mode === "MATCH"` 时，先 `await competitiveApi.acknowledge(matchId)` 再执行原有的 leave + reLaunch 流程，避免服务端仍判定 `hasActiveCompetitiveMatch` 为真。

## 韧性加固

1. **`allowBots` 持久化**：`matchmaking_entries` 表新增 `allow_bots INTEGER NOT NULL DEFAULT 0` 列（走现有 `database.ts:319-336` 的 try/catch ALTER 模式）。`upsertMatchmakingEntry` 写入时带上该值；`MatchmakingService` 读取时优先查 DB，内存 Map 作为热路径缓存（写穿透）。
2. **建局冲突判别**：新增 `class CompetitiveMatchCreationConflictError extends Error`，`database.ts:823` 附近的 "deleted !== 4" 分支 throw 该类型；`matchmaking-service.ts:299-311` 的 catch 改为 `instanceof CompetitiveMatchCreationConflictError` 判断，其余错误照常向上抛出（不再吞掉未知错误）。
3. **心跳超时**：`MATCHMAKING_HEARTBEAT_TIMEOUT_MS` 从 `3_000` 改为 `8_000`（`matchmaking-service.ts:7` 附近）。

## 权衡

- 不做 socket 推送重构：修复点已能解决"卡死"，socket 化是体验优化而非阻塞修复，控制本轮改动面
- `lastSettlement` 的生命周期需要在离开房间/进入新房间时清空，避免脏数据污染下一局——在 `leaveRoom`/`clearLocalRoom` 调用点一并清理

## 兼容性

- `allow_bots` 列走 ALTER 增量迁移，默认值 0，向后兼容旧行
- 前端状态改动均为纯 UI 层修复，不影响协议 schema
