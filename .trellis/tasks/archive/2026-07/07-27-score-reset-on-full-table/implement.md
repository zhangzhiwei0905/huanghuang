# 执行计划：4人满座积分清零重算

## 顺序清单

- [ ] 1. `packages/protocol/src/projections.ts`：`RoomProjection` 新增 `scoreResetPending: boolean`，`schemaVersion` 从 `6` 改为 `7`。
- [ ] 2. `apps/server/src/room-service.ts`：
  - [ ] 2.1 `RoomState` 与 `PersistedRoomState` 新增 `fullTableScoreResetDone`（持久化侧为可选）。
  - [ ] 2.2 `createRoom()` 初始化为 `false`（`BOT` 模式在随后的 `startRound()` 里自然被置为 `true`）。
  - [ ] 2.3 `normalizeRoom()` 两个分支补默认值，按 design 的保守推断。
  - [ ] 2.4 `startRound()` 开头加入清零 + 标记维护，位置在 `createRound()` 之前。
  - [ ] 2.5 `project()` 返回 `scoreResetPending`，并把 `schemaVersion` 改成 `7`。
- [ ] 3. `apps/web/src/components/GameTable.tsx`：等待视图渲染清零提示（含必要样式，参照现有等待区 class 命名）。
- [ ] 4. `apps/miniprogram/src/pages/room/index.tsx`：`lobby-stage` 渲染同语义提示（含 `.scss`）。
- [ ] 5. 更新投影夹具中的 `schemaVersion`：
  - [ ] `apps/server/src/room-service.test.ts`（`expect(projection.schemaVersion).toBe(6)`）
  - [ ] `apps/miniprogram/src/lib/gameAudioEvents.test.ts`
  - [ ] `apps/miniprogram/src/lib/roomProjection.test.ts`（保持 legacy schema 5 用例语义不变）
- [ ] 6. 新增服务端测试（`apps/server/src/room-service.test.ts`）：
  - [ ] 6.1 机器人补位好友房打完一局 → 旁观真人顶替机器人 → 四人 ready → `startingScores` 全 0、`room.scores` 全 0、`scoreResetPending` 回到 `false`。
  - [ ] 6.2 全真人房第二局保留累计分。
  - [ ] 6.3 `normalizeRoom` 对缺字段快照的默认值（有机器人座位 → `true`；全真人 → `false`）。
  - [ ] 6.4 全真人满座等待时 `project().scoreResetPending === true`。
- [ ] 7. 验证命令全绿。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 审查关口

- 步骤 2.4 完成后先只跑 `pnpm test -- room-service`，确认既有的 `keeps seats and scores` 与 `keeps cumulative scores` 两条用例仍然通过，再继续前端改动。
- 前端提示不得自行计算是否清零，只读 `scoreResetPending`。

## 回滚点

- 步骤 1-2 是服务端 + 协议改动，可独立回滚；前端提示（步骤 3-4）是纯增量渲染，单独回滚不影响服务端行为。
