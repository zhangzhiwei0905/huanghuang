# 来由玩法与音效

父任务：`07-27-laiyou-and-score-reset`

## Goal

新增「来由」玩法分类：放赖子之后摸的那张牌直接构成胡牌即为来由，最终倍率再 ×2，并在两端结算展示，小程序播放来由音效（暂复用硬胡/软胡音频）。

## 背景事实（已核对代码）

- 「放赖」= `releaseWildcard()`（`packages/game-engine/src/round.ts`）：从手牌移出一张赖子，`personalMultiplier *= 2`，立刻 `drawFromFront()` 补摸一张，并把 `winPassedThisTurn` 重置为 `false`，玩家仍处于 `TURN_DECISION`。
- 胡牌判定 `evaluateWin()`（`win.ts`）已经保证「手牌里赖子超过一张不能胡」（`TOO_MANY_WILDCARDS`），并区分 `HARD`（不需要赖子代牌）与 `SOFT`（赖子作代牌）。
- 现有倍率：`calculateSelfDrawSettlement()` = `baseScore × (HARD?2:1) × 赢家 personalMultiplier × 付家 personalMultiplier`，并用 `assertZeroSum` 守零和。
- 引擎目前只有自摸结算，没有点炮结算，所以来由只需接入自摸路径。
- 代码里赖子叫 `wildcard`，没有任何「来由 / laiyou」概念。
- 小程序音效：`apps/miniprogram/src/lib/gameAudioEvents.ts` 的 `effectAudioFileName()` 对 `WIN` 按 `winType` 返回 `yinghu.mp3` / `ruanhu.mp3`，并在结算兜底分支重复同一映射；`gameAudioPlayer.ts` 的 `AUDIO_WINDOWS` 为每个文件名配了播放窗口。
- **Web 端没有任何音效层**（`apps/web` 下不存在音频模块），因此本任务 Web 只做结算展示。

## Requirements

- R1. 来由判定：玩家执行放赖后摸到的那张牌，在该玩家本次行动内直接宣告胡牌成功，即为来由。判定由服务端引擎完成。
- R2. 来由分类沿用胡型：结果为硬胡即硬来由，软胡即软来由。
- R3. 来由让本局最终倍率再 ×2，与放赖倍率叠加：`baseScore × 胡型基础倍率 × 2^放赖次数 × 2 × 付家倍率`。理论最高倍率从 32 提升到 64。
- R4. 结算必须保持零和（`assertZeroSum` 不抛错）。
- R5. 来由信息通过投影下发，客户端不得自行判定来由或倍率。
- R6. Web 与小程序结算弹窗都展示「硬来由 / 软来由」以及来由 ×2 的倍率来源，两端语义一致。
- R7. 小程序为来由播放独立语义事件，当前映射到 `yinghu.mp3` / `ruanhu.mp3`，替换成专用音频时只需改一张映射表。
- R8. 不出现重复播放或漏播：来由只走 `effectCue` 与结算兜底中的一条，沿用现有 `completingEffect` 抑制机制。
- R9. 历史房间快照（局内状态不含来由字段）能正常反序列化，字段有兼容默认值。

## 已确认的判定边界

| 情形 | 判定 |
|---|---|
| 放赖 → 摸牌 → 立刻胡 | 来由，类型取该次胡的 `winType` |
| 放赖 → 摸牌 → 选择「过」(`CONTINUE_TURN`) → 之后再胡 | 不是来由（`winPassedThisTurn` 已阻止本轮再胡，后续胡牌的摸牌来源已改变） |
| 放赖 → 摸牌 → 再放一次赖 → 摸牌 → 胡 | 来由（以最后一次放赖后摸的牌为准） |
| 放赖 → 摸牌 → 暗杠/补杠后摸牌 → 胡 | 不是来由（胡的不再是放赖那一摸） |
| 手上原有 2 张赖子，放掉 1 张后摸牌构成硬胡（手上仍留 1 张赖子当本牌用） | 硬来由（用户已确认） |

最后一行经用户确认：判定硬胡的本质是「赖子没有替代别的牌，而是作为它自己的牌面参与构型」，这正是引擎 `winType === "HARD"` 的含义，所以手上还留着赖子不影响硬来由的成立。不要在 `winType` 之上再叠加「手牌不含赖子」的条件。

## 非目标

- 不替换实际来由音频文件，只预留映射表位置。
- 不给 Web 端新建音效层。
- 不改动放赖操作本身的时机与合法性规则，不改动机器人决策策略（机器人可胡即胡，天然能吃到来由）。
- 不改动听牌提示 `tingHints` 的倍率（听牌提示面向弃牌规划，与放赖摸牌路径无关）。

## Acceptance Criteria

- [ ] AC1. 引擎单测：构造放赖后摸牌即可胡的局面，`declareWin` 的 outcome 标记为来由，且 `winType` 与来由类型一致。
- [ ] AC2. 引擎单测：放赖摸牌后先「过」再走到下一次胡，outcome 不标记来由。
- [ ] AC3. 结算单测：同一局面下来由的每家支付额恰好是非来由的 2 倍；最高倍率组合（硬胡 + 16 倍 + 来由）等于 64 × baseScore，且零和成立。
- [ ] AC4. 投影包含来由字段，`RoundSettlementProjection` 能表达来由与其倍率贡献。
- [ ] AC5. 小程序音效单测：来由胡的 `effectCue` 解析出来由音效文件；非来由胡仍为原 `yinghu.mp3` / `ruanhu.mp3`；同一次胡不产生重复文件。
- [ ] AC6. Web 与小程序结算弹窗渲染「硬来由 / 软来由」文案与来由倍率标记。
- [ ] AC7. 缺少来由字段的历史局内状态经反序列化后不报错、不误判为来由。
- [ ] AC8. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。

## Notes

- 与 `07-27-score-reset-on-full-table` 共同接触 `apps/server/src/room-service.ts` 的 `project()` 与 `packages/protocol/src/projections.ts`。硬耦合只有 `schemaVersion`：清零任务先落地把它提到 7，本任务随后提到 8。
