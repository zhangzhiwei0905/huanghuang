# 音效播放丝滑化

父任务：`07-29-five-track-optimizations`。完整根因分析见 `/Users/zhang/.claude/plans/plan-1-2-federated-bunny.md` 第一节。

## Goal

打牌/碰/杠等游戏音效在快节奏出牌时被截断或完全不播放，恢复到用户记忆中"丝滑"的效果：打出去立即完整播放，不排队、不丢失。

## Requirements

- 音效播放不能有硬性并发上限导致的静默丢弃（当前 `POOL_SIZE=2` 且忙时直接丢弃）
- 音效必须完整播放到自然结束，不能被定时器提前 `stop()`
- 消除播放路径上的网络往返延迟（每次播放重新走云端 HTTPS 下载+解码）
- 清理代码引用不到的死音频资源（`action-win.mp3`、`laiyou.mp3`、`pre-audio.mp3`）

## Root Cause（已确证，对比 git 历史）

- `fab59a1`（丝滑版本）的 `acquireContext()` 池空即新建，无并发上限；当前 `ff29ef1` 版本 `acquireSlot()` 两槽都忙时返回 `null` 并静默丢弃 —— 这是主要回归点
- 次要缺陷：截断定时器从 `play()` 调用起算而非出声起算（碰 380ms/杠 420ms 预算被网络加载吃光）；每次播放重设 `src` 触发一次云端下载

## Acceptance Criteria

- [ ] 播放器不再有静默丢弃：并发 3+ 条音效请求全部播放（池空则新建 context，不设硬上限，或设一个远高于实际需求的软上限）
- [ ] 源音频完成 ffmpeg 预裁剪（按现有 `AUDIO_WINDOWS` 的 startTime/duration），播放器删除 `AUDIO_WINDOWS` 与 stop 定时器逻辑，改为播到 `onEnded`
- [ ] 首次 `warmup()` 预下载音频到本地文件系统缓存，后续播放使用本地路径，不再每次触发网络请求
- [ ] 死资源从代码引用表和源目录中一并清理
- [ ] `gameAudioPlayer.test.ts` 重写：删除"380ms 截断"断言，新增并发不丢弃、本地缓存命中/未命中回退用例
- [ ] `pnpm --filter miniprogram test` 全绿，typecheck 通过
- [ ] 真机（微信开发者工具）连续快速出牌验证：每一声完整播放

## Out of Scope

- 微信云存储的实际文件上传（需要用户配合，Claude 无操作权限）
- Lottie 动画时长与音效时长的进一步同步优化（当前两者共享同一 cue 触发源，本轮不改这层耦合）

## Notes

- 关键文件：`apps/miniprogram/src/lib/gameAudioPlayer.ts`、`cloudAudio.ts`、`gameAudioPlayer.test.ts`
- 需要新增裁剪脚本（如 `scripts/trim-audio.mjs`），保证可重跑、可复核
