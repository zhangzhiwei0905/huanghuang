# Implement: 执行计划（待 user 批准方案后启动）

> 本任务当前处于 **planning** 状态。以下是未来实施时的执行计划草案；实施前需 `task.py start` 激活任务。

## 批次 1：确认弹窗 + 震动反馈（B1 + B2）

- [ ] 新增 `src/lib/confirmAction.ts`（封装 `Taro.showModal`，leave/dissolve 两种文案，对局中与大厅文案按 `room.stage` 区分）
- [ ] 新增 `src/lib/confirmAction.test.ts`（mock showModal，覆盖 confirm/cancel）
- [ ] 改造 `src/pages/room/index.tsx` 5 处入口（行 572/625/638/680/1072）
- [ ] 新增 `src/lib/haptics.ts`（hapticTap/hapticAction/hapticWarn，try/catch 静默失败）
- [ ] 新增 `src/lib/haptics.test.ts`（验证告急节流：每回合最多一次 vibrateLong）
- [ ] `useGameAudio` 内同步触发动作震动（`room/index.tsx:255-307`）
- [ ] 选牌回调 + 倒计时 ≤5 秒首震（`room/index.tsx:408-413`）
- [ ] 验证：`pnpm vitest run`（miniprogram 相关测试）；真机走 5 个确认入口 + 三种震动
- [ ] commit: `feat(miniprogram): add danger-action confirmation and haptic feedback`

## 批次 2：Loading 态 + 音频预热（B3）

- [ ] 首页 checking spinner（`pages/index/index.tsx:300-307` + `index.scss`）
- [ ] 登录按钮 busy 态加 spinner 与 disabled 核对
- [ ] `gameAudioPlayer.ts`：2 个常驻 context 池 + `warmupGameAudio()` 导出
- [ ] `gameAudioPlayer.test.ts`：补池复用、预热失败静默、销毁路径用例
- [ ] room 页连接成功后调用 warmup（`connectionStatus === "connected" && room !== null`）
- [ ] 首次开启音效 toast 提示静音键
- [ ] 验证：弱网 throttle 下首页 spinner；真机首报牌延迟对比
- [ ] commit: `feat(miniprogram): improve loading states and pre-warm game audio`

## 批次 3：特效系统 Layer 1（A3 + A4 运行时修复）

- [ ] 新增 `src/lib/effectAnchors.ts`：按座位号用定位公式计算锚点（与 `room/index.scss:837-920` 建立单一来源，优先 CSS 变量方案）+ 测试
- [ ] `MahjongEffectOverlay.tsx`：锚点替代 `createSelectorQuery` 主路径（保留查询兜底，偏差 >20px 时信查询）
- [ ] cue 队列化 + 优先级交叉淡出（WIN > 杠类 > 碰；旧动画 150ms opacity→0）
- [ ] 队列分支单测（push/shift/优先级替换/连续 3 cue 极限）
- [ ] DPR 自适应：backing store = 舞台 CSS 尺寸 × DPR，clamp ≤1024；尺寸变化时销毁重建 lottie animation
- [ ] 验证：开局第一巡头像入场动画中碰牌特效不偏移；补杠→胡连击优雅过渡；DPR 1/2/3 目视对比
- [ ] commit: `feat(miniprogram): queue mahjong effects with synced anchors and dpr-aware canvas`

## 批次 4：特效节奏与差异化（A4 Layer 2/3）

- [ ] 客户端定速播放：动画按原生 60fps 播放，播完保留末帧至 `endsAt`；`stretchLottieTiming` 仅用于中途续播
- [ ] 来由 CSS 标识：金色角标 + 光晕（`cue.laiyou` 驱动，零协议改动）
- [ ] 硬胡/软胡徽标（`cue.winType` + 倍数，硬胡金/软胡绿）
- [ ] lottie 数据离线压缩（浮点 2 位精度、删冗余层），目标 5 文件合计 ≤180KB；压缩后逐帧目视对比
- [ ] 验证：手感对比（拉伸 vs 原速）；来由胡金色标识；bundle < 450KB
- [ ] commit: `feat(miniprogram): native-speed effects with laiyou and win-type flair`
- [ ] ~~服务端 `EFFECT_DURATION_MS` 缩短~~（已定案不做：服务端窗口维持现状）

## 批次 5：样式清理（A2）

- [ ] grep 确认首页不依赖 theme 版 `.btn-accent`/`.btn-ghost`
- [ ] 删除 `theme.scss` 残留块（`.game-shell`/`.btn-accent`/`.btn-ghost` 及 `.is-pressed` 变体）
- [ ] 删除 premium 死代码（`theme.scss:50-68`）
- [ ] 硬编码颜色提变量（`--jade-deep` 等 4~6 个），room/index.scss 替换引用
- [ ] 验证：两页全量目视回归
- [ ] commit: `refactor(miniprogram): remove duplicate styles and dead premium theme`

## 批次 6：`!important` 收敛（A1）

- [ ] `theme.scss` 新增 `.btn-reset`（集中重置原生 button UA 样式）
- [ ] room 页按钮 className 加 `btn-reset`，分批移除 `!important`（工具栏 → 座位 → 浮层 → 结算）
- [ ] 首页同上
- [ ] 每批目视回归三态（常态/按下/禁用）
- [ ] spec 更新：在 `.trellis/spec/frontend/` 记录"组件类禁止新增 !important"约定
- [ ] commit: `refactor(miniprogram): consolidate native button reset into btn-reset`

## 收尾

- [ ] `pnpm vitest run` 全量 + `pnpm type-check`（按 package.json 实际脚本名调整）
- [ ] 真机回归清单：登录 → 建房 → 对局（碰/杠/胡特效）→ 结算 → 离开/解散确认
- [ ] 运行 trellis-check 做质量门
- [ ] 更新 spec（!important 约定、haptics/audio 预热模式）
- [ ] `task.py archive` 归档

## 回滚点

- 每批次独立 commit，可整批 revert
- 批次 5 风险最高，若回归发现问题优先 revert 该批，保留 1-4 批成果
