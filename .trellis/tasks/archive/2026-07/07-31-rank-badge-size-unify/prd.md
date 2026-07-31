# 段位徽章尺寸统一

## Goal

段位徽章（`RankBadge` 组件）目前整体偏大，且不同段位视觉大小不统一：黑铁/青铜等素材在 `viewBox="0 0 160 180"` 画布内留白多，缩放后显小；铂金/钻石/星耀/雀神(王者) 等素材图形本身超出 viewBox 边界被裁切，缩放后显得贴边偏大（雀神左右合计溢出超过60px）。目标：整体缩小徽章尺寸，同时让 8 个段位在同一 size 档位下视觉大小完全一致。

## Requirements

- 重新对齐 `apps/miniprogram/src/assets/ranks/*.svg` 8 个段位素材相对 `viewBox="0 0 160 180"` 的图形边界：统一留白比例，且不允许图形超出 viewBox 被裁切（铂金/钻石/星耀/雀神需要收缩或重新居中图形）。
- 在素材对齐的基础上，整体调小 `RankBadge.scss` 中 `compact`/`medium`/`large` 三档的 width/height（含 min-width/min-height），具体缩小比例以视觉观感为准，避免小于当前 min-width/min-height 导致低分辨率设备下过小无法辨认。
- 同步调整 `apps/miniprogram/src/pages/room/index.scss` 中 `.seat-rank-badge .rank-badge__image` 的覆盖尺寸，保持与整体缩小比例一致。
- 不改变 `RankBadge` 组件的 API（`size` 属性的 compact/medium/large 三档语义不变），不影响其他调用方（`index.tsx`、`PlayerProfileModal.tsx`、`RoundSettlementModal.tsx`、`RankPromotionOverlay.tsx`）的调用方式。

## Acceptance Criteria

- [x] 在开发者工具中依次查看 8 个段位徽章（可通过临时切换测试账号段位或直接对比素材渲染），同一 size 档位下 8 个徽章的可见图形大小肉眼一致，无明显偏大/偏小。
- [x] 首页、房间座位、个人信息弹窗、结算弹窗、升段动画等各处徽章展示均正常，无裁切、无变形、无遗漏。
- [x] 徽章整体视觉尺寸比修改前更小（符合用户"可以小一点"的诉求）。
- [x] TypeScript/构建无新增错误。

## Notes

- 根因排查见对话记录：CSS 尺寸设置本身没问题（已用 vmin 固定值统一），问题在 SVG 素材内部图形相对 viewBox 的边界不统一。
- 涉及文件：`apps/miniprogram/src/assets/ranks/*.svg`（8个）、`apps/miniprogram/src/components/RankBadge.scss`、`apps/miniprogram/src/pages/room/index.scss`（约638-643行）。
- 轻量任务，PRD-only 即可。
