# 执行计划：小程序横屏体验优化

## 追加发现：出牌/碰等指令从未真正发送成功（根因已修复，超出原 R1-R4 范围）

样式改造完成后用户实测发现：选牌后点"出牌"始终没有效果。用 `superpowers:systematic-debugging` 走了一遍根因排查（临时加日志 → 拿到用户提供的控制台输出）：

- 证据：`[debug] game:command ack {accepted: false, errorCode: "INVALID_COMMAND"}`，且发出的 `requestId` 是 `"req_1784632834359_bd3ec5c1331e5"` 这种自定义格式，不是 UUID。
- 根因：`packages/protocol/src/commands.ts:24` 的 `commandEnvelopeSchema` 要求 `requestId: z.uuid()`；`apps/miniprogram/src/api/http.ts` 的 `createCommand` 原本在 `crypto.randomUUID` 不存在时退化成 `req_<timestamp>_<random>` 格式。微信小程序 JS 运行时没有 `crypto` 全局对象（没有 Web Crypto API），所以这个 fallback 分支 100% 会命中，导致小程序端发出的**每一条** `game:command`（出牌、碰、杠、过、自摸……）都在服务端 zod 校验阶段就被拒绝，和是否选中牌、是否轮到自己、UI 样式完全无关。这是一个改造前就存在的潜在 bug，本次只是通过体验优化的走查过程把它暴露出来了。
- 修复：`apps/miniprogram/src/api/http.ts` 新增 `randomUUIDv4()`，`crypto.randomUUID` 不可用时手写一个符合 RFC4122 v4 格式的 UUID 生成逻辑，替换原来的 `req_...` fallback。`apps/web/src/api.ts` 里有同名的 `createCommand`（Web 浏览器普遍支持 `crypto.randomUUID`，未观察到同样问题），本次未动，如果之后要收敛成共享实现可以再单独立项。
- 状态：代码修复已完成、`typecheck`/`build:weapp`/`prettier` 已过；**功能是否恢复正常需要你在开发者工具里重新编译后实测确认**（选牌 → 出牌 → 牌是否真的从手牌里消失、桌面弃牌区是否出现这张牌）。

## 追加发现二：弃牌环形定位的两处真实重叠 bug（用户实测反馈）

功能修复后用户在真机走查发现：弃牌展示仍不清晰、亮牌/赖子挡住弃牌、碰杠后的展示位置不对。逐项排查：

- **亮牌/赖子挡住弃牌的根因**：`room.roundPhase` 是后端原始英文枚举（`"TURN_DECISION" | "DISCARD_RESPONSE" | "ROUND_OVER"`），`index.tsx` 之前直接把它渲染进 `.center-status`（`max-width:18vmin`，无 `overflow`/`white-space` 处理）。这类长英文字符串（且带下划线，浏览器/小程序默认不会在下划线处断行）会撑爆 `table-center` 的实际宽高，超出我按"单行文字"估算的尺寸，从而侵入上下左右按牌桌中心定位的弃牌环。修复：新增 `phaseLabel()` 把阶段映射成简短中文（"回合进行中"/"等待响应"/"本局结束"），并给 `.center-status` 补上 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` 兜底，防止今后任何异常长文本再次撑破布局。
- **左右弃牌环与牌桌中心的真实重叠（数学验证到的 bug，非猜测）**：`table-center` 实际宽度 ≈ 32vmin（两个 8vmin 侧块 + 14vmin 主块 + 2 个 1.2vmin 间距），半宽 ≈16vmin；而 `.discard-zone.pos-left/.pos-right` 之前的偏移量是 15vmin（小于 16vmin），意味着左右弃牌环的内侧边缘本来就在 `table-center` 的footprint 内部——不管文字问题修不修，横向都会重叠。已将偏移量改成 18vmin（留出 ~2vmin 安全边距），弃牌区宽度从 15vmin 收窄到 11vmin。
- **上下弃牌环的偏移量**：原 9.5vmin 的偏移本身留有安全余量（`table-center` 半高约 4.5vmin），主要是被上面的文字撑爆问题連累；文字修复后此偏移可以适度收紧到 7.5vmin，视觉上更紧凑、更贴近 Web 端的比例（参照 `apps/web/src/styles.css` 横屏断点下 discard-position-top/bottom 相对 table-center 的比例换算）。
- **碰/杠展示位置**：Web 端把碰杠的实体牌（`MeldGroup`）渲染在每个玩家的 `player-station` 信息卡内部（不是牌桌中央或弃牌区），小程序原来是在同一位置但只显示"碰8万"这样的文字 chip，信息密度低、也不直观。已改成和 Web 一致：在 `player-station__melds` 里用真实 `MahjongTile` 小图渲染每一张碰/杠的牌（`meld.tileIds` + `meld.tileKind`），`player-station` 的 `max-width` 从 26vmin 放宽到 30vmin 给牌面留出空间。

以上都是基于精确的宽高数学核算（table-center/discard-zone 的 vmin 尺寸相减），不是凭感觉微调；但最终视觉效果仍需要在微信开发者工具里过一遍确认，尤其是矮屏机型和多个碰杠同时出现时 player-station 是否会长得太高。

## 追加发现三：胡牌结算弹窗（新功能，对齐 Web 端 RoundSettlementModal）

用户反馈胡牌后小程序端毫无提示——之前只有 `room.stage === "ROUND_RESULT" && room.mode === "BOT"` 时的一条"再来一局"按钮，没有结算详情。Web 端有完整的 `RoundSettlementModal`（`apps/web/src/components/GameTable.tsx:463-575` + `apps/web/src/styles.css:1254-1408`），基于 `room.roundSettlement`（`RoundSettlementProjection`：`finalHands`/`scoreChanges`/`winnerSeat`/`winType` 等）渲染每位玩家的终局手牌、个人倍率、本局/累计得分。

新增 `src/components/RoundSettlementModal.tsx` + `.scss`，结构对齐 Web 版（去掉了 Web 有但小程序整体没有的头像列，因为小程序 `player-station` 本来就不显示头像）；在 `index.tsx` 里用 `room.roundSettlement !== null` 判断渲染，替换掉原来那条独立的"再来一局" `result-bar`（避免和弹窗内的"继续游戏"按钮重复）。`onContinue`/`onLeave` 分别接到既有的 `roomCtrl.continueBot()` / `roomCtrl.leaveRoom()`，FRIEND 模式下不显示操作按钮（和 Web 端一致，好友房结算后走的是"返回房间准备"流程）。

`typecheck` / `build:weapp` / `prettier` 均已通过；胡牌结算的弹窗视觉效果（尤其手牌区域较长时的横向滚动、矮屏机型下弹窗高度）需要实机确认。

## 追加发现四："离开房间" 400 根因 + 中心信息框/碰杠展示重做

- **400 根因（已用 Fastify 源码验证，非猜测）**：`apps/miniprogram/src/api/http.ts` 的 `request()` 之前无条件给每个请求都带 `Content-Type: application/json`；`roomApi.leave()`（`DELETE /api/rooms/:code`）不发 body。Fastify v5 默认 JSON body parser 在"声明了 json content-type 但 body 为空"时会抛 `FST_ERR_CTP_EMPTY_JSON_BODY` → 400（`node_modules/.pnpm/fastify@5.10.0/.../errors.js:122`）。对照 `apps/web/src/api.ts:17-21`，Web 端本来就是"有 body 才设置 Content-Type"，同一个 `leave()` 之所以没事就是因为压根没触发这条路径。已把 mp 的 `request()` 改成同样的条件判断。这个 bug 和本次 UI 改造无关、一直存在，只是"离开房间"这个按钮之前很少被真正点到验证。
- **中心信息区加框**：`亮牌 / 余牌+状态+倒计时 / 赖子` 三个块之前只有中间块单独有边框背景，两侧亮牌/赖子块是"裸"的、容易被当成和弃牌区混在一起。改成整个 `table-center` 统一一个带边框+背景的框，内部用竖线分隔三块（做法参考 Web 端 `.indicator-block{border-right}` / `.wildcard-block{border-left}`）。框体尺寸变化后，相应把上下弃牌环偏移从 9vmin 调到 9.5vmin、左右从 20vmin（原 18vmin）留出更大安全边距。
- **碰杠展示 + 放过的赖子（新发现遗漏功能）**：mp 之前完全没渲染 `player.releasedWildcards`（Web 端有、协议字段本来就有），现在补上，展示最新一张 + `×N` 计数，和 Web 端 `released-wildcard-zone` 一致。碰杠的牌和放赖的牌统一用比手牌/弃牌更小的一档尺寸（3.6×5vmin，和弃牌区同一尺寸），避免多个碰杠堆起来把玩家卡片撑得过高、顶到旁边的弃牌环。

以上都已过 typecheck / build / prettier；400 的修复是本轮最有把握的一处（有 Fastify 源码 + Web 端对照双重证据），中心框体和碰杠尺寸调整仍属于"结构上更稳"的改动，具体像素观感要靠设备走查确认。

## 有序任务清单

1. **全局按钮 reset + 主题清理**（R4，先做，风险最低、影响全局）
   - `src/styles/theme.scss`：新增 `button` / `button::after` reset（见 design.md §5）。
   - `src/styles/theme.scss`：核对 `.btn-accent` / `.btn-ghost` / `.btn-danger` 的 `border-radius` 与 `index.scss` 里同名类的覆盖是否冲突，统一为圆角/胶囊，删除矩形化的 `!important`。
   - `index.scss` 里所有 `!important` 覆盖的 `border-radius`（`header-btn` / `btn-accent` / `btn-ghost` / `score-chip`，约 106-269 行）统一确认为圆角值（`999px` 或与设计一致的大圆角）。
   - Taro `<Button>` 元素补充 `hoverClass`（按下态），新增 `.is-pressed { opacity: 0.8; transform: scale(0.97); }` 之类的类。

2. **ActionDock 挪位 + 视觉改造**（R1）
   - `ActionDock.tsx`：空状态从渲染占位 `View` 改为 `return null`。
   - `ActionDock.tsx` / `ActionDock.scss`：按钮从 `10.5vmin` 图标放大到约 `13-15vmin`（min 56 / max 84px），改用圆形/胶囊背景 + `hoverClass` 按下反馈，去掉贴底通栏样式（`border-top`、通栏 `background`）。
   - `index.tsx`：把 `<ActionDock .../>`（现第 324 行）从 `table-surface` 外部移入 `self-area` 内、`self-hand` 之前。
   - 手动检查按钮区域和 `self-hand` 是否有重叠（尤其是横屏矮屏机型），必要时给 `self-area` 增加 `gap`。

3. **弃牌区环形定位**（R2）
   - 读取 `MahjongTile.scss` 现状（已确认：`.mj-tile--compact` 现为 `3.8vmin × 5.4vmin`，min 20×28px / max 28×40px）。
   - 决定：直接放大 `.mj-tile--compact` 尺寸（如 `4.6vmin × 6.4vmin`，min 26×36px / max 34×48px），因为该类只用于 indicator / wildcard 预览 / 弃牌三处（已用 grep 确认 `index.tsx:270/286/303`），放大对这三处都是收益，不需要新增变体类。
   - `index.scss` 里 `.discard-zone.pos-*`（401-442 行）改为以 `.table-center` 实际中心为基准的 `top:50%; left:50%; transform: translate(...)` 写法，四个方位统一参照系，具体偏移量需要在微信开发者工具里目测调整到不与 `player-station` / `self-area` 重叠。
   - `pos-left` / `pos-right` 改为竖排（`flex-direction: column`）以适配放大后的牌面宽度。

4. **Header 浮层化 + 独立离开按钮**（R3）
   - `index.tsx`：`PLAYING` / `ROUND_RESULT` 分支（stage !== "WAITING"）里，把现有 `game-header`（147-173 行）拆成：
     - 左上角独立悬浮"离开"按钮（`position:absolute`，`onClick={() => void roomCtrl.leaveRoom()}` 不变）。
     - 一个信息胶囊（房号/底分/连接状态，FRIEND 模式下的复制房号/解散按钮），`position:absolute` 悬浮在背景图上，非通栏背景。
   - `index.scss`：新的浮层选择器加圆角背景（半透明胶囊），移除 `game-header` 的通栏 `background` / `border-bottom`（仅对牌桌态生效；`WAITING` 分支继续用旧 `game-header`，见 design.md §4 决策）。
   - 确认 `table-surface` 高度撑满 `game-shell__content` 剩余空间（不再需要给 header 预留固定高度的 flex 兄弟节点，因为浮层是 `position:absolute` 脱离文档流）。
   - `theme.scss` 里的旧版 `.game-header` 全局样式按第 1 步顺带核对是否需要清理，避免残留规则在浮层化后仍然渲染出通栏背景。

5. **联调走查**
   - 微信开发者工具，切换 2-3 种机型预设（含矮屏机型，如 max-height:500px 附近），确认：
     - 无可用操作时 `ActionDock` 不占位、不残留背景条。
     - 有可用操作（如"碰"）时按钮出现在手牌正上方，点按有效且视觉是圆角反馈，无原生矩形描边。
     - 弃牌区四个方位牌面清晰、不与玩家信息卡/手牌重叠。
     - 悬浮"离开"按钮可点，能正常触发离开房间。
     - `WAITING` 大厅、`ROUND_RESULT` 再来一局流程未受影响。

## 验证命令

```bash
pnpm --filter miniprogram typecheck
pnpm --filter miniprogram build:weapp
pnpm lint
pnpm format:check
```

## 风险点 / 回滚

- 步骤 1（全局 button reset）影响面最广，若发现某处按钮因为 reset 丢失了预期的原生反馈，优先在该按钮自身补 `hoverClass`，不要放宽全局 reset。
- 步骤 4（header 浮层化）改动结构较大，若横屏矮屏机型下浮层严重遮挡牌桌，可临时把信息胶囊収窄或换更靠边的位置，不需要回退整个浮层化方案。
- 每一步都是 `index.scss` / `index.tsx` / `ActionDock.*` / `theme.scss` 里相对独立的选择器或 JSX 片段改动，出问题可以逐步骤 `git diff` 定位回滚，无需整体回退。

## 收尾前检查

- [x] `prd.md` 的 Acceptance Criteria 全部可对照验证（代码层面已落实，视觉细调依赖下方设备走查）。
- [x] `pnpm --filter miniprogram typecheck` / `build:weapp` 通过；`pnpm format:check` 仅对本次改动的 6 个文件通过（全仓库存在改动前就已存在的 110 个文件格式漂移，未处理，超出本任务范围）；`pnpm eslint` 未覆盖 `apps/miniprogram`（仓库 `eslint.config.js` 全局忽略该目录，非本任务引入）。
- [ ] 微信开发者工具走查未执行——当前环境没有微信开发者工具，需要人工在真机/模拟器里验证（见步骤 5 的检查清单，尤其是弃牌环形定位的具体偏移量和矮屏机型下的重叠情况）。
