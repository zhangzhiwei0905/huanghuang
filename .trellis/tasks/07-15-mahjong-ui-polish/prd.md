# 牌桌视觉清新化与操作动画

## Goal

在不改变任何对局规则、协议或状态机的前提下，优化 `apps/web` 牌桌页面的视觉与交互反馈：低调模式配色更清新、麻将牌花色更易辨识、碰/杠/放赖动作有明显的动效反馈，并补齐目前缺失的"其他玩家公开组合持久展示"。

## Background

- 当前牌桌已实现两套主题（低调模式、精美模式），共享 DOM 结构与信息层级，详见父任务 `07-15-huanghuang-web-game-plan` 的 `design.md`/`prd.md` R6 节。
- 现状调研发现：`PlayerProjection.melds` 和 `releasedWildcards` 对所有座位都是公开信息，但 `GameTable.tsx` 目前只在 `self-area` 渲染当前玩家自己的 `meld-row`；其他玩家的碰/杠组合和放出的赖子仅通过 3 秒后消失的 `player-action-notice` 悬浮提示短暂展示，随后信息在界面上消失（数据仍在 `room.players[seat].melds` 中，只是未持久渲染）。
- 本任务只涉及 `apps/web` 前端展示层（组件 + `styles.css`），不涉及 `packages/game-engine`、`packages/protocol`、`apps/server`。

## Requirements

### R1 低调模式配色清新化

- 调整低调模式（默认主题，`:root` 下的 CSS 变量）的 `--page` `--panel` `--surface` `--surface-deep` `--accent` 等颜色，从暖灰基调改为浅雾绿 + 米白基调，整体更亮、更透气。
- 保持 R6 对低调模式"零渐变、零强阴影"的限制中与颜色相关的部分不变；仅调整色值，不新增渐变/阴影属性（碰/杠/放赖动画的例外见 R4）。
- 精美模式配色不变。

### R2 花色专属主题色与图案精修

- 万、条、筒三种花色分别使用固定主题色贯穿：花色角标文字、牌面图案、赖子标记边框（复用/重命名现有 `--tile-red`/`--tile-green`/`--tile-blue` 变量体系即可，无需新增变量前缀）。
- 条子（TIAO）图案增加竹节分隔视觉，强化"竹子"辨识度。
- 筒子（TONG）图案统一为单一花色主题色的同心圆样式，去掉当前按位置交替红/绿的配色，避免同一花色内出现多种颜色干扰辨识。
- 万字（WAN）图案配色不变（已有独立红色系），仅随 R1 的背景色调整做对比度复核。
- 两套主题下花色主题色都必须与各自背景保持 WCAG AA 级别的可读对比度。

### R3 其他玩家公开组合持久展示

- 每个座位（不限于自己）在 `PlayerStation` 内新增一个公开组合展示区，使用 compact 尺寸的 `MahjongTile` 渲染该玩家的 `melds`（碰/明杠/暗杠/补杠/亮牌特殊碰），全程可见，不随通知消失。
- 有 `releasedWildcards` 时，座位旁展示一个"赖 ×N"小标签（N 为该玩家当局已放赖数量），与已展示的 `personalMultiplier` 数值互为补充，不重复放整排赖子牌面（避免窄屏空间不够）。
- 该展示区必须在断线重连、页面刷新后从当前 `RoomProjection` 正确恢复（无需新增前端本地状态持久化，直接从 projection 派生）。
- 窄屏（`max-width: 860px` 断点及以下）下允许进一步压缩显示（如省略号折叠、更小尺寸），但不得完全隐藏已有公开组合。

### R4 碰/杠/放赖动作动画

- 复用现有 `playerActionNotice.ts` 的快照 diff 检测机制（`createPlayerActionSnapshot` / `detectPlayerActionNotice`），不改变其检测逻辑，只扩展消费侧的动画表现。
- 三类动作需要有明显区分度的动效，且两套主题使用同一强度：
  - **碰（PONG）**：牌以"滑入 + 轻回弹"进入目标展示区，伴随一次金色/主题色描边闪烁。
  - **杠（EXPOSED_KONG / CONCEALED_KONG / ADDED_KONG / INDICATOR_PONG_KONG）**：比碰更强烈——轻微震动 + 两次光圈脉冲。
  - **放赖（RELEASE_WILDCARD）**：赖子牌"抛物线甩出 + 翻转"，带拖尾光晕，强调该牌离开手牌。
- 动画只使用 `transform` / `opacity` / `box-shadow`（颜色关键帧允许，用于描边与光圈闪烁），不使用会触发重排的属性（`width`/`height`/`top`/`left` 持续动画禁止，定位仍可用 `transform` 完成）。
- 新落地的公开组合（R3 新增展示区）在出现的短时间窗口内（约 600ms–900ms）应用"新出现"高亮态，过后恢复为静态展示；自己座位（`self-area` 内的 `meld-row`）的新组合同样应用该高亮态。
- 必须遵循 `@media (prefers-reduced-motion: reduce)`，reduce 模式下动效直接跳到终态，不做位移/闪烁过程。
- 不引入新的前端依赖（不使用 Framer Motion / GSAP 等动画库），继续使用纯 CSS `@keyframes` + React class/key 触发的既有模式。

### R5 规格文档同步

- 更新父任务 `07-15-huanghuang-web-game-plan` 的 `prd.md` R6 节，说明低调模式"禁止渐变、强阴影、发光和显眼游戏化动画"这条限制新增例外：碰/杠/放赖三类动作反馈允许使用本任务定义的强度和形式（描边闪烁、光圈脉冲、抛物线动效），其余场景（如常规按钮、页面切换）仍遵循原限制。
- 更新完成后需在父任务的 spec 索引（如涉及）或本任务内注明该例外的最终措辞，避免后续实现与文档表述冲突。

## Constraints

- 不修改任何协议类型（`packages/protocol`）、状态机、结算或胡牌规则；`GameTable.tsx` 中所有数据仍来自现有 `RoomProjection`，不新增服务端字段。
- 不改变现有主题切换机制（`data-theme` 属性）、无障碍语义（`aria-label` 等）、触控热区尺寸（按钮 `min-height: 44px` 等既有规范）。
- 保持现有 `playerActionNotice.test.ts` 等测试语义不变；如新增测试，覆盖新的展示区派生逻辑或动画类名切换逻辑（非视觉像素级测试）。
- 手机横屏为第一目标、桌面浏览器兼容，已有的响应式断点（860px、landscape 矮屏）需要同步适配新增的公开组合展示区，不得破坏现有布局。

## Out of Scope

- 精美模式的配色调整（本次只改低调模式的基调色值，精美模式配色不变）。
- 新增可切换的第三套主题。
- 抢杠胡、一炮多响、七对等规则相关内容（与本任务无关）。
- 引入动画库依赖或 SVG/图片素材资源。
- 服务端、协议包、game-engine 包的任何改动。

## Acceptance Criteria

- [ ] AC1：低调模式在浏览器中呈现浅雾绿 + 米白的清新基调，精美模式视觉不变。
- [ ] AC2：万/条/筒三种花色在手牌、弃牌、公开组合、亮牌位置都能通过颜色在 0.5 秒内快速分辨，筒子内部不再出现红绿交替配色。
- [ ] AC3：任意座位（含非自己）发生碰/杠后，其公开组合牌面持久显示在该玩家座位区域，刷新页面后仍正确显示；放赖后座位旁显示正确的"赖 ×N"。
- [ ] AC4：碰、杠（四种杠类型统一动效即可）、放赖三类动作触发时，在自己视角均能看到与描述一致、且彼此有明显区分度的动效；`prefers-reduced-motion: reduce` 下动效跳过位移/闪烁直接到终态。
- [ ] AC5：`apps/web` 现有测试（含 `playerActionNotice.test.ts`）与新增测试全部通过；`pnpm --filter web` 相关 lint/typecheck 通过。
- [ ] AC6：父任务 `prd.md` R6 节完成文档同步，明确写出碰/杠/放赖动效例外的措辞。
