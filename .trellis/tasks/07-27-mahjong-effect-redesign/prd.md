# 重制五个麻将动作特效并压缩可见时长

## Goal

用新设计的 5 版 Lottie 动画（碰/杠/补杠/放赖/胡牌，已在设计稿中确认）替换
`apps/miniprogram/src/effects/mahjong/data/*.cjs` 里的旧素材，同时把每个动作的
**可见时长**压缩到贴近仓库里已经调好的基线（碰 450ms / 杠系 700ms / 补杠 650ms /
放赖 800ms / 胡牌 1050ms），确保：

1. 动作反馈不拖慢正常出牌节奏（可见时长明显短于设计稿原始时长 0.75–2.1s）。
2. 动画一放完就消失，不在桌面上停留——沿用仓库里已有的"播放完立即
   `destroy()` canvas + 90ms CSS 淡出"机制，而不是等服务端 `endsAt` 到点才隐藏。

## Context

仓库当前有一份**未提交**的改动（非本任务产生），已经把这套"短时长 + 播完即
消失"的机制搭好了：

- `apps/server/src/room-service.ts` 的 `EFFECT_DURATION_MS`（交互锁时长）已从
  2000–2800ms 降到 500–1600ms。
- `apps/miniprogram/src/lib/mahjongEffect.ts` 新增 `EFFECT_VISUAL_DURATION_MS`
  + `effectVisualEndsAt()`，给每个动作一个比交互锁更短的"可见时长"上限。
- `MahjongEffectOverlay.tsx` 在 Lottie `complete` 事件和一个兜底 `setTimeout`
  上都会调用 `hideAndDestroy()`，播放到 `op` 帧立即隐藏并销毁 canvas，不再依赖
  server 的 `endsAt` 才隐藏。
- `runtime.ts` 的 `presentationProfiles` 给每个动作定义了 `outPoint`（在完整
  动画基础上提前截断尾巴）和一份 `layerNames` 白名单（从更丰富的源文件里挑出
  要展示的图层）。

这套基础设施本任务**保留不变**，只是：

- 换掉 5 个 `.cjs` 动画数据文件（用设计稿里确认的新版本）。
- 重新计算每个动作的 `outPoint`（新素材的图层名称、关键帧完全不同）。
- 因为新素材是"按最终呈现设计的"，没有旧素材那种"塞进多余图层再筛选"的
  需求，`layerNames` 白名单可以简化成"全部保留"（不再需要按名字过滤）。
- 相应调整 `EFFECT_VISUAL_DURATION_MS` 里 5 组数值，对齐新素材的裁剪点。

## Non-Goals

- 不改动结算弹窗等其他已在 diff 里但与本次体验优化无关的改动（那些是已有
  工作的一部分，照常保留）。
- 不引入新的 Lottie 能力（遮罩、混合模式等）——继续保持 canvas 渲染器安全的
  子集（形状/描边/填充/Trim Path），因为 `lottie-miniprogram` 就是靠这个子集
  渲染的。

## Requirements

1. **素材替换**：5 个 `data/*.cjs` 文件替换为新设计（碰=对撞/杠=金爆上升/
   补杠=补位锁定/放赖=雷霆加倍/胡牌=红金喜庆），`meta.tileSlot` /
   `meta.tileCode` / `meta.tileSize` 保留在需要贴牌面的图层上，供
   `tile-faces.cjs` 按 `TileKind` 换面。
2. **裁剪点**：`runtime.ts` 的 `presentationProfiles` 按下表更新
   `outPoint`（`ip` 统一为 0，除非某个动作的开场本身就有一段可以跳过的
   死片头）；`layerNames` 改为「不再过滤，保留新素材的全部图层」。
3. **时长常量**：`mahjongEffect.ts` 的 `EFFECT_VISUAL_DURATION_MS` 按下表更新。
4. **裁剪原则**：每个动作的 `outPoint` 必须落在"主角动作（图章/主体）已经
   稳定显示、清晰可读"之后，"长时间的呼吸/停留/淡出尾巴"之前——因为淡出
   已经由 `MahjongEffectOverlay.scss` 里 90ms 的 CSS `opacity` 过渡负责，
   Lottie 数据本身不需要再画一段淡出。
5. **测试**：更新 `mahjongEffect.test.ts`（`loadMahjongAnimationData` 断言的
   `op`/`fr`/`layers`/`meta.presentation`）；`room-service.test.ts` 中不受
   影响的部分维持不变（server 端时长本任务不改）。

### 目标裁剪表（设计依据见 `design.md`）

| 动作 | Cue action | 可见时长 (ms) | 源素材 outPoint (60fps) | 相对设计稿播放速度 |
|---|---|---|---|---|
| 碰 | PONG | 450 | 27 | 1.00× |
| 杠 | EXPOSED/CONCEALED/INDICATOR_KONG | 700 | 42 | 1.00× |
| 补杠 | ADDED_KONG | 650 | 39 | 1.00× |
| 放赖 | RELEASE_WILDCARD | 800 | 48 | 1.00× |
| 胡牌 | WIN | 1050 | 63 | 1.00× |

## Acceptance Criteria

- [x] 5 个 `data/*.cjs` 文件内容替换为新设计，`node -e "require(...)"` 能正常
      加载，`w/h` 仍是 512。
- [x] `runtime.ts` 的 `presentationProfiles` 按上表更新 `outPoint`，
      `layerNames` 逻辑简化（新素材不再需要按名字过滤掉多余图层）。
- [x] `mahjongEffect.ts` 的 `EFFECT_VISUAL_DURATION_MS` 按上表更新。
- [x] `pnpm --filter miniprogram test` 相关 vitest 用例更新后全部通过（13/13，
      全仓库 212/212）。
- [x] 用 `lottie-web` canvas 渲染器本地跑一遍五个动作，确认：主体在
      `outPoint` 帧时清晰可读、没有明显被腰斩的动作（比如角色/牌面飞到一半
      戛然而止）。
- [x] `pnpm --filter server test` 中未涉及本任务改动的用例（`EFFECT_DURATION_MS`
      相关）保持原样通过，不因本任务改动而漂移（44/44）。

## Follow-up (not blocking)

- 5 个新 `.cjs` 文件合计约 400KB（旧素材约 280KB）。因为每个动画大部分内容
  会被 `outPoint` 裁掉不渲染，这部分是"打包体积"而非"运行时开销"——如果
  小程序分包接近 2MB 限制，可以考虑把裁掉的尾部内容从源文件里物理删除，
  而不是留在 JSON 里靠裁剪点跳过。本任务未处理，先记录。

## 追加体验优化（2026-07-27）

用户实机体验后确认，两级时长带来的尾部空等不可接受：Lottie 已经播完后，
服务器仍保持 `pendingEffectTransition`，碰/杠不能立刻继续出牌，放赖也要再等
一段时间才显示补摸牌。

新增要求：

1. `EFFECT_DURATION_MS` 与五组客户端可见时长保持一致，使动画播完即到达
   服务端状态提交点；服务端轮询本身的附加延迟也要压缩到不易察觉的范围。
2. 语音恢复 Git 历史 `fab59a1` 的“预热 URL + 双上下文池”方向：普通节奏下
   每条短语音自然念完；快速节奏允许最多两条短暂重叠，不排队、不截断正在
   播放的语音，超过双槽容量的新提示直接丢弃。
3. 音频上下文必须固定复用，切换音频时清理上一轮事件监听器，避免反复
   create/destroy 或监听器累积导致越打越卡。
4. 碰牌命令成功 ACK 直接返回当前玩家的权威投影，发起端不再等待额外一次
   HTTP `refresh()` 才落牌；其他玩家以及动画到期后的完成态均通过定向
   `room:update` 直接收到各自的私有投影。
5. 非胡牌特效用座位与 viewport 同步计算锚点，不再等待异步
   `boundingClientRect()` 后才开始 Lottie。

新增验收：

- [x] 碰 450ms、杠系 700ms、补杠 650ms、放赖 800ms、胡牌 1050ms 到点即可
      提交对应状态，不再额外保留 400–450ms 的服务端空锁。
- [x] 服务端 effect tick 的最坏轮询尾差不超过 50ms。
- [x] 预热只创建两个可复用音频上下文；两条并发提示都能自然结束，第三条
      直接丢弃且不会排队或创建第三个 context。
- [x] context 复用前清理旧 `onEnded` / `onError` 监听器，长局不会累积回调。
- [x] 发起碰牌的客户端从 Socket ACK 直接得到含碰牌落位和 `effectCue` 的投影，
      不再为同一命令额外发起 HTTP GET。
- [x] 放赖/杠牌等特效到期后，Socket 直接推送每个成员自己的完成投影，不再先
      发版本通知再等待 HTTP GET。
- [x] 特效播放路径不再调用 `boundingClientRect()`。
