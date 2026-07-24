# 优化结算赖子展示与听牌提示 — 实施计划

## 1. 规则层

- [x] 在 `packages/game-engine/src/ting.ts` 实现纯 `analyzeDiscardTingOptions` helper。
- [x] 通过 `packages/game-engine/src/index.ts` 包根导出，禁止服务端深层导入。
- [x] 添加 `ting.test.ts`，覆盖：
  - [x] 一手牌中只有部分物理牌打出后可听；
  - [x] 同种物理牌均得到对应提示；
  - [x] 硬胡、软胡类型与 `evaluateWin` 一致；
  - [x] 打后无赖子时赖子一定进入合法听牌候选；
  - [x] 打后仍有赖子时排除赖子候选；
  - [x] 碰牌后缩短暗手的牌数/牌组数量仍正确分析；
  - [x] 非听牌出牌返回空 waits，赖子本身不作为可打候选。

## 2. 协议与服务投影

- [x] 在 `packages/protocol/src/projections.ts` 增加 `TingWaitProjection`、`DiscardTingProjection` 与 `RoomProjection.tingHints`。
- [x] 将投影 `schemaVersion` 提升到 5，并更新 Web/小程序测试夹具。
- [x] 在 `apps/server/src/room-service.ts` 增加公开牌按物理 ID 去重计数 helper。
- [x] 只为当前合法出牌成员生成 `tingHints`，映射合并倍率和公开剩余数量。
- [x] 添加/扩展 `room-service.test.ts`，覆盖：
  - [x] 非当前玩家、等待/结算阶段和无出牌动作时为空；
  - [x] 正常摸牌与碰后出牌均可生成；
  - [x] 当前玩家手牌、牌河、碰杠、放赖和亮牌全部参与公开计数；
  - [x] 被碰弃牌的重复物理 ID 不重复扣减；
  - [x] 0 张候选保留；
  - [x] 改变牌墙顺序或对手暗牌而不改变公开信息时，提示结果不变；
  - [x] 其他玩家暗手继续为 `null`。

## 3. 小程序 UI

- [x] 新增听牌提示展示组件或纯展示 helper，复用现有 SVG 牌面和 `tileLabel`。
- [x] 在 `apps/miniprogram/src/pages/room/index.tsx` 建立 `discardTileId -> waits` 映射。
- [x] 为排序手牌与独立摸牌槽统一加入牌槽包装、“听”标识和选中卡片触发。
- [x] 保持普通牌第一次选中、第二次出牌，赖子放赖及碰杠高亮行为不变。
- [x] 在回合、阶段、手牌或合法动作变化时确保旧 selection/card 不残留。
- [x] 在 `index.scss` 实现紧凑候选轨道、边缘对齐、候选横向滚动、0 张弱化和安全区约束。
- [x] 增加纯 helper 测试，覆盖提示 Map、选中牌候选和左/中/右锚点分类。

## 4. 结算样式

- [x] 在 `RoundSettlementModal.scss` 中局部移除结算赖子小牌外侧 outline。
- [x] 保留“赖”徽标、负边距扇形和游戏内其他位置赖子轮廓。
- [ ] 验证赖子位于首位、中间、末位时均无异常竖线（自动化窗口受 Mac 锁屏阻塞，待解锁后目检）。

## 5. 验证顺序

1. `pnpm exec vitest run packages/game-engine/src/ting.test.ts apps/server/src/room-service.test.ts`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm lint`
5. `pnpm format:check`
6. `pnpm --filter @huanghuang/miniprogram build:weapp`
7. 微信开发者工具横屏验证：
   - 844×390 与较窄横屏；
   - 普通摸牌、杠后补牌、碰后出牌；
   - 多张牌同时带“听”标识；
   - 选择不同出牌切换不同候选；
   - 硬/软胡合并倍率；
   - 赖子包含/排除规则；
   - 剩 0 张；
   - 候选多时滚动与左右边缘不裁切；
   - 结算赖子位于首/中/末位置。

## 6. 风险文件与回滚点

- `packages/protocol/src/projections.ts`：协议类型与 schema version，先完成所有夹具更新再进入 UI。
- `packages/game-engine/src/win.ts`：原则上不修改；若 helper 暴露规则缺口，先补回归测试再决定是否调整。
- `apps/server/src/room-service.ts`：投影不得读取 wall/opponent concealed hands 来计算 remainingCount。
- `apps/miniprogram/src/pages/room/index.scss`：项目可能有其他会话改动；只追加/修改本任务明确选择器，禁止覆盖无关 diff。
- 可分三段回滚：结算 CSS、听牌 UI、协议/服务/引擎分析。

## 7. 开始实施前检查

- [x] PRD 无未决产品问题，且已完成收敛检查。
- [x] 用户审阅并批准 `prd.md`、`design.md`、`implement.md`。
- [x] 运行 `task.py start` 将任务置为 `in_progress`。
- [x] 加载 `trellis-before-dev`，重新确认当时 Git 状态与相关规范。
