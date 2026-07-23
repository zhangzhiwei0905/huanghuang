# Implementation Checklist

## R1 首页按钮/字体放大
- [ ] 修改 `apps/miniprogram/src/pages/index/index.scss`:`.mp-btn`、`.mp-home__form-actions .mp-btn`、`.mp-field__input`、`.mp-field__label`、`.mp-home__tagline`、`.mp-score` 按 design.md 表格数值调整,补 px 楼层(`min-*`/`max-*`)。

## R2 对局碰杠展示重设计
- [ ] `apps/miniprogram/src/pages/room/index.scss`:`.player-station__melds .mj-tile--compact` 改为 2.6×3.6vmin(楼层 15×21,上限 19×26)。
- [ ] 同文件:`.player-station.pos-left/.pos-right` 的 `max-width` 30vmin → 46vmin。
- [ ] 同文件:`.player-station.pos-left/.pos-right` 去掉 `transform: translateY(-50%)`,`top` 由 42% 改为 39%。
- [ ] 保留 `.player-station__melds { flex-wrap: wrap }` 不变(兜底,不追求杜绝换行)。
- [ ] 用户在自己的开发者工具里目测:①空/少量碰杠场景位置与现状一致(无回归);②4 组碰杠+放赖子场景不再挤压 `self-area`。若 `top` 偏差明显,现场微调数值(不需要重新设计)。

## R3 好友房分享
- [ ] `apps/miniprogram/src/pages/room/index.tsx`:引入 `Taro.useShareAppMessage`,返回 `{ title, path: "/pages/index/index?code=" + room.roomCode }`。
- [ ] 同文件:等待大厅/房间头部新增 `<Button open-type="share">分享邀请好友</Button>`,样式复用现有 `mp-btn`/按钮体系。
- [ ] `apps/miniprogram/src/pages/index/index.tsx`:用 `Taro.useRouter()` 读取 `code` 参数,派生 `mode`/`roomCode` 初始 state(6 位数字校验,非法值忽略、保持 `HOME`)。
- [ ] 新增/更新文档说明开发版/体验版/正式版三层的 mp.weixin.qq.com 后台操作入口(并入 `docs/miniprogram-friend-room.md` 或新建文件,design.md 已给出具体条目)。

## Validation
```bash
cd apps/miniprogram
pnpm typecheck
pnpm build:weapp
pnpm exec prettier --check "apps/miniprogram/src/**/*.{ts,tsx,scss}"   # repo root
```
- R1/R2 在开发者工具里目测(横屏最小机型档位),R3 在开发者工具"预览"里检查分享卡片 path 与自动预填(真正的好友分享验证需要用户实机测试,超出本环境能力)。

## Rollback Points
- 每个 R 项改动都局限在各自列出的文件内,单独 `git diff`/还原即可,互不依赖。
