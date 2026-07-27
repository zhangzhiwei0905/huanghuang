# 执行计划：来由玩法与音效

前置：`07-27-score-reset-on-full-table` 已落地（`schemaVersion` 已是 7）。若未落地，本任务把 6 提到 7 并在 PRD Notes 记录。

## 顺序清单

- [ ] 1. 引擎：`packages/game-engine/src/settlement.ts`
  - [ ] 1.1 `calculateSelfDrawSettlement` 增加 `laiyou: boolean` 入参并乘入金额。
- [ ] 2. 引擎：`packages/game-engine/src/round.ts`
  - [ ] 2.1 `RoundState` 新增 `laiyouCandidate`，`createRound()` 初始化为 `null`。
  - [ ] 2.2 `RoundOutcome` 的 `WIN` 分支新增 `laiyou: boolean`。
  - [ ] 2.3 `releaseWildcard()` 在补摸后写入 `laiyouCandidate`。
  - [ ] 2.4 `declareWin()` 计算 `laiyou`，传入结算并写进 outcome。
- [ ] 3. 协议：`packages/protocol/src/projections.ts`
  - [ ] 3.1 `RoundSettlementProjection` 新增 `laiyou` / `laiyouMultiplier`。
  - [ ] 3.2 `GameEffectCue` 新增 `laiyou`。
  - [ ] 3.3 `RoomProjection.roundOutcome` 的 WIN 分支新增 `laiyou`，`schemaVersion` 提到 `8`。
- [ ] 4. 服务端：`apps/server/src/room-service.ts`
  - [ ] 4.1 `EffectDescriptor` 扩展，`detectEffectDescriptor()` 各候选补 `laiyou`。
  - [ ] 4.2 `ensureStartingScores` 扩展为 `normalizeRoundState`，补 `laiyouCandidate` 与 `outcome.laiyou` 默认值，两个调用点都覆盖。
  - [ ] 4.3 `project()` 的 `roundSettlement` / `roundOutcome` 输出来由字段，`schemaVersion` 改 `8`。
- [ ] 5. 小程序音效：`apps/miniprogram/src/lib/gameAudioEvents.ts`
  - [ ] 5.1 引入 `WIN_AUDIO_FILE` / `LAIYOU_AUDIO_FILE` 映射表与 `winAudioFileName()`。
  - [ ] 5.2 `effectAudioFileName()` 与 `detectGameAudioFiles()` 结算兜底分支改用该函数。
- [ ] 6. 结算展示
  - [ ] 6.1 Web `apps/web/src/components/GameTable.tsx`：来由文案 + 修饰类 + `来由 ×2` 标记（含样式）。
  - [ ] 6.2 小程序 `apps/miniprogram/src/components/RoundSettlementModal.tsx` + `.scss`：同语义改动。
- [ ] 7. 测试
  - [ ] 7.1 `packages/game-engine/src/round.test.ts`：放赖后摸牌即胡 → 来由；先「过」再胡 → 非来由；暗杠摸牌后胡 → 非来由。
  - [ ] 7.2 `packages/game-engine/src/settlement.test.ts`：来由支付额是非来由的 2 倍；硬胡 + 16 倍 + 来由 = 64 × baseScore；零和成立。
  - [ ] 7.3 `apps/server/src/room-service.test.ts`：投影输出来由字段；缺字段的历史局内状态反序列化后 `laiyou` 为 `false`；`schemaVersion` 断言改 8。
  - [ ] 7.4 `apps/miniprogram/src/lib/gameAudioEvents.test.ts`：来由 cue 的音效解析；非来由保持原文件；同一次胡不重复。
  - [ ] 7.5 更新其余 `schemaVersion` / settlement 夹具（`roomProjection.test.ts`、Web 结算相关测试）。
- [ ] 8. 验证命令全绿。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 审查关口

- 步骤 2 完成后先跑 `pnpm test -- game-engine`，确认既有 round / settlement / bot 测试没有回归，再往协议和客户端推进。
- 步骤 5 完成后确认 `AUDIO_WINDOWS` 覆盖了所有 `GameAudioFileName` 成员（类型是 `Record<GameAudioFileName, AudioWindow>`，缺项会直接 typecheck 失败，这是有意保留的护栏）。

## 回滚点

- 引擎 + 协议（步骤 1-3）是一组；服务端投影（步骤 4）依赖它。
- 音效（步骤 5）与展示（步骤 6）互相独立，可单独回滚而不影响规则正确性。
