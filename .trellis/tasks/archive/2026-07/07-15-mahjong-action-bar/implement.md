# 实施清单：碰杠动作条与手牌高亮

范围仅限 `apps/web`（组件 + `styles.css`）。

## 顺序执行项

1. **派生逻辑模块（可单测，建议新文件如 `apps/web/src/components/actionEligibility.ts`）**
   - 输入：`room: RoomProjection`、`self: PlayerProjection`（含 `hand`）、`selfSeat: Seat`。
   - 导出一个函数，返回当前"响应目标弃牌"（`room.roundPhase === "DISCARD_RESPONSE"` 时 `playerAt(room, room.currentSeat).discards.at(-1)`，否则 `null`）。
   - 导出高亮牌 id 集合的计算函数，按 prd.md R2 规则分别处理碰/明杠/亮牌特殊碰（来自弃牌同款）、暗杠（手牌凑 4，排除 `room.wildcardKind` 同款）、补杠（手牌牌与自己 `PONG` melds 同款）。用 `room.legalActions` 判断当前具体是哪种，只计算相关的那部分，避免误高亮。
   - 导出一个"自动选取来源牌"函数，供杠/补杠按钮点击时构造 payload：暗杠返回 `{suit, rank}`（选中凑 4 组中的任意花色点数）；补杠返回 `{meldId, tileId}`（该手牌 tile 的 id + 匹配的 `PONG` meld id）。
   - 写单元测试覆盖：无待响应弃牌时不高亮、暗杠排除赖子、暗杠同时两组时都返回、补杠找到正确 meldId、非法阶段返回空集合。

2. **动作条组件（`GameTable.tsx` 内新增子组件或直接内联）**
   - 新增一个 `PrimaryActionBar`（或类似命名），放在 `self-area` 内、`meld-row`/`hand-composition` 上方。
   - 4 按钮固定顺序：自摸、杠、碰、补杠。每个按钮根据 `room.legalActions` 判断启用态与动态副标签（参考 prd.md R1 的映射表）。
   - 点击处理：复用/扩展现有 `sendAction`，对杠/碰/补杠按钮，若 `selectedTile` 存在且属于当前高亮集合则用它构造 payload，否则调用步骤 1 的"自动选取"函数；自摸/碰(普通+亮牌)/明杠沿用现状直接 `onSend(type)`。
   - `aria-label` 要包含具体动作名（明杠/暗杠/碰/亮牌碰），disabled 态要有 `disabled` 属性。

3. **移除底部 dock 重复入口**
   - 在 `dockActions`/`handActions` 过滤逻辑基础上，新增一个动作类型集合（如 `PRIMARY_BAR_ACTIONS`），从 `dockActions` 中排除掉，只保留 `PASS_RESPONSE`/`CONTINUE_TURN`。

4. **手牌高亮渲染**
   - `MahjongTile` 或其调用处新增一个 `highlighted?: boolean` prop（或复用现有 class 组合方式），命中步骤 1 计算出的高亮 id 集合的手牌（含 `drawn-tile-slot` 里的摸到的牌）加上高亮 class 和 `aria-label` 后缀（如"，可碰"/"，可杠"）。
   - CSS：新增一个高亮样式（描边 + 轻微 box-shadow 光晕，用 `--accent`），不依赖动画帧，`prefers-reduced-motion` 不影响其显示。

5. **响应式适配**
   - 在现有 860px 和短横屏媒体查询块里，为新动作条追加尺寸/间距的适配规则，确保不遮挡手牌、不破坏现有 `self-area` 布局。

## 验证命令

- `pnpm test`（含新增单测）
- `pnpm lint`
- `pnpm --filter @huanghuang/web build`
- 手动：`pnpm --filter @huanghuang/web dev` 启动后，在浏览器里等到机器人局出现碰/杠机会，确认高亮牌与按钮高亮状态一致，点击按钮能正确发出对应动作且服务端接受（无 error toast/回退）。

## 回滚点

- 全部改动集中在 `apps/web` 内的组件与样式文件，可按文件粒度回退，无迁移脚本。
