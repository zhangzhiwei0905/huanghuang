# 设计：音效播放丝滑化

## 边界与契约

- `GameAudioPlayer`（`apps/miniprogram/src/lib/gameAudioPlayer.ts`）对外接口不变：`play(fileName)` / `warmup()` / `destroy()`，调用方 `pages/room/index.tsx:295-322` 不需要改动
- `resolveAudioFileUrls`（`cloudAudio.ts`）保留作为本地缓存未命中时的回退路径

## 数据流

1. **裁剪阶段（构建期，一次性）**：新增脚本读取 `huanghuang-audio/mp3-version/*.mp3` + 现有 `AUDIO_WINDOWS` 表，用 ffmpeg `-ss <startTime> -t <duration>` 裁出每个文件的"开箱即播"版本，输出到 `huanghuang-audio/mp3-trimmed/`。文件名保持不变，`startTime` 归零。
2. **上传阶段（用户手动）**：裁剪后的文件上传到微信云存储，可复用现有 folder（覆盖）或新建 `mp3-trimmed` folder —— 后者更安全，避免裁剪失败时线上无音效；`cloudAudio.ts` 的 `CLOUD_FOLDER` 常量相应更新。
3. **本地缓存阶段（运行时）**：
   - `warmup()` 触发时，对每个 `GameAudioFileName` 检查 `Taro.getFileSystemManager().access(localPath)`；未命中则 `Taro.downloadFile({ url: cloudUrl })` 落到 `${Taro.env.USER_DATA_PATH}/audio/<fileName>`
   - `play()` 优先用本地路径作为 `context.src`；本地缺失时回退云端临时 URL（保留现有 `resolveAudioFileUrls` 路径作为降级，不出现"完全无声"）
4. **播放阶段**：移除 `AUDIO_WINDOWS`、`leadInSafetySeconds`、stop 定时器；`context.startTime = 0`；`onEnded` 触发 `dispose(playback, false)` 归还池，不再有 `dispose(playback, true)` 的强制打断路径（`destroy()` 整体销毁时除外）。

## 并发模型变更

- 池语义从"硬上限 2、忙时丢弃"改回 `fab59a1` 的"软复用池"：`acquireSlot()` 找空闲 slot，找不到就新建（不设上限，或设一个远高于实际需求的软上限如 8，超过才丢弃并打日志，而非当前的静默丢弃）
- `dispose()` 归还逻辑：`stop` 参数只在 `destroy()` 全局销毁时为 true；正常播放结束路径不再需要 `stop: true` 分支

## 权衡

- 本地缓存需要处理小程序存储配额与缓存失效（版本更新后需清理旧文件）——用简单方案：缓存 key 带上文件名，若未来替换音频文件需改文件名而非覆盖同名文件，避免缓存脏读
- 不做 Lottie/音效时间轴的深度重新同步，保持现有 cue 触发耦合，降低本轮改动范围

## 兼容性 / 回滚

- 若裁剪或上传出问题，`resolveAudioFileUrls` 云端回退路径保证不会完全无声（只是retain旧的截断问题）—— 回滚方式是恢复旧 folder 引用
- 无数据库变更，纯前端改动，可随时回滚 commit
