# 实施清单：牌桌视觉清新化与操作动画

范围仅限 `apps/web`（组件 + `styles.css`）与父任务 `07-15-huanghuang-web-game-plan/prd.md` 的 R6 文档同步。

## 顺序执行项

1. **配色变量（R1）**
   - 编辑 `apps/web/src/styles.css` 的 `:root` 低调模式变量块：`--page`/`--panel`/`--surface`/`--surface-deep`/`--line`/`--line-strong`/`--accent`/`--accent-ink` 改为浅雾绿+米白基调。
   - `:root[data-theme="premium"]` 块不动。
   - 用浏览器/对比度工具复核正文文字（`--ink` on `--page`/`--panel`）与 `--muted` 文案的可读对比度。

2. **花色主题色与图案（R2）**
   - `apps/web/src/styles.css`：统一 `.tile-face-tong .tile-motif-grid i` 系列规则为单一筒色（现 `--tile-blue`），删除 `nth-child(3n+1)`/`nth-child(3n+2)` 的红绿交替覆盖。
   - `.tile-face-tiao .tile-motif-grid i` 增加竹节分隔（如 `background-image: linear-gradient(...)` 不允许渐变则改用 `box-shadow`/伪元素横线模拟节点）；删除现有 `nth-child(4n)` 的红色交替（保持条=统一绿色系）。
   - 复核 `.tile-face-wan` 在新背景下的对比度，必要时微调色值（不改变结构）。
   - `apps/web/src/components/MahjongTile.tsx` 仅在图案确需新增 DOM 节点（如竹节线）时才改动，优先纯 CSS 方案。

3. **持久公开组合展示区（R3）**
   - `apps/web/src/components/GameTable.tsx` 的 `PlayerStation`：新增 `melds` / `releasedWildcards` 参数，渲染一个 compact `MahjongTile` 组合行（复用现有 `MeldGroup`）+ 有放赖时的"赖 ×N"标签。
   - 调用处 `SEATS.map(...)` 传入 `playerAt(room, seat).melds` 与 `.releasedWildcards`。
   - `apps/web/src/styles.css` 新增对应布局样式，并在 860px / 矮屏横屏断点媒体查询中适配尺寸，不破坏现有 `player-station` 布局。

4. **动作动效（R4）**
   - 扩展 `playerActionNotice.ts` 的消费侧（不改检测逻辑）：`GameTable.tsx` 中按 `notice.action` 归类为 `pong` / `kong`（四种杠类型统一）/ `wildcard` 三档，映射到不同 CSS 类名。
   - `styles.css` 新增三组 `@keyframes`（滑入回弹 / 震动+双光圈 / 抛物线甩出+翻转），全部基于 `transform`/`opacity`/`box-shadow`。
   - 为 R3 新增的持久展示区里"新出现"的牌应用短时高亮类（600–900ms 后自动移除，可用现有 `key` 重挂载或 `setTimeout` 清除 class 的模式，参考现有 `actionNotice` 的 `useEffect` 定时器写法）。
   - 自己座位的 `meld-row` 新增组合同样触发高亮态。
   - 在 `@media (prefers-reduced-motion: reduce)` 块中让上述新增关键帧动画等效为跳过位移，直接呈现终态（现有该媒体查询已全局 `transition: none`，需确认 `animation` 也被覆盖或显式加规则）。

5. **文档同步（R5）**
   - 编辑父任务 `.trellis/tasks/07-15-huanghuang-web-game-plan/prd.md` 的 R6 节，在"禁止渐变、强阴影、发光和显眼游戏化动画"一句后补充例外表述（碰/杠/放赖三类动作允许描边闪烁、光圈脉冲、抛物线动效）。

## 验证命令

- `pnpm test`（根级 vitest run，覆盖 `playerActionNotice.test.ts` 等）
- `pnpm lint`（根级 eslint .）
- `pnpm --filter @huanghuang/web build`（tsc --noEmit + vite build，确认类型检查通过）
- 手动：`pnpm --filter @huanghuang/web dev` 启动后，在浏览器里实际触发一次碰/杠/放赖（可用现有 mock/测试房间或机器人局），肉眼确认三种动效区分度、公开组合持久展示、断线重连（刷新页面）后展示区仍正确。

## 回滚点

- 每一步改动仅限 CSS 与 `apps/web` 组件文件，Git 层面可按文件粒度回退，无数据库/协议迁移，无需额外回滚脚本。
