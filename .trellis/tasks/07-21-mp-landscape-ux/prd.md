# 小程序横屏体验优化

## Goal

小程序牌桌页（`apps/miniprogram/src/pages/room/index.tsx`）横屏体验参照 Web 端（`apps/web/src/components/GameTable.tsx` + `apps/web/src/styles.css`）对齐，解决操作按钮位置/大小/可点性、弃牌展示位置、以及横屏沉浸感四类问题，让玩家能清楚看到"能做什么操作"和"场上发生了什么"。

## Background（已确认事实）

- 小程序牌桌页固定横屏（`src/pages/room/index.config.ts:6` `pageOrientation: "landscape"`），不存在竖屏态，无需 orientation 媒体查询。
- 当前操作按钮渲染在 `ActionDock`（`src/components/ActionDock.tsx`），作为 `table-surface` 的**兄弟节点、且在其后**渲染（`src/pages/room/index.tsx:324`），视觉上位于整个牌桌（含自己手牌）**下方**，而不是紧贴手牌上方。
- 按钮的"按条件出现"逻辑其实已经实现：`primaryActionButtons(room.legalActions)`（`src/lib/actionButtons.ts:45-75`）只在服务端下发对应 `legalAction` 时才生成按钮（如 `CLAIM_PONG` 合法时才有"碰"）。问题是**展示位置**，不是资格判断逻辑。
- `ActionDock__btn` 目前是 `View`（非原生 `Button`），本身无原生边框问题（`src/components/ActionDock.tsx:26`）；但页面内其余交互控件（`header-btn`、`btn-accent`、`btn-ghost`、`score-chip` 等，`index.tsx:133/147/160/165/184/210/222/225/328`）用的是 Taro `<Button>`，小程序原生 `button` 默认带 `::after` 伪元素边框（灰色 hairline 矩形），且全局样式里没有任何 `button::after { border: none }` 重置（已用 grep 确认 `src` 下无匹配）。这解释了"点击时出现长方形边框"的问题来源。
- 弃牌区 `discard-zone`（`index.scss:401-442`）用固定 vmin 值贴边定位（如 `pos-left { left: calc(22vmin + ...) }`），未以牌桌中心 `table-center`（`top:46%; left:50%`，`index.scss:355-365`）为基准做环形排布，四个方位的锚点互相独立、没有统一的中心参照系，容易出现间距不一致、和 `player-station`/`self-hand` 打架的观感。Web 端对应实现（`apps/web/src/styles.css:910-935`）用 `top:50%; left:50%` + `translate()` 统一以牌桌中心为基准做四方位偏移，视觉上明显是"从中心向四周展开"。
- Web 端横屏窄高（`@media (max-height:500px) and (orientation:landscape)`, `styles.css:1516` 起）做法是**收缩** header/dock 高度和内部元素尺寸，而不是整体去掉背景色块；本次小程序需求是更激进的方案——横屏下 `game-header` 和 `action-dock` 的半透明背景条整体去掉，背景图铺满全屏，"离开"从 header 内的普通按钮改为独立悬浮按钮。这是小程序特有的产品决策，不是简单抄 Web CSS。
- Web 端的 `primary-action-button` 样式（`styles.css:957-1044`）是本次"圆角按钮、点击不出现矩形边框"的直接参照：`border:0`、`border-radius:26% / 50%`、`-webkit-tap-highlight-color: transparent`、`:focus-visible` 时用 `::before` 内描边而不是浏览器默认 outline。

## Requirements

### R1 操作按钮位置与呈现
- 将玩家操作按钮（出牌/碰/杠/补杠/自摸/过/放赖）从"牌桌下方独立一条"改为**紧贴自己手牌上方**，参照 Web `self-area` 内 `PrimaryActionBar` 在 `hand-composition` 之上的结构（`GameTable.tsx:1093-1103`）。
- 按钮继续复用现有 `primaryActionButtons(room.legalActions)` 的资格过滤逻辑（无需改 `actionButtons.ts`）——按钮本来就只在对应操作合法时出现，这次只调整**位置和视觉**。
- 按钮尺寸需比当前 `action-dock__img`（`10.5vmin`，min 44px/max 64px，`ActionDock.scss:44-51`）更醒目、更易点按，同时不能遮挡手牌。

### R2 各方弃牌展示
- 四个方位的弃牌区改为以 `table-center` 为统一基准做环形定位（上/下/左/右），弃牌牌面要清晰可辨（花色、数字），而不是当前贴边小方块堆叠。
- 保留"只显示最近若干张"的现有截断逻辑（`index.tsx:299` `discards.slice(-8)`），具体张数可按新布局空间调整。

### R3 横屏沉浸感
- 横屏下移除 `game-header`（`index.scss:56-71`）与 `action-dock`（`ActionDock.scss:2-18`）的半透明背景条／分隔线，让 `game-shell__bg` 背景图铺满整个屏幕（`index.tsx:143`）。
- "离开游戏"从 header 内的常规按钮（`index.tsx:147-149`）改造为独立的悬浮圆角按钮（类似平台通用的返回/退出按钮位置，如左上角悬浮），不再占用一条完整的头部条。
- 房间信息（房号/底分/机器人模式等，目前在 `game-header` / `game-meta`，`index.tsx:150-173`）需要一个新的、不依赖整条不透明背景条的呈现方式（如浮动信息胶囊），避免信息丢失。
- `WAITING`（等待开局）阶段的 `waiting-panel`（`index.scss:136-158`）不在本次沉浸感改造范围内，可保留卡片式背景，因为该阶段没有牌桌背景遮挡问题。

### R4 按钮点击态样式
- 全局重置小程序原生 `button` 的默认边框/态：去掉 `button::after` 的原生矩形描边、去掉点击时的灰色蒙层和 tap-highlight。
- 所有可点击的操作类控件（header 按钮、准备/离开/解散、底分选择、操作按钮等）在点击时呈现为**圆角**反馈（背景色变化或轻微缩放),不得出现长方形描边。
- 具体做法可以是：(a) 全局对 `button::after` 做 reset，配合各按钮已有的 `border-radius`；或 (b) 已经是 `View` 的元素（如 `ActionDock__btn`）保持现状即可。以现有代码里同时存在 `Button` 和 `View` 两种实现为约束，方案要覆盖两者。

## Out of Scope

- 不改变 `legalActions` 判定逻辑、`actionEligibility.ts`、`handInteraction.ts` 等游戏规则代码。
- 不新增操作类型或改变服务端协议。
- `WAITING` 大厅卡片式布局、`ROUND_RESULT` 结算浮层暂不在本次改造范围（除非因为 header/dock 结构调整必须联动修改引用处）。
- 不引入新的第三方 UI 库；沿用现有 Taro + SCSS 方案。
- 动效/动画（如 Web 端弃牌落下动画）不是本次重点，允许后续单独立项。

## Acceptance Criteria

- [ ] 操作按钮渲染在自己手牌上方（DOM 结构与视觉位置均在 hand 之上），且仅在对应 `legalActions` 命中时出现，按钮可点区域比现状明显更大。
- [ ] 四个方位弃牌区以牌桌中心为基准环形排布，牌面在横屏下清晰可辨认（花色数字不糊/不重叠）。
- [ ] 横屏下 `game-header`、`action-dock` 的半透明背景条消失，背景图铺满整屏；"离开游戏"是独立悬浮按钮，可正常触发 `roomCtrl.leaveRoom()`。
- [ ] 房号/底分/连接状态等原 header 信息在新布局下仍可见（形式可变，如浮动信息胶囊）。
- [ ] 出牌/碰/杠等所有可点击按钮，点击时不出现原生矩形边框，呈现圆角反馈；`Button` 与 `View` 两类实现都覆盖到。
- [ ] `WAITING` 等待开局阶段、`ROUND_RESULT` 再来一局按钮功能不受影响（除非该阶段确实需要联动调整）。
- [ ] `pnpm --filter miniprogram build`（或仓库对应的 lint/typecheck/build 命令）通过。
- [ ] 用微信开发者工具（或等效方式）实机/模拟器验证横屏牌桌页在有/无可用操作两种状态下的视觉效果。
