# Design: 麻将小程序高优先级样式与体验优化方案

> 本文档只出方案，不改代码。每项按「现状 → 方案 → 改动点 → 风险与验证」展开。
> 所有行号以 2026-07-27 工作区代码为准，实施前需重新核对。

---

## A. 视觉 / 样式

### A1. 消除 `!important` 优先级战争

**现状**

- `src/pages/room/index.scss` 含 141 处 `!important`，`src/pages/index/index.scss` 含 59 处。
- 根因：微信原生 `<Button>` 自带 `min-height`、`line-height`、`background-color`、`border-radius`、`::after` 边框等 UA 样式，项目为压制它们逐个属性 `!important`（注释见 `room/index.scss:221-225`：原生 button 曾把"离开"渲染成竖排圆形）。
- 后果：任何后续样式调整都必须继续叠 `!important`，形成军备竞赛；同名类双写时覆盖顺序不可预测。

**方案（推荐：收敛到单个 reset 基类）**

1. 在 `src/styles/theme.scss` 新增一个 `.btn-reset` 基类，**仅在此处**集中使用必要的 `!important`，一次性重置微信原生 button 的所有 UA 样式（`min-height/line-height/padding/margin/background/border/border-radius/font-size/color/text-align` + `::after { display: none !important; }` + `button-hover` 伪态）。
2. 页面内所有功能按钮的 className 从 `className="lobby-toolbar__button"` 改为 `className="btn-reset lobby-toolbar__button"`（Taro 的 `<Button>` 仍保留，以继续使用 `hoverClass` / `openType="share"` 等原生能力）。
3. 逐页面移除组件类上的 `!important`：room 页 → 首页 → 组件 scss。每移除一批，在微信开发者工具中目视回归该区块。
4. 收口规则写入 spec：今后禁止在组件类上新增 `!important`（code review / lint 人工把关；stylelint 的 `declaration-no-important` 规则可按需开启为 warn，不强制 error，避免阻塞遗留代码）。

**改动点**

- `src/styles/theme.scss`：新增 `.btn-reset`（约 20 行）。
- `src/pages/room/index.scss`：删除 141 处 `!important` 中约 130 处（少数如禁用态覆盖可保留在 `.btn-reset` 体系内）。
- `src/pages/index/index.scss`：删除约 55 处。
- 两页 tsx：约 20~30 处 className 加 `btn-reset`。`ActionDock` 是纯图片按钮（`ActionDock.scss:88-90` 文字 label 已 `display:none`），也需核对。

**风险与验证**

- 风险：移除 `!important` 后某些按钮恢复 UA 样式 → 逐区块目视回归即可暴露；建议按"工具栏 → 大厅座位 → 对局浮层 → 结算弹窗 → 首页"分批进行，每批可独立提交。
- 验证：开发者工具 + 1 台真机（iOS）遍历两页全部按钮的常态/按下/禁用三态。

---

### A2. 清理样式双写与死代码

**现状**

- `.game-shell` 双写：`theme.scss:70` 与 `room/index.scss:3`。
- `.btn-accent` / `.btn-ghost` 双写：`theme.scss:102,117`（渐变+vmin 阴影版）与 `room/index.scss:810,822`（药丸版）。首页实际引用的是 theme.scss 版本（`room/index.tsx:547` 的 `btn-accent` 用的是页面作用域版本——两处同名互相覆盖，依赖构建顺序）。
- premium 主题死代码：`theme.scss:50-68` 定义了 `page[data-theme="premium"]` 全套暗金 token，全项目无任何 `data-theme` 设置。
- 硬编码颜色：`#1f4834`、`#d6bd7c`、`#8f7541`、`rgb(20 24 15 / xx%)` 等在 `room/index.scss` 反复出现 8+ 次。

**方案**

1. **删除 `theme.scss` 中的残留块**（`.game-shell`、`.btn-accent`、`.btn-ghost` 及其 `.is-pressed` 变体，即 `theme.scss:70-150` 一带），保留唯一的 room/index.scss 版本；`theme.scss` 只留 token、`.is-pressed`、`.btn-reset`（A1 新增）等真正全局的内容。先全项目 grep 确认首页未依赖 theme 版 `.btn-accent`（首页有自己的按钮体系 `.home-jade-button` 之类，实施时核实）。
2. **premium 主题二选一**（建议先删）：本次直接删除 `theme.scss:50-68` 死代码；若未来要做皮肤，再以"运行时切换 `data-theme`"的需求重新立项。若决定保留，则在对局页 `page` 元素上接 `data-theme` 并在设置中加开关——但那是功能开发，不属于本次清理。
3. **硬编码颜色提变量**：把 `room/index.scss` 中反复出现的颜色提升为 `theme.scss` 的 CSS 变量（`--jade-deep: #1f4834`、`--gold: #d6bd7c`、`--bronze: #8f7541`、`--ink-scrim: rgb(20 24 15 / 62%)` 等，命名在实施时按语义定），页面内统一 `var(--xxx, #fallback)` 写法，与组件 scss 现有习惯一致。

**改动点**

- `src/styles/theme.scss`：删残留、删 premium、新增 4~6 个颜色变量。
- `src/pages/room/index.scss`：替换硬编码颜色为变量引用（约 15~25 处）。

**风险与验证**

- 风险：首页若隐式依赖 theme 版 `.btn-accent`，删除后样式漂移 → 实施第一步先 grep `pages/index/index.tsx` 的 className 确认；验证方式为两页全量目视回归。
- 风险：删除 premium 死代码无运行时影响（无引用），零风险。

---

### A3. 特效 Canvas 分辨率自适应

**现状**

- `src/components/MahjongEffectOverlay.tsx:17` 写死 `CANVAS_SIZE = 512`，`node.width/node.height = 512`（行 70-71），而舞台 CSS 尺寸最大放到 `viewport.width × 0.66`。在 812pt 宽、DPR=3 的横屏 iPhone 上，512px 纹理被拉伸到约 536pt（1608 物理像素），放大 3 倍，明显模糊。

**方案**

1. 初始化 canvas 时按舞台实际 CSS 尺寸 × `Taro.getWindowInfo().pixelRatio` 计算内部分辨率：
   - `stageCssSize`（胡牌 = `viewport.width × 0.66`，碰/杠用现有逻辑）× DPR，并设上限（如 1024px）防止 iPad Pro 等超大屏纹理过大、每帧绘制开销飙升。
   - 横屏手机的胡牌场景典型值：536pt × 3 = 1608 → clamp 到 1024，比 512 清晰 2 倍且开销可控。
2. `Canvas` 的 `style` 宽高维持现有 CSS 尺寸不变（由现有 `style={style}` 控制，行 160），只改 backing store 分辨率。lottie-miniprogram 的 `canvas` 宽高变化后需重建 animation（`lottie.loadAnimation` 时传入新 canvas），注意在 size 变化时销毁旧实例再 load，避免双实例。
3. 设备旋转 / 窗口变化不处理（页面已锁横屏，`app.config.ts`），仅在 effect cue 触发初始化时计算一次即可。

**改动点**

- `src/components/MahjongEffectOverlay.tsx`：`CANVAS_SIZE` 常量 → `resolveCanvasSize(stageCssSize)` 函数；`createSelectorQuery` 成功回调里设置 `node.width/height`（行 70-71 附近）；重建逻辑约 +20 行。

**风险与验证**

- 风险：DPR 高的低端机（如部分安卓 DPR=2.75）每帧绘制像素增加 → 有上限 clamp（1024）兜底；碰/杠动画本来就裁剪过图层（`effects/mahjong/runtime.ts:40-67` 注释），开销可控。
- 验证：开发者工具切换 DPR 1/2/3 目视对比胡牌动画锐度；真机验证掉帧情况（关注 `hu-pai` 76KB 这个最大动画）。

---

## B. 交互 / 体验

### B1. 危险操作二次确认

**现状**

5 处入口全部一键直发：

| 位置 | 操作 | 场景 |
|---|---|---|
| `room/index.tsx:572` | `leaveRoom()` | 大厅工具栏"离开" |
| `room/index.tsx:625` | `dissolve()` | 大厅"解散"（房主） |
| `room/index.tsx:638` | `leaveRoom()` | 大厅座位区"离开" |
| `room/index.tsx:680` | `dissolve()` | 大厅信息胶囊"解散" |
| `room/index.tsx:1072` | `onLeave → leaveRoom()` | 对局内（结算/菜单组件回调） |

**方案**

1. 新增一个轻量封装 `confirmDangerAction(action: "leave" | "dissolve", onConfirm)`，内部用 `Taro.showModal`：
   - 解散：`title: "解散房间"`，`content: "解散后所有玩家将被移出房间，本局进度丢失，确定解散？"`，`confirmText: "解散"`，`confirmColor: "#d64541"`（复用 `--danger`）。
   - 离开（对局进行中）：`content: "对局进行中离开将由机器人代打，确定离开？"`；大厅等待阶段离开可用较轻的 `content: "确定离开房间？"`。
2. 将 5 处 `onClick` 全部改为先弹确认。大厅阶段与对局阶段的"离开"文案不同，按 `room.stage` 区分。
3. 顺带的防误触：`busy` 期间禁用已有（`disabled={roomCtrl.busy}`），确认弹窗出现期间不重复触发（`showModal` 是单例，天然防抖）。

**改动点**

- 新增 `src/lib/confirmAction.ts`（约 30 行，纯函数 + Taro.showModal 封装，可单测）。
- `src/pages/room/index.tsx`：5 处 onClick 改造；若结算组件 `RoundSettlementModal` 内部有离开按钮（行 1072 的 `onLeave`），确认逻辑放在 room 页的回调里统一处理，组件内部不改。

**风险与验证**

- 风险：`Taro.showModal` 在开发者工具与真机表现一致，低风险；注意安卓返回键会取消弹窗（cancel 分支不执行操作即可）。
- 验证：单测覆盖 `confirmDangerAction` 的 confirm/cancel 分支（mock `Taro.showModal`）；真机走一遍 5 个入口。

---

### B2. 震动反馈

**现状**

- 全项目 grep 不到 `vibrate`，零触觉反馈。

**方案**

1. 新增 `src/lib/haptics.ts`（约 40 行）：
   - `hapticTap()`：普通操作（选牌、按钮点击）→ `Taro.vibrateShort({ type: "light" })`。
   - `hapticAction()`：牌局动作生效（出牌成功、碰/杠/胡触发）→ `Taro.vibrateShort({ type: "medium" })`。
   - `hapticWarn()`：非法操作 / 倒计时告急（≤5 秒，与 `is-urgent` 同一阈值）→ `Taro.vibrateLong()`（每回合最多触发一次，避免持续震动）。
   - 所有调用包 try/catch + 静默失败（部分安卓/开发者工具不支持）。
2. 接入点（与现有事件体系对齐，避免侵入）：
   - **牌局动作**：在 `useGameAudio`（`room/index.tsx:255-307`）的 `updateGameAudioTracker` 返回文件列表处同步触发——音频事件本身就是"什么动作发生了"的单一事实来源（`gameAudioEvents.ts` 已把出牌/碰/杠/胡/放赖抽象为事件），震动挂在同一处，零重复判断。音效关闭时震动仍生效（两者独立）。
   - **选牌**：`lib/handInteraction.ts` 的选中回调处（room 页调用方），轻震动。
   - **倒计时告急**：`room/index.tsx:408-413` 的 500ms 轮询里，首次进入 ≤5 秒时触发一次 `hapticWarn`（用 ref 记录本回合是否已震过）。
3. 震动不需要独立开关（系统层面用户可控），但若后续有诉求可并入 `gameAudioPreference` 改为 "feedback" 总开关——本次不做。

**改动点**

- 新增 `src/lib/haptics.ts` + `haptics.test.ts`（mock Taro.vibrateShort/Long，验证节流逻辑）。
- `src/pages/room/index.tsx`：`useGameAudio` 内 +约 10 行；倒计时处 +约 6 行；选牌回调 +2 行。

**风险与验证**

- 风险：`vibrateShort` 的 `type` 参数需基础库 ≥ 2.13.0（light/medium/heavy）；`Taro.vibrateShort` 无参调用在低版本降级为默认短震，可先做 `canIUse` 判断或直接 try/catch 兜底。iOS 上 `vibrateShort` 依赖系统 Taptic Engine，静音键不影响震动。
- 验证：真机（iOS + 安卓各一）验证三种震动；开发者工具中静默失败不报错。

---

### B3. Loading 态与音频预热

**现状**

- 首页 `checking` 阶段（`pages/index/index.tsx:300-307`）只渲染背景图，无任何进度指示，弱网 session 校验时画面静止，像卡死。
- 登录等按钮仅靠文案变化（"正在登录…"），无 spinner。
- 音频首播延迟：`gameAudioPlayer.ts:90` 的 `play()` 每次先 `await resolveAudioFileUrls`（云 URL 换取，`cloudAudio.ts:48`），再新建 `InnerAudioContext`。首次进入对局时第一张报牌要等一轮网络 + context 初始化，可感知慢半拍。

**方案**

1. **首页 checking 态**：在背景图之上加一个居中的轻量 loading（CSS 玉色 spinner 或"正在进入…"文案 + 三点动画，纯 CSS，不引入组件库）。样式沿用现有 token，约 30 行 scss。
2. **登录按钮 busy 态**：保留文案变化，追加 `disabled`（防重复提交，实施时确认是否已有）+ 文字前的小型 CSS spinner（inline-block，与文字同行）。
3. **音频预热**：在 room 页建立连接且进入房间成功后（`connectionStatus === "connected"` 且 `room !== null`），调用新增的 `warmupGameAudio(player)`：
   - 主动 `resolveAudioFileUrls(AUDIO_FILE_NAMES)` 提前换好全部云 URL（37 个 fileID 一次批量 `getTempFileURL`，`cloudAudio.ts` 已支持批量）；
   - 预创建 2 个常驻 `InnerAudioContext`（不设置 src）放入池中，`play()` 优先复用池内 context，播完归还而非 destroy；池外的仍走现路径。2 个并发足以覆盖"报牌 + 动作音"重叠场景。
   - 预热失败静默（不影响对局），`play()` 路径保持现有降级逻辑不变。
4. **静音键提示**（顺手做）：`obeyMuteSwitch: true`（`gameAudioPlayer.ts:100`）下 iOS 静音键会无声。在音效开关按钮（`sound-fab` / 大厅 `sound-toggle`）开启音效后的 toast 或按钮长按提示中加一句"iOS 静音模式下无声"——最低成本方案：首次开启音效时 `Taro.showToast({ title: "已开启音效（静音键下无声）", icon: "none" })`，一次性，不常驻。

**改动点**

- `src/pages/index/index.tsx` + `index.scss`：checking spinner（+30 行 scss，tsx +5 行）。
- `src/lib/gameAudioPlayer.ts`：context 池 + warmup 导出（约 +50 行）；`gameAudioPlayer.test.ts` 补池复用/预热用例。
- `src/lib/cloudAudio.ts`：无需改（已支持批量 resolve，只需导出给 warmup 用——实施时确认导出形态）。
- `src/pages/room/index.tsx`：连接成功后调用 warmup（+5 行）；音效开启 toast（+3 行）。

**风险与验证**

- 风险：常驻 context 持有内存 → 仅 2 个，页面销毁时随 `playerDestroyed` 统一 destroy（现有逻辑行 80 附近已有销毁路径，需把池内 context 一并纳入）。
- 风险：`getTempFileURL` 批量 37 个 fileID 在一次调用内，微信限制单次 50 个，安全。
- 验证：弱网模拟（开发者工具 Network throttle）看 checking spinner；真机验证首次报牌延迟改善（预热后 < 100ms 量级，原本可能 300ms+）。

---

## 实施顺序建议（概要，详见 implement.md）

| 批次 | 内容 | 理由 |
|---|---|---|
| 1 | B1 确认弹窗 + B2 震动 | 纯增量、不动样式，风险最低，收益立竿见影 |
| 2 | B3 loading + 音频预热 | 增量为主，audio player 有测试覆盖，可控 |
| 3 | A3 canvas 分辨率 | 单文件改动，视觉回归明确 |
| 4 | A2 样式清理 | 删除为主，需全量目视回归 |
| 5 | A1 `!important` 收敛 | 风险最高（视觉回归面最大），放最后、分批提交 |

## 全局约束

- 不引入新 npm 依赖（A4 重做动画素材属内容替换，不算依赖）。
- 所有新增 lib 模块（haptics / confirmAction）配 vitest 单测，沿用现有 `*.test.ts` 习惯（参考 `gameAudioPlayer.test.ts` 的 Taro mock 方式）。
- 每批次独立 commit，方便按批回滚。

---

## C. 特效系统重做（A4，用户补充项）

### A4. 碰/杠/补杠/放赖/胡牌特效优化与重设计

**现状（核实后的完整链路）**

服务端：动作发生 → `createEffectCue`（`apps/server/src/room-service.ts:311-318`）生成 cue（含 `id/action/actorSeat/tileKind/winType/laiyou/startedAt/endsAt`）→ 挂到 `pendingEffectTransition`，期间牌局状态**冻结**（`tick()` 行 822-829：cue 未过期则不推进 round）→ 到期后一次性切换 round。时长表 `EFFECT_DURATION_MS`（行 153-161）：PONG 2.0s、杠类 2.2s、补杠 2.3s、放赖 2.5s、WIN 2.8s。

客户端：`MahjongEffectOverlay.tsx`：
1. 初始化 canvas（写死 512×512，行 70-71，`lottie.setup(node)` 全局单例）。
2. cue 变化时（`useEffect` 依赖 `[canvas, cue?.id]`，行 144）：**先 destroy 旧动画**（行 88-90），非 WIN 动作再 `createSelectorQuery` 异步查 `#player-station-{cue.actorSeat}` 的 `boundingClientRect`（行 133-136）。
3. `loadMahjongAnimationData`（`effects/mahjong/runtime.ts:69-95`）：碰裁剪为纯文字+少量彩屑（行 40-67，注释明示为降每帧 Canvas 开销）；杠/补杠/放赖经 `tile-faces.cjs` 把牌面图层换成实际牌；胡牌深拷贝 76KB 数据。
4. `stretchLottieTiming`（`lib/mahjongEffect.ts:47-54`）强改 framerate 让动画时长=cue 窗口；`lottieResumeFrame` 支持中途加入续播。
5. 定位 `effectPlacement`（行 64-107）：WIN 居中 `min(512, vw*0.66, vh*0.9)`；碰紧凑尺寸贴头像右缘（overlap 16px 内边距）；杠类更大，`-edgeGap` 负 overlap 避免遮头像。

**六大缺陷**

| # | 缺陷 | 根因 |
|---|---|---|
| ① | 定位错位 | `boundingClientRect` 异步查询与渲染帧竞争；慢机上头像还在 `station-in` 入场动画中，查到的 rect 是中间态 |
| ② | 连发闪断 | cue 切换直接 destroy；补杠后立即胡（常见连击）时补杠动画硬切 |
| ③ | 节奏拉伸 | 作者按 60fps/98~126 帧设计（约 1.6~2.1s），服务端窗口 2.0~2.8s，framerate 被压到原速 60%~80%，动作发"肉" |
| ④ | 无差异化 | 硬胡/软胡/来由共用 1 个 hu-pai 动画；来由（本玩法核心特色）在视觉上零体现，`cue.laiyou` 只选了音频 |
| ⑤ | 模糊 | 512 backing store 被拉伸到最大 `vw*0.66`（横屏 iPhone 约 536pt = 1608 物理像素，放大 3 倍） |
| ⑥ | 包体积 | 5 个 .cjs + tile-faces 约 370KB 内联 room 页（604KB），主包逼近 2MB |

**方案总览：三层 + 一次重设计**

```
Layer 1 运行时修复（不动素材）   ── 定位同步化、cue 队列化、DPR 自适应（A3 并入）
Layer 2 数据与节奏              ── 时长收敛、数据压缩瘦身
Layer 3 表现力差异化            ── 来由/硬胡/软胡视觉区分
重设计                         ── 在 Layer 1-3 落地后，评估重做素材
```

---

**Layer 1 · 运行时修复**

1. **定位同步化，消除异步查询错位**
   - 座位卡片位置本质是确定布局（`.player-station` 全绝对定位在四角）。新增 `lib/effectAnchors.ts`：`seatAnchor(seat, viewport) → EffectRect`，用与 scss 相同的定位公式直接计算座位中心，不再查询 DOM。
   - 实施时从 `room/index.scss:837-920` 提取各方位 `.player-station` 的 top/left/right/bottom 偏移常量，与 scss 建立"单一来源"（例如在 `:root` 定义 `--station-top: xxvmin` 变量，TS 侧用 `getComputedStyle` 读一次，或两边各保留一份常量并在 spec 中登记同步义务——推荐前者）。
   - 保留 `createSelectorQuery` 作为**兜底**（计算结果与查询结果偏差 >20px 时相信查询），但正常路径零异步。
   - 顺带修复：头像 `station-in` 入场动画期间触发特效（开局第一巡就可能碰），锚点不再依赖动画中间态。

2. **cue 队列化，消除闪断**
   - `MahjongEffectOverlay` 从"单 cue 响应"改为"队列播放"：内部维护 `queueRef`，新 cue 到达时若当前动画剩余 >400ms 且新 cue 优先级更高（WIN > 杠类 > 碰），执行**交叉淡出**（旧动画 150ms opacity→0，overlay 已有 `opacity` 过渡基础）而非硬 destroy；否则排队到当前动画结束后播放。
   - 服务端保证同一时刻只有一个 `pendingEffectTransition`（行 305-308 的 candidates 长度校验），所以队列深度实际 ≤2（当前 + 紧随的胡），内存可控。
   - 连续 cue 的总阻塞窗口不变——服务端 `tick` 仍按各自 `endsAt` 推进，客户端队列只是**视觉**层串行，不影响牌局逻辑。

3. **DPR 自适应**（即 A3 方案，并入本层）：backing store = 舞台 CSS 尺寸 × DPR，clamp ≤1024。胡牌清晰度提升约 2 倍。

**Layer 2 · 数据与节奏**

4. **时长收敛**：`stretchLottieTiming` 把 60fps 动画压到原速 60%~80% 是"肉"感的直接来源。**已定案：客户端定速播放**——忽略 cue 窗口对 framerate 的拉伸，动画按原生 60fps 播放（碰 1.3s、杠 1.5s、胡 2.1s），播完静止展示最后一帧（`clearCanvas: false` 保留末帧）直到 `endsAt` 到达 cue 自然清除。`stretchLottieTiming` 降级为只在中途加入续播时使用。服务端 `EFFECT_DURATION_MS` **保持不变**（用户已确认不缩短窗口），协议零改动。

5. **数据瘦身**（不影响视觉前提下）：
   - 5 个 .cjs 当前 280KB，`tile-faces.cjs` 90KB。用 lottie 标准压缩手段处理（去浮点精度到 2 位、删空白层/meta 冗余），预计减 30%~50%；实施时用脚本离线处理（如 lottie 社区 `lottie-minify` 思路）生成新 .cjs，源文件留档。
   - 碰的裁剪逻辑（`compactPongAnimation`）已验证有效，把同样思路推广：检查杠/放赖/胡是否有可裁的隐藏层（AE 导出的 guide 层、未启用层）。
   - 目标：room 页 bundle 从 604KB 降到 450KB 以下。

**Layer 3 · 表现力差异化**

6. **来由（laiyou）视觉标识**——本玩法核心特色，当前零体现。最低成本方案：
   - 不新增 lottie 数据：在 hu-pai 播放时，overlay 增加一个 CSS 层（lottie 之外的 `<View>` 角标/全屏边缘光晕，琥珀金 `--gold` 色系，与玉石绿形成"中奖感"对比），配文字"来由！"以 CSS keyframe 弹入（复用现有 `dock-pop` 语言）。
   - 数据来自 `cue.laiyou`（协议已有字段，零改动）。
   - 进阶（若重做素材，见下）：来由专属 hu-pai 变体，金色替换绿色主色。

7. **硬胡/软胡区分**：`cue.winType` 已有（HARD/SOFT）。方案同 6：胡牌 overlay 在标题区显示"硬胡 ×N"/"软胡 ×N"徽标（N = 倍数，协议 `roundOutcome` 里有，实施时确认字段），用颜色区分（硬胡金、软胡玉绿），不重做动画本体。

**重设计评估（必要时）**

在 Layer 1-3 落地后，若对表现力仍不满意，按以下规格重做素材：
- 统一节奏：入场冲击帧 ≤0.4s，主体展示 1.0~1.6s，出场 0.3s，原生 60fps 导出，避免运行时拉伸。
- 画布 512×512 但关键内容集中在中心 70% 安全区（配合 DPR 放大后边缘不糊）。
- 来由专属变体（金色调 hu-pai-laiyou.cjs），其余 4 种在现有基础上重导出精简版。
- 交付物：AE 源文件 + 导出脚本 + 每动画 ≤40KB 的 .cjs（胡 ≤60KB）。
- 此事项建议**单独立项**（属设计资源制作，非纯编码），本任务只做规格定义。

**改动点汇总**

- 新增 `src/lib/effectAnchors.ts` + 测试（座位锚点计算，四角 viewport 参数化）。
- `MahjongEffectOverlay.tsx`：队列化 + 交叉淡出（约 +60 行）、锚点替代异步查询（-10 行）、DPR（A3 同改）、来由/硬软胡 CSS 角标层（+20 行 tsx）。
- `MahjongEffectOverlay.scss`：角标/光晕/淡出过渡（+40 行）。
- `lib/mahjongEffect.ts`：`stretchLottieTiming` 调用点改为可选（定速播放开关）；`effectPlacement` 读锚点参数。
- `effects/mahjong/runtime.ts` + `data/*.cjs`：离线压缩脚本产物替换（内容变更，逻辑不变）。
- 服务端**零改动**：`EFFECT_DURATION_MS` 维持现状（用户已确认不缩短窗口）。

**风险与验证**

- 风险：锚点计算与 scss 定位漂移 → 提取 CSS 变量做单一来源 + spec 登记；保留查询兜底。
- 风险：队列化引入新时序 bug（极端：连续 3 个 cue）→ 单测覆盖队列 push/shift/优先级替换分支；真机模拟"补杠→胡"连击。
- 风险：数据压缩破坏动画 → 每个压缩后文件与原版逐帧目视对比（开发者工具 0.5 倍速）。
- 验证清单：① 开局第一巡即碰（头像入场动画中）特效不偏移；② 补杠后立即胡，补杠优雅淡出；③ DPR 3 设备胡牌锐利；④ 来由胡出现金色标识；⑤ room 页 bundle < 450KB。
