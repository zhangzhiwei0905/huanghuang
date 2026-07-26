# 小程序音频优化：胡牌拆分/朝天杠音效/语音互动

## Goal

为小程序端游戏音效系统做三项优化，让音效表达更细腻、并新增一个语音互动小功能，提升对局氛围。

## Background / Confirmed Facts

- 音效系统实现在 `apps/miniprogram/src/lib/gameAudioEvents.ts`（根据房间投影快照 diff 出要播放的音效文件名列表）和 `apps/miniprogram/src/lib/gameAudioPlayer.ts`（真正加载/裁剪播放 mp3）。
- 协议层 `packages/protocol/src/game.ts` 已有 `WinType = "HARD" | "SOFT"`（即硬胡/软胡），`RoundSettlementProjection.winType` 在结算时可直接读取，无需新增协议字段。
- 协议层 `MeldKind` 已有 `"INDICATOR_PONG_KONG"` 分支，专门表示碰亮牌（指示牌）；`packages/game-engine/src/round.ts:351-352` 确认亮牌相同的牌只能被"碰"（`CLAIM_INDICATOR_PONG_KONG` 恒定取 2 张手牌 + 1 张打出牌 = 3 张，逻辑上不存在亮牌杠这一分支），因此该 MeldKind 100% 对应"碰亮牌"场景。
- 当前 `gameAudioEvents.ts` 的 `meldAudioFileName()` 把 `INDICATOR_PONG_KONG` 误落到了 `action-kong.mp3` 分支（因为它既不是 `"PONG"` 也不是 `"ADDED_KONG"`）——这是本次要顺手修正的既有小缺陷。
- 服务端已有通用文字聊天广播机制：socket 事件 `room:chat`（`apps/server/src/index.ts:422-433`），配合 `chatMessageInputSchema`（`packages/protocol/src/commands.ts:70-73`，消息 1-60 字符），服务端校验通过后用 `sockets.to(roomId).emit("room:chat", result)` 广播给房间内所有 socket。Web 端（`apps/web/src/hooks/useRoom.ts`、`App.tsx`）已接入此事件；**小程序端 `apps/miniprogram/src/hooks/useRoom.ts` 目前完全未接入 `room:chat`（无发送、无监听）**。
- 5 个新增音频文件已放在 `/Users/zhang/Documents/VscodeFiles/huanghuang/huanghuang-audio/mp3-version/`：`yinghu.mp3`、`ruanhu.mp3`、`chaotiangang.mp3`、`gaokuaidian.mp3`、`woyijingtingle.mp3`。用 `afconvert` 转 wav 后测得完整时长分别为 2.377s / 2.326s / 2.027s / 2.769s / 3.291s。
- **音频裁剪策略（两轮用户反馈后的最终结论）**：只有 `chaotiangang.mp3` 按现有 `action-*` 音效的惯例截取一小段峰值窗口播放（`{startTime:0.62, duration:0.7}`，用一次性脚本——10ms RMS 包络 + 定长滑窗找最高能量区间——计算，并先用 `action-win.mp3`/`action-pong.mp3` 两个已知窗口做过校验）；`yinghu.mp3`、`ruanhu.mp3`、`gaokuaidian.mp3`、`woyijingtingle.mp3` 全部播放完整语音（`startTime:0`，`duration`取满长+安全余量）——`yinghu`/`ruanhu` 最初也被截取过峰值窗口，但用户反馈"不太完整"，已改回满长播放。
- 小程序端已有音效开关 UI 模式（`sound-fab` / `lobby-toolbar__button sound-toggle`，见 `apps/miniprogram/src/pages/room/index.tsx:569-576,614-621`）和 `gameAudioEnabled` 状态、`useGameAudio` hook，新音效应复用同一开关与播放管线。
- 房间页对局中（非 `WAITING` 阶段）的按钮实际分左右两块：`leave-fab`/`sound-fab` 悬浮在**左上角**（`apps/miniprogram/src/pages/room/index.scss:211-262`）；`info-capsule`（含复制邀请码/分享/解散等按钮）悬浮在**右上角**（`index.scss:264-` 起，`right: ...`）且已按 `room.mode === "FRIEND"` 条件显示对应按钮（`index.tsx:633-656`）。用户所说"右侧按钮"对应的是 `info-capsule` 这一块，新语音入口应加在这里，而不是左侧的 sound-fab 旁边。
- 服务端 `createChatMessage`（`apps/server/src/room-service.ts:908-924`）已强制校验：仅 `room.mode === "FRIEND"` 且 `room.stage === "PLAYING"` 时才允许发送，否则返回 `ACTION_NOT_AVAILABLE`；非本房间成员返回 `NOT_A_MEMBER`。因此语音入口需要同时满足 `room.mode === "FRIEND"` 与 `room.stage === "PLAYING"` 才显示/可点击，与服务端限制保持一致（`room.stage` 还有 `WAITING`/`ROUND_RESULT` 两种取值，二者都不允许发聊天消息）。
- `sockets.to(roomId).emit("room:chat", result)`（`apps/server/src/index.ts:431`）中的 `sockets` 是顶层 `Server` 实例（非单个 socket 的 `.to()`），因此广播会包含发送者自己的 socket——发送者本地也会收到这条 `room:chat` 回执并据此播放音效，无需额外做"本地立即播放"的特殊处理。
- `room:subscribe` 处理器已执行 `socket.join(room.id)`，小程序 socket 连接后已在房间的 socket.io room 内，接入 `room:chat` 监听即可收到广播，无需额外 join 逻辑。

## Requirements

### R1 胡牌音效拆分（硬胡/软胡）
- `action-win.mp3` 素材保留在资源与类型定义中（暂不删除），但结算胡牌时不再触发它。
- 结算 `roundSettlement.kind === "WIN"` 时，根据 `winType` 播放：`HARD` → `yinghu.mp3`，`SOFT` → `ruanhu.mp3`。

### R2 亮牌碰特殊音效（朝天杠）
- meld 变化中，`kind === "INDICATOR_PONG_KONG"` → 播放 `chaotiangang.mp3`。
- 其余碰（`kind === "PONG"`）仍播放 `action-pong.mp3`，杠类不受影响。

### R3 语音互动（快捷语音消息）
- 房间页牌桌右下侧（`table-surface` 内，紧邻自己座位卡片 `.player-station.pos-self`）新增一个独立的"快捷消息"按钮，仅当 `room.mode === "FRIEND" && room.stage === "PLAYING"` 时显示（已从右上角 `info-capsule` 移到这里，两条消息不再各占一个按钮，改为点开一个按钮后选择）。
- **UI 走查了两轮，最终结论**：
  1. 点击后**不用**微信系统的 `showActionSheet`，改为游戏内自绘的小气泡框（`design-taste-frontend` 技能过了一遍设计）：气泡背景/边框沿用 `.player-station` 那种奶白玉石卡片材质，气泡下方带一个小三角尖角指向按钮，两条消息各是一行，中间一条分隔线，点击气泡外任意位置关闭且不发送。
  2. 触发按钮本身也重新设计过：不再是复用 `.leave-fab`/`.sound-fab` 那种深色半透明胶囊（用户反馈"有点丑"），改成同样的奶白玉石卡片材质 + 玉绿色文字，左下角做成直角，形成一个"对话气泡"的剪影，不需要额外图标。
- 选择其中一条即发送：
  - "搞快点搞快点" → 对应音频 `gaokuaidian.mp3`
  - "我已经听牌啦" → 对应音频 `woyijingtingle.mp3`
- 发送：小程序端通过既有 `room:chat` socket 事件广播文字消息（`{ roomCode, message }`，复用现成协议与服务端逻辑，不新增协议字段/不新增服务端代码）。
- 接收：`useRoom.ts` 新增对 `room:chat` 事件的监听，暴露最近一条 `ChatMessageProjection` 给房间页；房间内所有客户端（含发送者自己，因服务端广播含发送者 socket）收到消息后，如果消息文本精确匹配上述两条预设文案之一，则本地播放对应音效（通过既有 `gameAudioPlayer`/`gameAudioEnabled` 开关，扩展 `useGameAudio`）。
- 不做可视化聊天气泡/toast（已决策，见下）、不做发送频率限制、人机对战模式不显示入口（已决策）。

## Out of Scope
- 自由输入文字聊天、聊天气泡/消息列表 UI（本次只做语音播放这一层，不做可视化聊天记录）。
- 语音消息的频率限制/防刷屏节流（服务端 `chatMessageInputSchema` 已有长度限制，暂不新增发送频率限制）。
- Web 端同步实现（本次范围限定小程序端；Web 端已有独立聊天 UI，不在本次改动范围）。
- 亮牌杠（4 张）相关音效——代码证实该场景不存在，无需处理。

## Acceptance Criteria
- [ ] 硬胡结算播放 `yinghu.mp3`，软胡结算播放 `ruanhu.mp3`；两种场景均不再播放 `action-win.mp3`。
- [ ] 碰亮牌（`INDICATOR_PONG_KONG`）播放 `chaotiangang.mp3`；普通碰（`PONG`）仍播放 `action-pong.mp3`。
- [ ] 房间页牌桌右下侧新增独立的"快捷消息"按钮（不在右上角 `info-capsule` 内，样式为奶白玉石卡片材质而非深色胶囊），仅 `FRIEND` 模式 + `PLAYING` 阶段显示；点击后弹出**游戏内自绘气泡框**（非系统 `showActionSheet`），可选发送"搞快点搞快点"/"我已经听牌啦"两条预设消息，点击气泡外关闭不发送。
- [ ] 房间内所有客户端（含发送者）在收到对应 `room:chat` 消息时播放匹配音效；且遵循 `gameAudioEnabled` 静音开关。
- [ ] 新增 5 个音频文件已复制到 `apps/miniprogram/src/assets/audio/` 并接入 `gameAudioPlayer.ts` 的 `AUDIO_SOURCES`/`AUDIO_WINDOWS`。
- [ ] 现有单测（`gameAudioEvents.test.ts`、`gameAudioPlayer.test.ts`）更新覆盖新分支，`tsc`/构建通过。

## Decisions (resolved)
- 语音互动入口仅在好友房（`FRIEND`）模式显示，人机对战（`BOT`）模式隐藏，与现有分享/解散按钮的模式判断保持一致。
- 收到语音消息时纯音效播放，不做文字/toast/气泡提示，不新增聊天类 UI 组件。

## Additional: 房间页样式微调（同一 session 内顺带做的，不在原音频需求范围内）

用 `/redesign-existing-projects` 走了一遍，四处定向修复（保留现有玉石/奶白麻将牌美术风格与配色，不重新设计）。**这几点都经过一轮返工**，最终状态如下：

- **左右玩家碰/杠牌间距**：先把 `.player-meld-rail.pos-left/.pos-right` 的 `top` 从 45% 收紧到 37%（原来比同侧 `.player-station` 卡片的 `top:29%` 多出约 16 个百分点的空隙），但用户反馈"碰"这个文字和卡片信息重叠了——两个各自独立猜的百分比没法保证相互对齐。最终改成 `top: calc(29% + 12vmin)`：直接锚定在卡片自己的 `top:29%` 上、再加一个按卡片实际内容（头像行 + 最多两行数值）估算出的固定 vmin 间距，间距会跟着卡片走，不会再错位。仍然比原来的 45% 更远离 `top:46%` 的弃牌区。
- **听牌辅助卡片滚动条**：第一轮只是隐藏滚动条视觉（`ScrollView` + `enhanced` + `showScrollbar={false}` + `::-webkit-scrollbar{display:none}`），保留"两行内滚动"的原设计意图——但用户反馈还是有滚动条，且明确要求"直接展示完整"。最终去掉了 `ScrollView`/滚动容器和固定高度限制，`.ting-hint-card__list` 就是一个普通的 flex 列表，卡片按实际内容高度撑开，展示全部听牌项。
- **玩家信息数值层级**：`.player-station__stat` 拆成三档。`--score` 最大最粗，用现有 `--accent` 玉绿。`--multiplier` 按用户明确要求改成红色——复用现有的 `--danger`（`#7a4b45`，克制的赭红，不是刺眼的警报红），红色在这张卡片上别处没用到，不会和别的元素抢注意力。`--hand` 最小最淡，`--muted` + `opacity:0.8`。JSX 渲染顺序也调整为 积分→倍率→手牌，和视觉权重顺序一致。
- **当前回合高亮**：`.player-station.is-active` 原来的 box-shadow 从完全透明脉冲到 12% 透明度，太弱。改成始终有一圈可见的 jade 描边光晕（脉冲区间是"明显"到"更明显"，不会归零），边框从 1px 加粗到 2px，背景加一层淡淡玉绿色调。**没有加 `transform`**——因为 `.pos-opposite/.pos-left/.pos-right/.pos-self` 各自都设置了自己的 `transform` 做定位，和 `.is-active` 同优先级时后声明的规则会覆盖前面的，加了会在对家（`pos-opposite`）激活时打断居中定位。

这几点（含返工原因）都写进了 `.trellis/spec/frontend/miniprogram.md` 的新 Pattern 章节，供后续 session 参考"为什么第一版不行、最终怎么做"的取舍过程。
