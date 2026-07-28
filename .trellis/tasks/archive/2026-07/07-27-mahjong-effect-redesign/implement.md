# 执行清单

1. **导出新素材为 `.cjs`**
   - 把设计稿脚本产出的 5 份 Lottie JSON（碰/杠/补杠/放赖/胡牌）写成
     `module.exports = {...}` 单行 CommonJS 模块，覆盖
     `apps/miniprogram/src/effects/mahjong/data/{peng,gang,bu-gang,fang-lai,hu-pai}.cjs`。
   - 校验：`w`/`h` 仍为 512；带牌面的图层保留
     `meta.tileSlot`/`meta.tileCode`/`meta.tileSize`（`claim`/`wild` 对应
     `tile-faces.cjs` 现有换脸逻辑，不改这部分代码）。

2. **更新 `runtime.ts` 的 `presentationProfiles`**
   - 按 `design.md` 表格设置每个动作的 `outPoint`（碰 27 / 杠 42 / 补杠 39 /
     放赖 48 / 胡牌 63），`ip` 统一 0。
   - `applyPresentation` 去掉按 `layerNames` 过滤图层的逻辑（新素材不需要），
     只保留 `ip`/`op` 裁剪 + `meta.presentation` 标注；相应精简
     `PresentationProfile` 类型（去掉 `layerNames` 字段，如果不再被其他地方
     引用）。
   - 确认 `peng`/`hu-pai` 走 `cloneAnimationData` 分支、其余三个走
     `tileFaces.applyTileCode` 分支的判断逻辑不受影响（这部分代码不用改）。

3. **更新 `mahjongEffect.ts` 的 `EFFECT_VISUAL_DURATION_MS`**
   - `PONG: 450`
   - `EXPOSED_KONG: 700, CONCEALED_KONG: 700, INDICATOR_PONG_KONG: 700`
   - `ADDED_KONG: 650`
   - `RELEASE_WILDCARD: 800`
   - `WIN: 1050`

4. **更新测试**
   - `mahjongEffect.test.ts`：`loadMahjongAnimationData` 对 `ip`/`op`/`fr`/
     `layers`/`meta.presentation` 的断言改成新素材对应的值；`effectPlacement`
     相关断言若因新素材尺寸假设变化需要同步核对（新素材沿用现有
     `effectPlacement` 的 sizing 表，理论上不受影响，但要跑一遍确认）。
   - `room-service.test.ts` 的 effect duration 断言同步到追加体验优化中的
     对齐时长。

5. **本地视觉验证**
   - 用 `lottie-web` canvas 渲染器把五个裁剪后的动画在浏览器里过一遍，逐帧
     检查 `outPoint` 前后没有"动作腰斩"的观感。

6. **跑测试**
   - `pnpm --filter miniprogram test`
   - `pnpm --filter server test`（确认未touch 的用例仍然通过，排除误改）

7. **追加：消除动画结束后的空等**
   - 将 `room-service.ts` 的 `EFFECT_DURATION_MS` 对齐客户端可见时长。
   - 将服务端 room tick 间隔压缩为 50ms。
   - 更新 service duration 边界断言，确认到点提交仍由服务端负责。

8. **追加修正：恢复固定双槽音频池**
   - 撤销 latest-wins，恢复 `warmup()` 和两个可复用 context。
   - 双槽忙时丢弃新提示，不排队；timeout / ended 后归还槽位。
   - 复用前清理旧监听器，更新测试覆盖双路完成、第三路丢弃和长局复用。

9. **追加修正：缩短点击到落牌链路**
   - Socket command ACK 附带发起玩家的 `RoomProjection`，发起端直接替换。
   - 命令广播排除发起 socket，向其他成员定向推送各自投影。
   - 特效到期后也直接推送成员投影，移除完成通知后的 HTTP refresh 尾延迟；
     旧 ACK/旧 `room:update` 保留 HTTP refresh fallback。
   - 从历史 `d0c4d50` 恢复同步 station anchor helper（不恢复 effect queue），
     `MahjongEffectOverlay` 不再查询 `boundingClientRect()`。

## 验证命令

```bash
pnpm --filter miniprogram test
pnpm --filter server test
```

## 回滚点

素材替换和裁剪表调整是独立可回退的：如果某个动作裁剪点观感不对，只需要
调整对应的 `outPoint` / `EFFECT_VISUAL_DURATION_MS` 数值，不影响其他四个
动作或已有的"播完即消失"机制。
