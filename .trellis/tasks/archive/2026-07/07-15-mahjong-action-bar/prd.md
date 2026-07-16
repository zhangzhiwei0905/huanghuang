# 碰杠动作条与手牌高亮

## Goal

在不改变协议、服务端权威判定的前提下，优化 `apps/web` 牌桌的碰/杠/自摸操作体验：手牌中能碰/杠的牌要有清晰的高亮提示，且碰/明杠/暗杠/补杠/自摸从底部小按钮改为手牌上方更大更醒目的四个动作按钮（自摸/杠/碰/补杠），只在条件满足时高亮可点击。

## Background

- 现状（`apps/web/src/components/GameTable.tsx`）：`room.legalActions: string[]` 是扁平的动作类型列表，服务端不下发"哪张牌可以用于该动作"这类细粒度信息。`sendAction()` 目前对 `DECLARE_CONCEALED_KONG`/`DECLARE_ADDED_KONG` 要求先手动点选一张手牌（`selectedTile`）才能点底部按钮；`CLAIM_PONG`/`CLAIM_EXPOSED_KONG`/`CLAIM_INDICATOR_PONG_KONG`/`DECLARE_WIN` 不需要选牌，直接 `onSend(type)`。
- 调研确认：判断"哪些手牌可以碰/杠"不需要新增服务端字段，可纯前端从已有 `RoomProjection` 派生：
  - 响应阶段（`room.roundPhase === "DISCARD_RESPONSE"`）待响应的弃牌 = `currentSeat` 玩家 `discards` 数组的最后一张（游戏引擎在 `DISCARD_RESPONSE` 阶段不会切换 `currentSeat`，见 `packages/game-engine/src/round.ts` 的 `lastDiscard`/`currentSeat` 处理）。
  - 暗杠：自己手牌中某花色/点数凑满 4 张（赖子本身不能作为暗杠的原牌面，需按 `room.wildcardKind` 排除）。
  - 补杠：自己手牌中某张牌的花色/点数与自己已有的 `PONG` 组合花色/点数相同。
  - 碰/明杠/亮牌特殊碰：手牌中与待响应弃牌同花色/点数的牌（碰要 2 张，明杠要 3 张；亮牌特殊碰是碰的特例，判定方式相同，由 `legalActions` 里出现的具体动作类型区分，不需要额外规则判断）。
- 本任务只涉及 `apps/web` 前端展示/交互层，不涉及 `packages/game-engine`、`packages/protocol`、`apps/server`。

## Requirements

### R1 顶部大动作条

- 在 `self-area`（手牌区）上方新增一条固定 4 按钮的动作条：**自摸 / 杠 / 碰 / 补杠**，视觉尺寸明显大于现有 `action-dock` 里的小按钮（更高、更宽、更粗的字号）。
- 按钮与 `CommandEnvelope["type"]` 的映射：
  - 自摸 → `DECLARE_WIN`
  - 杠 → `CLAIM_EXPOSED_KONG` 或 `DECLARE_CONCEALED_KONG`（同一局面下二者互斥，不会同时合法；按钮永远只需要处理其中一个）
  - 碰 → `CLAIM_PONG` 或 `CLAIM_INDICATOR_PONG_KONG`（同样互斥）
  - 补杠 → `DECLARE_ADDED_KONG`
- 每个按钮只有在其映射的动作出现在 `room.legalActions` 中时才可点击并呈高亮/强调态；否则为置灰不可点态（`disabled`），且不响应点击。
- "杠"按钮在可点击时，按钮内的小字副标签动态显示当前具体是"明杠"还是"暗杠"（根据 `legalActions` 里实际出现的是 `CLAIM_EXPOSED_KONG` 还是 `DECLARE_CONCEALED_KONG`）；"碰"按钮同理动态显示"碰"或"亮牌碰"。主标签文字（"杠"/"碰"）始终不变。
- 点击"杠"/"碰"/"补杠"按钮时，若当前已有用户手动选中的手牌（`selectedTileId`）且该牌确实属于本次动作的合法牌，优先使用该选中牌；否则由前端自动从符合条件的手牌中选出唯一一组来源牌，拼出既有的 `onSend` payload（复用 `sendAction` 现有的 `DECLARE_CONCEALED_KONG`/`DECLARE_ADDED_KONG` payload 构造逻辑，即 `{suit, rank}` / `{meldId, tileId}`），不要求用户必须先手动点选。
- `CLAIM_PONG`/`CLAIM_EXPOSED_KONG`/`CLAIM_INDICATOR_PONG_KONG`/`DECLARE_WIN` 保持现状：不携带 tileId payload，直接 `onSend(type)`。
- 原 `action-dock`（底部动作栏）里移除这 6 个动作类型（`DECLARE_WIN`/`CLAIM_PONG`/`CLAIM_EXPOSED_KONG`/`CLAIM_INDICATOR_PONG_KONG`/`DECLARE_CONCEALED_KONG`/`DECLARE_ADDED_KONG`）对应的按钮渲染，避免重复入口；`PASS_RESPONSE`、`CONTINUE_TURN` 继续留在底部 `action-dock`。
- 现有 `hand-action-bar`（打出/放赖）位置和逻辑不变。

### R2 手牌高亮

- 只要"杠"或"碰"按钮当前处于可点击态（即对应动作合法），手牌里所有属于该动作合法来源牌组的牌都要有统一的高亮视觉（描边 + 轻微光晕，复用 `--accent` 主题色，与新动作条按钮的高亮态视觉呼应），未参与任何合法碰/杠来源的普通手牌保持原样。
- 高亮判定规则（纯前端派生，函数需可单测）：
  - 碰/明杠/亮牌特殊碰合法时：高亮手牌中与"待响应弃牌"同花色同点数的牌（碰高亮 2 张，明杠/亮牌特殊碰高亮 3 张；不足对应张数时不高亮，理论上不会出现，因为服务端已判定动作合法）。
  - 暗杠合法时：高亮手牌中凑满 4 张的那组同花色同点数的牌（若手牌中同时存在两组不同点数各凑满 4 张，两组都高亮）。
  - 补杠合法时：高亮手牌中与自己现有 `PONG` 组合同花色同点数的那张牌。
  - 高亮判定必须排除赖子（与 `room.wildcardKind` 同花色同点数的牌不参与暗杠/补杠的"凑数"判断，遵循 `晃晃.md`/父任务 PRD R2 "赖子不参与碰或任何类型的杠"的既有规则）。
- 高亮牌仍可被正常点选（`onSelect`），高亮只是视觉提示，不改变现有点选/双击出牌交互。
- 高亮状态必须在 `prefers-reduced-motion: reduce` 下依然可见（描边/颜色不是动画，只是静态强调色，不受该媒体查询影响）。

## Constraints

- 不修改 `packages/protocol`、`packages/game-engine`、`apps/server`；不新增服务端字段；一切判定仍以服务端 `legalActions` 为唯一权威——前端高亮/自动选牌只是"根据已知合法动作去猜测最可能的来源牌"，不参与也不能覆盖服务端对动作是否合法的判断。若前端自动选牌逻辑因为某种边界情况找不到匹配（理论上不应发生，因为动作已被服务端判定合法），按钮点击应仍然发出裸的 `onSend(type)`（不带 payload）而不是静默失效，让服务端按现有校验规则拒绝或处理，不允许前端在这种情况下崩溃或吞掉点击。
- 不改变现有 `SET_READY`/`DISCARD_TILE`/`RELEASE_WILDCARD`/`PASS_RESPONSE`/`CONTINUE_TURN` 的现有交互位置和逻辑。
- 保持无障碍语义：新按钮需要有清晰的 `aria-label`（说明当前具体动作，例如"暗杠"而不仅是"杠"），禁用态要有 `disabled` 属性；高亮的手牌 `aria-label` 需要补充"可碰"/"可杠"一类的可读提示，不能只靠颜色传达（沿用现有前端 spec 中"颜色不能单独传达赖子/禁用状态"的约定）。
- 触控热区不小于既有 44px 规范；新动作条在窄屏（860px 断点、矮屏横屏断点）下需要同步适配，不遮挡手牌。
- 不引入新依赖。

## Out of Scope

- `PASS_RESPONSE`、`CONTINUE_TURN`、`DISCARD_TILE`、`RELEASE_WILDCARD` 的位置/交互调整。
- 服务端 `legalActions` 结构调整或新增细粒度字段。
- 动画效果的进一步改动（复用上一任务 `07-15-mahjong-ui-polish` 已实现的碰/杠/放赖动效，本任务不重复设计）。

## Acceptance Criteria

- [ ] AC1：自摸/杠/碰/补杠四个按钮渲染在手牌上方，视觉尺寸明显大于其余动作按钮；不合法时禁用且不可点击，合法时高亮可点击。
- [ ] AC2："杠"按钮在明杠/暗杠合法时分别显示正确的动态副标签；"碰"按钮在普通碰/亮牌特殊碰合法时分别显示正确的动态副标签。
- [ ] AC3：点击杠/碰/补杠按钮无需用户先手动选牌即可正确发出合法请求（payload 与现有 `sendAction` 对 `DECLARE_CONCEALED_KONG`/`DECLARE_ADDED_KONG` 的构造方式一致）；若用户已手动选中一张属于合法来源的牌，优先用该牌。
- [ ] AC4：碰/杠合法时，手牌中对应的来源牌有统一高亮视觉，赖子不会被错误地算作暗杠/补杠的凑数牌；不合法时手牌无高亮。
- [ ] AC5：底部 `action-dock` 不再重复出现自摸/碰/明杠/暗杠/补杠/亮牌特殊碰按钮，`过`/`继续打牌` 仍在原位。
- [ ] AC6：`apps/web` 现有测试全部通过，新增的高亮/自动选牌派生逻辑有对应单元测试覆盖（含赖子排除、暗杠多组同时高亮等边界）；`pnpm lint`、`pnpm --filter @huanghuang/web build` 通过。
