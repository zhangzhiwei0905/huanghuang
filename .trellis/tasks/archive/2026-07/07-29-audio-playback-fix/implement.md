# 执行计划：音效播放丝滑化

## 步骤

1. [ ] 编写裁剪脚本 `scripts/trim-audio.mjs`：读取现有 `AUDIO_WINDOWS`（从 `gameAudioPlayer.ts` 提取或复制一份配置），对 `huanghuang-audio/mp3-version/*.mp3` 逐个跑 ffmpeg 裁剪，输出到 `huanghuang-audio/mp3-trimmed/`
2. [ ] 跑脚本生成裁剪文件，人工听感抽查 3-5 个（碰/杠/胡牌/放赖/牌名）确认无掐头去尾
3. [ ] 清理死资源引用：确认 `action-win.mp3`/`laiyou.mp3`/`pre-audio.mp3` 在裁剪输出和 `GameAudioFileName` 类型中的处理（若确认无引用则不裁剪、不上传）
4. [ ] **[需要用户配合]** 提示用户将 `mp3-trimmed/` 上传到微信云存储新 folder，并提供新 folder 名称
5. [ ] 更新 `cloudAudio.ts`：`CLOUD_FOLDER` 指向新 folder；确认 `resolveAudioFileUrls` 逻辑无需大改
6. [ ] 重写 `gameAudioPlayer.ts`：
   - 删除 `AUDIO_WINDOWS`、`leadInSafetySeconds`、stop 定时器（`playback.timer`）
   - `acquireSlot()` 改为软上限池，池空即新建
   - `warmup()` 增加本地文件缓存预下载逻辑（`Taro.downloadFile` + `Taro.getFileSystemManager`）
   - `start()` 优先用本地缓存路径，未命中回退云端 URL
7. [ ] 重写 `gameAudioPlayer.test.ts`：删除 380ms 截断断言，新增本地缓存命中/未命中、并发 3+ 播放不丢弃的用例
8. [ ] 运行 `pnpm --filter miniprogram test` 与 `pnpm --filter miniprogram typecheck`，全绿
9. [ ] **[需要用户配合]** 真机（微信开发者工具/真机预览）连续快速出牌 10 手验证，确认无截断/无丢失

## 验证命令

```bash
pnpm --filter miniprogram test -- gameAudioPlayer
pnpm --filter miniprogram typecheck
```

## 回滚点

- 若裁剪音频听感异常：回退到步骤 1 的原始 `AUDIO_WINDOWS` 配置重新裁剪，不影响已完成的播放器代码改动
- 若播放器改动引入新问题：`git revert` 对应 commit，`cloudAudio.ts` folder 改动一起回退
