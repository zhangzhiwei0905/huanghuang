# 设计：来由玩法与音效

## 判定的落点

来由的本质是「这次胡，胡的是放赖后补摸的那一张」。引擎里已有的两个事实让判定可以做得很轻：

- `releaseWildcard()` 调用 `drawFromFront()`，后者会把 `state.lastDrawnTileId` / `lastDrawSeat` 更新为新摸的牌。
- `declareWin()` 要求 `hasCurrentDrawnTile(state, seat)`，并且用 `state.lastDrawnTileId` 作为胡牌张交给 `evaluateWin()`。

所以只要记下「放赖那一摸的牌 ID + 座位」，在 `declareWin` 时比对当前 `lastDrawnTileId` 即可。任何后续摸牌（暗杠、补杠、下一巡、别人碰杠后接管）都会改写 `lastDrawnTileId`，判定自然失效，不需要额外的清理分支。

### RoundState 新增字段

```ts
laiyouCandidate: { seat: Seat; tileId: string } | null;
```

- `createRound()` 初始化为 `null`。
- `releaseWildcard()` 在 `drawFromFront()` 之后写入 `{ seat, tileId: next.lastDrawnTileId }`。`releaseWildcard` 前面已经拦掉 `wall.length === 0`，所以补摸必定成功。
- `declareWin()` 计算：

```ts
const laiyou =
  state.laiyouCandidate !== null &&
  state.laiyouCandidate.seat === seat &&
  state.laiyouCandidate.tileId === state.lastDrawnTileId;
```

`winPassedThisTurn` 的既有守卫覆盖了「过了之后再胡」的情形（AC2）：过牌后 `declareWin` 直接被拒，只有重新摸牌才能再胡，而那时 `lastDrawnTileId` 已改变。

### RoundOutcome

`WIN` 分支新增 `laiyou: boolean`。`DRAW` 不涉及。

## 倍率与结算

`calculateSelfDrawSettlement()` 增加入参 `laiyou: boolean`：

```ts
const laiyouMultiplier = options.laiyou ? 2 : 1;
amount = baseScore × winMultiplier × laiyouMultiplier × winnerMultiplier × payerMultiplier;
```

`assertZeroSum` 保持不动：赢家 delta 仍是三家支付之和，乘一个公共系数不破坏零和。

倍率上限校验：来由必然发生在至少放过一次赖之后，赢家 `personalMultiplier ≥ 2`，最大 16；硬胡 2 × 16 × 2 = 64，与父任务 PRD 的「32 → 64」一致。

## 协议

`packages/protocol/src/projections.ts`：

```ts
export type RoundSettlementProjection = {
  // ...既有字段
  laiyou: boolean;                    // DRAW 时为 false
  laiyouMultiplier: 1 | 2 | null;     // WIN 时为 1 或 2，DRAW 时 null
};

export type GameEffectCue = {
  // ...既有字段
  laiyou: boolean;                    // 非 WIN 动作恒为 false
};
```

`RoomProjection.roundOutcome` 的 `WIN` 分支新增 `laiyou: boolean`。`winBaseMultiplier` 语义不变，仍只表示胡型基础倍率（1|2），来由倍率单独一项，便于结算界面拆解展示。

`schemaVersion` 由 `7` 提升到 `8`（前置任务 `07-27-score-reset-on-full-table` 已把 6 提到 7；若本任务先落地则为 6 → 7）。

## 服务端

`apps/server/src/room-service.ts`：

- `EffectDescriptor` 类型扩展为 `Pick<GameEffectCue, "action" | "actorSeat" | "tileKind" | "winType" | "laiyou">`。
- `detectEffectDescriptor()` 中副露与放赖候选补 `laiyou: false`；`WIN` 候选取 `next.outcome.laiyou`。
- `project()` 的 `roundSettlement` 补 `laiyou` 与 `laiyouMultiplier`，`roundOutcome` 的 WIN 分支补 `laiyou`。
- 局内状态兼容：现有 `ensureStartingScores(round)` 已经在做这类补默认值的工作，扩展为 `normalizeRoundState(round)`，同时补 `laiyouCandidate ??= null` 与 `outcome.kind === "WIN"` 时 `outcome.laiyou ??= false`。两个调用点（`persisted.round` 与 `pendingEffectTransition.nextRound`）都要覆盖。
- 机器人不改：`botTurnDecision` 在 `DECLARE_WIN` 可用时直接胡，来由自然计入。

## 小程序音效

`apps/miniprogram/src/lib/gameAudioEvents.ts` 把散落的两处三元判断收敛成映射表：

```ts
const WIN_AUDIO_FILE: Record<WinType, GameAudioFileName> = {
  HARD: "yinghu.mp3",
  SOFT: "ruanhu.mp3",
};

// 来由音效目前复用硬胡/软胡音频。拿到专用音频后，只需把这里换成
// 新文件名，并在 gameAudioPlayer.ts 的 AUDIO_WINDOWS 补对应播放窗口。
const LAIYOU_AUDIO_FILE: Record<WinType, GameAudioFileName> = {
  HARD: "yinghu.mp3",
  SOFT: "ruanhu.mp3",
};

function winAudioFileName(winType: WinType | null, laiyou: boolean): GameAudioFileName {
  const table = laiyou ? LAIYOU_AUDIO_FILE : WIN_AUDIO_FILE;
  return table[winType ?? "SOFT"];
}
```

`effectAudioFileName()` 的 `WIN` 分支和 `detectGameAudioFiles()` 的结算兜底分支都改成调用 `winAudioFileName()`，分别传 `cue.laiyou` 与 `settlement.laiyou`。

因为文件名集合没有变化，`AUDIO_WINDOWS` 与 `cloudAudio` 预加载列表不需要改，也不会出现「新文件名缺播放窗口」的运行时问题。重复播放的抑制完全沿用现有的 `completingEffect` 逻辑（cue 出现时播一次，cue 结束时抑制状态 diff），本任务只改「播哪个文件」，不改「什么时候播」，因此 R8 由既有机制保证。

## 客户端展示

两端结算弹窗当前用同一套派生逻辑，改动对称：

- Web：`apps/web/src/components/GameTable.tsx` 内的 `RoundSettlementModal`。
- 小程序：`apps/miniprogram/src/components/RoundSettlementModal.tsx` + `.scss`。

改动点：

1. `outcomeLabel`：`WIN` 且 `laiyou` 时文案为 `硬来由` / `软来由`，否则维持 `硬胡` / `软胡`。
2. `outcomeClass`：来由追加修饰类（Web `is-laiyou`，小程序同名），样式上给一个更强的强调，不替换既有 `is-hard-win` / `is-soft-win`。
3. 在结算头部的 meta 区展示来由倍率来源，例如 `来由 ×2`，仅当 `laiyou` 为真时渲染。

两端都只读投影字段，不做规则判定，符合 `frontend/index.md` 的「web 只是 projection renderer」。

## 风险

- `PersonalMultiplier` 类型（`1|2|4|8|16`）不受影响：来由倍率不写回 `personalMultiplier`，只作用于结算金额，所以不需要放宽该联合类型。
- `winBaseMultiplier: 1 | 2` 语义保持不变，避免旧客户端把总倍率读错。
- 需要同步更新的夹具：`apps/server/src/room-service.test.ts`、`apps/miniprogram/src/lib/gameAudioEvents.test.ts`、`apps/miniprogram/src/lib/roomProjection.test.ts`、Web 端结算相关测试（若有硬编码 settlement 夹具）。
