# 排位赛卡死修复与韧性

父任务：`07-29-five-track-optimizations`。完整分析见 `/Users/zhang/.claude/plans/plan-1-2-federated-bunny.md` 第二节。

## Goal

排位赛打完一局后偶发卡死，点不了"回主页"或"继续匹配"。修复已定位的四个卡死点，并加固匹配机制的韧性（断线/重启/建局冲突场景）。

## Requirements

修复以下四个已定位的卡死点：

- **A**（首要嫌疑）`returnToCompetitiveMatch`（`apps/miniprogram/src/pages/index/index.tsx:358`）：`room === null` 时抛出但不回写已拿到的新 state，导致按钮永久卡在"返回对局"
- **B** 空壳页（`apps/miniprogram/src/pages/room/index.tsx:635`）用 `navigateBack()`，但进入路径是 `reLaunch`，页面栈只有 1 页 → no-op
- **C** `useRoom.ts:96` 收到房间 `CLOSED` 立即把 room 置 null，结算弹窗连同 `matchId` 一起消失
- **D** `leaveCurrentRoom`（`apps/miniprogram/src/pages/room/index.tsx:589`）在结算阶段点"离开"不 ack，回首页被判定 MATCHED 弹回房间，形成循环

同时加固：

- `allowBots` 偏好落库，消除服务重启后内存态丢失
- 建局并发冲突改用错误码/自定义 Error 类型判别，不再依赖字符串匹配错误信息
- 心跳超时阈值从 3s 放宽，容忍正常网络抖动

## Acceptance Criteria

- [ ] A：首页 catch 分支回写 matchmaking state；首页补 `useDidShow` 重新拉状态；MATCHED 状态下也纳入轮询
- [ ] B：空壳页出口改为 `Taro.reLaunch({ url: "/pages/index/index" })`
- [ ] C：`useRoom` 收到 CLOSED 保留最后一份结算快照（含 matchId），不随 room 一起清空
- [ ] D：`ROUND_RESULT` 阶段点"离开"先 ack 再 reLaunch
- [ ] `allowBots` 偏好持久化到 `matchmaking_entries` 表（迁移走现有 ALTER 增量模式）
- [ ] 建局冲突用自定义 Error 子类判别，移除 `message.includes(...)` 字符串匹配
- [ ] 心跳超时从 3s 调整为 8s（`MATCHMAKING_HEARTBEAT_TIMEOUT_MS`）
- [ ] 新增/更新前端与服务端测试覆盖以上四个修复点
- [ ] `pnpm test` 全绿，typecheck 通过
- [ ] 真机验证：跑完整一局 bot 排位赛，"继续匹配""回主页""结算中途退出重进"三条路径均可正常操作

## Out of Scope（本轮不做）

- 匹配状态改为 socket 推送（当前是 HTTP 轮询，`tick()` 的 `changedSessionIds` 被丢弃）—— 属于架构改动，作为后续独立任务
- 多实例水平扩展支持

## Notes

- 关键文件：`apps/miniprogram/src/pages/index/index.tsx`、`pages/room/index.tsx`、`hooks/useRoom.ts`、`apps/server/src/matchmaking-service.ts`、`database.ts`
- 修复顺序建议：先 A（最可能是用户遇到的问题）→ D → C → B，四者可分别提交验证
