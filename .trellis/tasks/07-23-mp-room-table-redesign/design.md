# 小程序候场与牌桌重设计

## 1. Design direction

候场页面不再是“顶部网页工具栏 + 中间滚动卡片”，而是直接进入一张完整的横屏麻将桌：

```text
┌ 离开 ─ 房号 / 底分 / 连接状态 ─ 复制 / 分享 / 解散 ┐
│                         对家座位                         │
│                                                      │
│ 左家座位          房间信息 / 邀请 / 底分            右家座位 │
│                                                      │
│              自己座位 + 准备 / 取消准备                  │
└──────────────────────────────────────────────────────┘
```

设计沿用现有背景图、墨绿桌面、米白麻将牌和低饱和金色强调。座位采用紧凑圆角信息站，头像是主要识别点；准备状态使用印章式角标和背景变化，不只依靠颜色。顶部工具是轻量悬浮胶囊，主操作只出现在自己的座位。

## 2. Viewport and overflow contract

- `.game-shell` 使用微信开发者工具和真机已验证可覆盖页面 WebView 的 `100vh`，同时设置 `max-height: 100vh` 和 `overflow: hidden`。尝试 `page → game-shell` 的纯 `height: 100%` 高度链会在微信页面包装节点中丢失高度，使候场主体压缩为 0，因此不采用。
- 房间页继续使用 `disableScroll: true` 和 `pageOrientation: "landscape"`。
- 去掉候场 `.panel-card` 的 `overflow: auto`，候场区域改为绝对定位的单屏场景。
- 所有外缘用 `env(safe-area-inset-*)`；核心位置用 `vmin`，同时为按钮、头像和牌设置可验证的 px 下限。
- 自己手牌仅保留组件内部横向容错；隐藏 WebView 滚动条，页面本身不滚动。
- 验证高度覆盖 360、390、430、480、555 CSS px，重点以 844×390 为基线。

## 3. Component boundaries

在 `apps/miniprogram/src/pages/room/index.tsx` 保留权威投影消费和页面编排，拆出两个纯展示组件：

### `LobbySeat`

输入一个 `LobbySeatProjection`、相对方位、busy 状态和准备回调。

- 所有座位：头像、昵称、积分、联网、准备、房主标记。
- 空位：方位和“等待加入”。
- 自己座位：在卡片内部渲染准备/取消准备按钮。
- 其他座位不渲染操作按钮。

该组件不推断是否可开局，不修改投影，只调用已有 `roomCtrl.ready()`。

### `RoundStartOverlay`

输入倒计时值 `3 | 2 | 1`，只负责渲染全屏过渡：

- 背景压暗但仍能看到已经生成的牌桌。
- 显示“全员已准备”“游戏开始”和当前倒计时。
- 只使用 `transform` 与 `opacity` 动画。
- 无确认按钮，不拦截业务状态，也不延迟服务器。

样式可以与房间页共用 `index.scss`，避免为两个一次性组件增加无必要样式入口。

## 4. Stage transition state

权威阶段仍来自 `RoomProjection.stage`。本地只保存展示倒计时，不复制房间状态：

```text
previousStage = WAITING
new stage     = PLAYING
        ↓
countdown = 3
        ↓ 1s
countdown = 2
        ↓ 1s
countdown = 1
        ↓ 1s
countdown = null
```

规则：

- 初次挂载时 `previousStage = null`；若首个投影已经是 `PLAYING`，不显示。
- 仅 `WAITING → PLAYING` 触发，重复的 `PLAYING` 投影不会触发。
- `room = null` 时清除倒计时和历史。
- `ROUND_RESULT → WAITING → PLAYING` 的下一局可以再次触发。
- 定时器在倒计时变化、组件卸载和房间清空时清理。

把触发判断提取为纯函数 `shouldShowRoundStart(previousStage, nextStage)`，用单元测试覆盖初次恢复、正常开局、重复投影和下一局。

## 5. Waiting layout

### Top utility rail

- 左：离开。
- 中：房号、底分和连接状态。
- 右：复制、分享；仅房主显示解散。
- 控件保持明确 44px 点击区域，但视觉高度控制在横屏约 40–46px。

### Table center

- 展示“等待玩家”或“等待其余玩家准备”的动态摘要。
- 四人未满时突出复制房号/分享邀请。
- 房主底分选择放在中心下方，切换底分后依照现有服务端规则清空准备状态。
- 不新增倒计时或房间规则，仅展示投影已有数据。

### Seat stations

- 自己固定底部、对家顶部、左右玩家固定两侧。
- 头像、昵称、积分使用稳定基线；长昵称单行省略。
- 已准备使用“已准备”状态章；离线显示“离线”；空位显示虚线轮廓。
- 自己卡片更宽，以容纳准备按钮；准备后按钮改为次级“取消准备”。

## 6. Playing layout cleanup

不重写现有游戏结构，只做约束性整理：

- 保留头像、昵称、积分、手牌数、倍率和离线状态。
- 根高度切换为完整 100% 高度链，禁止页面滚动。
- 顶部胶囊、玩家站、中央信息、弃牌区和手牌区按 844×390 重新校准。
- 自己手牌的内部横向滚动仅为极端兼容，并隐藏滚动条。
- 不改 `legalActions`、出牌选择、行动倒计时、结算层或 Socket 行为。

## 7. Compatibility and tests

- 不引入 UI 依赖、远程字体或新网络资源。
- 不使用 `color-mix()`、布局属性动画或依赖鼠标 hover 的交互。
- 纯阶段函数加入 Vitest。
- 类型检查、lint、全量测试、变更范围 Prettier、生产构建全部通过。
- 最终构建后通过端口 11352 验证候场空位、自己未准备/已准备、四人状态、开局覆盖层和 PLAYING 布局截图。

## 8. Rollback

- 主要变更限定在房间页 TSX/SCSS、新的纯阶段辅助模块和测试。
- 不修改协议、数据库和服务端规则，无数据迁移。
- 若布局在真机出现问题，可回滚前端提交并重新构建；服务器无需回滚。
