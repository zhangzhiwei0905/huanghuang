# PRD: 麻将小程序高优先级样式与体验优化

## 背景

在前一轮只读分析中（不涉及任何代码改动），对 `apps/miniprogram` 做了全面的样式与体验审计。审计确认项目整体完成度高（vmin+px 地板布局、lottie+CSS 动效分层、安全区/reduce-motion 处理完善），但识别出一批高优先级问题。本任务只覆盖其中**高优先级**项，中低优先级（上滑出牌、包体积分包、无障碍 alt 等）不在本任务范围，可另行立项。

## 目标范围（Scope）

### A. 视觉 / 样式（3 项）

| 编号 | 问题 | 位置 | 影响 |
|---|---|---|---|
| A1 | `!important` 滥用：room 页 141 处、首页 59 处，用于压制微信原生 `<button>` 样式，形成"优先级战争"，后续改样式只能继续叠 `!important` | `src/pages/room/index.scss`、`src/pages/index/index.scss` | 样式可维护性持续恶化，改主题极易踩坑 |
| A2 | 样式双写与死代码：`.btn-accent`/`.btn-ghost`/`.game-shell` 在 `theme.scss` 与 `room/index.scss` 各定义一份互相覆盖；`theme.scss:50-68` 的 premium 暗金主题 token 无任何地方设置 `data-theme` 属于是死代码；页面级 scss 硬编码颜色（`#1f4834`、`rgb(20 24 15 / xx%)` 等）反复出现未抽变量 | `src/styles/theme.scss`、`src/pages/room/index.scss` | 同名覆盖产生隐性问题；死代码误导后来者 |
| A3 | 特效 Canvas 内部分辨率写死 512×512，胡牌动画最大放大到 `viewport.width × 0.66`，横屏大屏上明显模糊 | `src/components/MahjongEffectOverlay.tsx:17` | 大屏/高 DPR 设备视觉质量差 |
| A4 | 碰/杠/补杠/放赖/胡牌 5 种 lottie 特效存在体验缺陷（用户明确要求优化，必要时重新设计）：① 非 WIN 特效依赖 `createSelectorQuery` 异步查 `#player-station-{seat}` 定位，慢机/掉帧时特效与头像错位；② cue 连发时前一个动画被直接 destroy，特效闪断；③ 时长由服务端 `EFFECT_DURATION_MS`（2.0s~2.8s，`apps/server/src/room-service.ts:153`）通过 `stretchLottieTiming` 强改 framerate 拉伸，动画节奏非作者原意；④ 胡牌无硬胡/软胡/来由的视觉区分（`cue.winType`/`cue.laiyou` 只用于选音频，5 种动画各只有 1 个数据文件）；⑤ 512 backing store 模糊（与 A3 联动）；⑥ 5 个 lottie + `tile-faces.cjs` 共约 370KB 内联进 room 页 bundle（604KB），主包逼近 2MB | `src/components/MahjongEffectOverlay.tsx:87-144`、`src/effects/mahjong/runtime.ts`、`src/lib/mahjongEffect.ts:64-107` | 特效是麻将游戏最核心的爽感来源，当前定位/连贯性/区分度均有欠缺 |

### B. 交互 / 体验（3 项）

| 编号 | 问题 | 位置 | 影响 |
|---|---|---|---|
| B1 | 危险操作零确认：房主"解散房间"、成员"离开房间"一键直发（共 5 处入口），误触导致整桌解散 | `src/pages/room/index.tsx:572,625,638,680,1072` | 误触成本极高，整桌玩家被踢散 |
| B2 | 完全无震动反馈：全项目 grep 不到 `vibrate`，出牌/碰/杠/胡/倒计时告急等关键节点均无触觉反馈 | 全局缺失 | 麻将类小程序标配能力缺失，感知成本低收益高 |
| B3 | Loading 态偏弱：首页 `checking` 阶段只有背景图无 spinner；登录等按钮仅靠文案变化（"正在登录…"）；音频首次播放时才异步 resolve 云 URL 并创建 `InnerAudioContext`，开局首次报牌可感知延迟 | `src/pages/index/index.tsx:300-307`、`src/lib/gameAudioPlayer.ts:90`、`src/lib/cloudAudio.ts` | 弱网/首次进入时用户怀疑卡死；首音延迟 |

## 非目标（Out of Scope）

- 出牌手势（上滑/拖拽出牌）——交互改动大，另行评估
- 包体积优化（lottie 挪分包/云存储）——独立任务（A4 若选"压缩/重做数据"方案可顺带减重，但不做分包工程）
- 无障碍 alt、iPad 大屏放大策略、z-index 常量集中化
- 服务端（`apps/server`）零改动：`EFFECT_DURATION_MS` 窗口维持现状（已确认不缩短），A4 通过客户端定速播放解决节奏问题
- 本阶段**不写任何实现代码**，只产出方案文档

## 验收标准

1. 每个高优先级项都有对应的详细优化方案（现状 → 方案 → 改动点 → 风险），写入 `design.md`
2. 方案中引用的文件路径与行号经过核实，与实际代码一致
3. 方案明确标注每项的兼容风险（微信基础库、iOS 静音键、真机 DPR 等）
4. 方案不引入新的 npm 依赖（如必须引入需单独论证）
5. 本阶段 git 工作区中除 `.trellis/tasks/07-27-mahjong-ux-optimizations/` 外不产生任何代码改动
