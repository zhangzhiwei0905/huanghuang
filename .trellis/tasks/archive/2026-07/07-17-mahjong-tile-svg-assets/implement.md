# Implementation Plan — 上游麻将牌面 SVG 适配

## Ordered Checklist

- [x] 记录 `lietxia/mahjong_graphic` 的仓库、提交、许可和文件映射。
- [x] 将第一版手绘生成器替换为只做格式适配的上游导入脚本。
- [x] 从锁定提交的透明 SVG 目录导入 `1m..9m`、`1s..9s`、`1p..9p`。
- [x] 对每个文件应用统一画布变换和花色颜色映射，覆盖原 27 个输出文件。
- [x] 更新校验脚本，验证来源标记、文件映射、XML、viewBox、禁用元素、颜色和原始路径一致性。
- [x] 格式化 27 个目标 SVG 与任务记录。
- [x] 渲染大尺寸与 28px～68px 小尺寸总览，进行视觉检查。
- [x] 运行 lint、全仓 typecheck、web build 和测试。
- [x] 在 `MahjongTile` 中建立 `TileKind → SVG URL` 映射并用装饰性图片替换旧牌面结构。
- [x] 删除旧文字万字、圆点和竹条 CSS 牌面规则，保留牌体与交互状态样式。
- [x] 将牌桌中央赖子文字替换为紧凑型 `MahjongTile`，并让揭示动画复用牌组件选择器。
- [x] 为文件名映射、27 个资源可解析性和赖子 SVG 状态增加单元测试。
- [x] 运行更新后的 SVG 校验、lint、全仓 typecheck、生产 build 和完整测试。

## Validation Commands

```bash
xmllint --noout apps/web/src/assets/tiles/*.svg
node .trellis/tasks/07-17-mahjong-tile-svg-assets/research/validate-tiles.mjs
pnpm exec prettier --check apps/web/src/components/MahjongTile.tsx apps/web/src/components/MahjongTile.test.ts apps/web/src/components/GameTable.tsx apps/web/src/styles.css .trellis/tasks/07-17-mahjong-tile-svg-assets/*.md
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Risk and Rollback Points

- 风险：上游 19:26 与目标 3:4 比例略有差异。通过统一等比缩放和水平／垂直居中解决，禁止非等比拉伸。
- 风险：上游素材包含极细路径，小尺寸可能损失部分细节。保留原图并通过 28px～68px 总览确认主要识别不受影响。
- 风险：颜色替换遗漏。校验脚本拒绝任何不在目标花色调色板中的颜色。
- 风险：动态资源路径未被 Vite 收集。使用 eager `import.meta.glob`，并在测试和生产 build 中验证 27 个 URL 全部可解析。
- 风险：中央区域窄屏布局被紧凑牌撑开。复用现有 28×39 / 22×31 紧凑尺寸并做桌面与手机横屏视觉检查。
- 回滚边界：只覆盖本任务新增且尚未提交的 27 个 SVG，不影响已有业务改动。

## Pre-start Review Gate

- [x] 用户明确否决第一版并指定新的唯一素材来源。
- [x] 上游仓库提供完整的 27 张透明矢量素材。
- [x] 上游许可证允许本任务的复制、修改、分发与商用。
- [x] 适配方案不重画路径，并继续满足原始画布、透明背景和配色要求。

## Validation Results

- 上游比较：27 个目标文件与提交 `3e275804ff58325306710bef3a7406860444bc6a` 的对应文件 `path d` 完全一致，圆形数量一致。
- 结构：`xmllint`、文件集合、viewBox、安全边距变换、来源标记、禁用元素、外部引用和允许颜色检查全部通过。
- 视觉：大尺寸、51×68px 和 28px 宽总览均已检查，无裁切或映射错误，主要牌面可辨认。
- 接入：所有 27 个 `TileKind` 均可解析到构建资源；旧文字／CSS 点阵牌面规则已删除，全部显示位置继续复用 `MahjongTile`。
- 中央特殊牌：真实人机牌局中亮牌和赖子均渲染紧凑型 SVG 牌；手机横屏断点下均为 22×31px，赖子保留“赖”角标和 `aria-label`。
- 浏览器：桌面与 844×390 手机横屏已目视检查；当前牌局 30/30 个牌组件均含 SVG，控制台无错误。
- 格式：集成源码与任务记录的 Prettier check 通过；SVG 由 XML／结构专用脚本校验。
- 工程：`pnpm lint`、全仓 `pnpm typecheck`、全仓生产 `pnpm build` 全部通过。
- 测试：13 个测试文件、79 项测试全部通过。
