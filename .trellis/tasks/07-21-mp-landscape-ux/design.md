# 设计：小程序横屏体验优化

## 范围与边界

- 只改 `apps/miniprogram/src/pages/room/index.tsx`、`index.scss`、`src/components/ActionDock.tsx`、`ActionDock.scss`，以及新增一个全局按钮 reset（放在 `src/app.scss` 或等效全局样式入口，需现场确认该文件是否存在，不存在则新建）。
- 不改 `src/lib/actionButtons.ts`、`actionEligibility.ts`、`handInteraction.ts`（资格判断逻辑不变，只挪展示位置/样式）。
- 不改 `useRoom.ts` 的行为契约（`leaveRoom`、`send` 等函数签名不变），只改调用它们的按钮外观和布局位置。
- `MahjongTile` 组件本身（`MahjongTile.tsx` / `.scss`）保持接口不变，弃牌区通过传入不同的尺寸/容器类名达到"更清晰"的效果，不改组件内部逻辑。

## 结构调整

### 1. 组件树顺序调整（R1）

现状（`index.tsx:232-333`）：

```
table-surface
  player-station × 4
  table-center
  discard-zone × 4
  self-area
    self-hand
ActionDock            <-- 与 table-surface 同级，且在其后
```

目标：

```
table-surface
  player-station × 4
  table-center
  discard-zone × 4
  self-area
    ActionDock（改造后的操作条，紧贴手牌上方）
    self-hand
```

做法：把 `<ActionDock .../>` 从 `table-surface` 外部（`index.tsx:324`）移入 `self-area` 内部、`self-hand` 之前，参照 Web `GameTable.tsx:1093-1103`（`PrimaryActionBar` 在 `hand-composition` 之前）。`ActionDock` 组件本身的 props（`buttons` / `disabled` / `onAction`）不需要变，只是渲染位置变化 + 样式改造。

`ActionDock` 为空（`buttons.length === 0`）时的占位提示（`action-dock--empty` 分支，`ActionDock.tsx:14-18`）在新位置下应改为**不占空间**（渲染 `null`），因为 R1 要求"仅在满足条件时才出现该按钮区域"——一整条空提示条本身也不该常驻。改动点：`ActionDock.tsx` 顶部判断从渲染占位 `View` 改为 `return null`。

### 2. `ActionDock` 视觉改造（R1 + R4）

参照 Web `primary-action-button`（`styles.css:957-1044`）：

- 容器 `.action-dock`：从"贴底通栏、半透明背景条"（`ActionDock.scss:2-18`）改为"紧贴手牌上方、透明背景、按钮本身自带质感"，不再需要 `border-top` 分隔线。
- 单个按钮 `.action-dock__btn`：
  - 由目前 `10.5vmin`（min 44 / max 64px）图标放大到约 `13-15vmin`（min 56 / max 84px），保证横屏下拇指热区更大。
  - 用 `border-radius: 50%`（或椭圆 `26% / 50%`，与 Web 一致）+ 内阴影/描边代替默认外观；`View` 本身没有原生边框问题，只需要补上圆角背景 + 按下态（`:active` 用 `transform: scale(0.94)` 或 WXSS `hover-class`）。
  - 小程序 `View` 没有 `:hover`/`:active` 伪类，需要用 Taro 的 `hoverClass` 属性（编译到 `hover-class`）实现按下反馈，而不是 CSS `:active`。这是 Web 方案在小程序上的必要变体。

### 3. 弃牌区环形定位（R2）

现状每个方位独立设定绝对坐标（`index.scss:411-442`），基准不统一。改造为以 `.table-center` 的锚点（`top:46%; left:50%`）为参照，四个 `discard-zone` 都用 `top:50%; left:50%; transform: translate(...)` 的写法（相对同一原点做位移），具体偏移量对齐 `table-center` 实际渲染中心，而不是各自独立的 vmin 贴边值。

- `pos-opposite`（对家）：中心正上方。
- `pos-self`：中心正下方（在 `player-station.pos-self` 和 `self-area` 之间的空档）。
- `pos-left` / `pos-right`：中心左右两侧，宽度收窄为竖排 2 列，避免和 `player-station` 重叠。

弃牌牌面尺寸：`MahjongTile compact` 目前用于弃牌，具体像素由 `MahjongTile.scss` 里 `--compact` 相关变量决定（实现前需读取该文件确认当前 compact 尺寸，若过小需要新增一个 `discard` 专用尺寸变体，而不是复用 `compact`，以满足"清晰可辨"的要求）。

### 4. Header / Dock 去背景化 + 独立离开按钮（R3）

- `.game-header`（`index.scss:56-71`）：横屏下始终是当前唯一状态（页面固定 landscape），直接移除 `background` 和 `border-bottom`，或者更彻底地把 header 从"整行 flex 容器"改造成"若干个浮动在背景图上的小控件"：
  - "离开" 按钮独立为左上角悬浮圆角按钮（`position: absolute; top; left;`），不再是 `game-header` flex 子项。
  - 房号/底分/连接状态等信息聚合成一个"信息胶囊"（`position: absolute; top; right` 或顶部居中），背景用小面积的半透明圆角胶囊（不是通栏条），信息量可小幅精简（如平时只显示房号+底分，`FRIEND` 模式下的"复制房号/解散" 可收进这个胶囊或紧邻悬浮按钮）。
  - `game-header` 作为 flex 容器本身可能整体移除，相关子节点各自变成 `table-surface`（或 `game-shell__content`）内的绝对定位浮层，因此 `table-surface` 的高度计算（原来是"减去 header/dock 高度"的隐式 flex 布局）要重新评估——目标是 `table-surface` 撑满 `game-shell__content` 全部空间。
- `ActionDock` 已经按 R1 移进 `self-area`，不再是贴底通栏，因此 R3 里"去掉下方透明区域"这条在完成 R1 后基本自动满足；只需确认没有遗留的空 `action-dock` 容器背景。
- `WAITING` 阶段的 `waiting-panel`（`index.scss:136-158`）保留现状，其内部仍可以用现有的 `game-header`（若 header 结构变化，需要确认 `WAITING` 分支要不要一起换成新 header，还是保留旧的通栏 header——**建议**：`WAITING` 阶段保留通栏 header（房间号是核心信息，且此时没有牌桌背景遮挡问题，通栏更适合展示"等待开局"文案和底分设置），只有 `PLAYING`/`ROUND_RESULT` 阶段的牌桌 header 做浮层化改造。这样改动面更小、风险更低。

### 5. 全局按钮 reset（R4）

全局样式入口已存在：`src/app.ts:2` 引入 `src/styles/theme.scss`，该文件在 `page { ... }` 里定义了设计 token，并有一份**较早期**的 `.game-header` / `.btn-accent` / `.btn-ghost` / `.btn-danger` 定义（`theme.scss:59-116`）。发现两处需要一并处理的历史遗留冲突：

1. `theme.scss` 里的 `.btn-accent` / `.btn-ghost` 已经是 `border-radius: 999px`（胶囊形），但 `index.scss:246-269` 又用 `border-radius: 0.6vmin !important` 把它们改回接近直角矩形，两处定义互相矛盾（`index.scss` 用 `!important` 胜出，实际渲染是矩形）。R4 要求圆角按钮，应统一为胶囊/圆角，删除 `index.scss` 里覆盖为矩形的 `!important` 半径。
2. `theme.scss` 的 `.game-header` / `.game-shell` / `.table-surface`（`theme.scss:51-83`）是 R3 要改造的旧版牌桌 header 结构的残留全局样式，`index.scss` 里的同名类目前靠更高特异性或声明顺序覆盖它们。R3 改造 `game-header` 时要同步检查这份全局副本是否也需要同步修改或删除，避免"改了 `index.scss` 但 `theme.scss` 里的旧规则在某些状态下又冒出来"。

在 `theme.scss` 里新增全局 `button` reset（放在 token 定义之后即可）：

```scss
button {
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  -webkit-tap-highlight-color: transparent;
}
button::after {
  border: none;
}
```

配合各按钮已有的 `border-radius`（`header-btn` / `btn-accent` / `btn-ghost` / `score-chip` 已经有 `border-radius: 0.6vmin !important`，`index.scss:106-269`），去掉 `!important` 依赖的原生边框来源后，圆角效果才会真正生效（当前 `!important` 覆盖的是 `background`/`color`/`font-size` 等，没有覆盖 `::after`，这就是矩形边框仍然存在的根因）。

按下态反馈：Taro `<Button>` 在小程序端支持 `hoverClass` prop，改造后应给需要反馈的按钮加 `hoverClass="is-pressed"` 并定义 `.is-pressed { opacity: 0.8; transform: scale(0.97); }`，而不是依赖已失效的原生按下灰色蒙层（原生蒙层在去掉 `::after` reset 后视觉上依然可能保留，需要在微信开发者工具里实测确认是否需要额外加 `hover-stop-propagation="false"` 或 `hover-start-time`）。

## 数据流

无变化。所有交互仍然走 `roomCtrl.send(...)` / `roomCtrl.leaveRoom()` / `roomCtrl.dissolve()` 等既有 `useRoom` 接口（`useRoom.ts`），本次改造是纯展示层重排，不涉及状态管理或协议改动。

## 兼容性与回滚

- 改动集中在 CSS + JSX 结构挪动，风险主要是"横屏下不同屏幕宽高比（如 iPhone SE 横屏 vs 大屏 Android）下浮层是否重叠"，需要在微信开发者工具里切换几种预设机型走查。
- 回滚点：`ActionDock` 位置调整、`discard-zone` 定位、`game-header` 浮层化三处改动相对独立，出问题可以逐块 revert 而不影响其他两块（各自是独立的 CSS 选择器改动，JSX 结构调整只涉及 `index.tsx` 一处 diff）。
- 不涉及数据库/协议变更，无需数据迁移或灰度开关。

## 关键权衡

- **为什么不直接照抄 Web 的 header/dock 收缩方案**：Web 的 `@media (max-height:500px)` 只是"缩小"通栏，本质还是通栏；用户明确要求小程序端"去掉透明区域、背景铺满"，这是比 Web 更激进的沉浸式方案，属于小程序特有的产品取舍，Web 端不做改动。
- **`WAITING` 阶段保留通栏 header**：为了控制改动范围和风险，不强行把等待开局阶段也浮层化——该阶段本来就没有"背景图被通栏遮挡"的问题，浮层化收益低、改动量不小（波及 `waiting-panel` 内多处依赖 header 高度的布局假设）。
