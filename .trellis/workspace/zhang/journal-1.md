# Journal - zhang (Part 1)

> AI development session journal
> Started: 2026-07-15

---



## Session 1: 牌桌视觉清新化、碰杠动作条与手牌高亮、生产部署

**Date**: 2026-07-16
**Task**: 牌桌视觉清新化、碰杠动作条与手牌高亮、生产部署
**Branch**: `main`

### Summary

低调主题改为浅雾绿+米白清新配色，万/条/筒三花色统一主题色并精修图案；新增所有座位持久碰杠展示与放赖标签；碰/杠/放赖三类动作加了区分明显的CSS动效。新增顶部大动作条（自摸/杠/碰/补杠），合法时高亮可点，手牌中可碰/杠的牌纯前端派生高亮，无需协议改动。修复生产构建：deploy host 到 GitHub/unofficial-builds.nodejs.org 网络不通，改走 npmmirror 镜像编译 better-sqlite3。已构建、部署并在生产环境 https://huanghuang.amazingzz.xyz 用 Playwright 验证通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4b4efb2` | (see git log) |
| `fabe7c1` | (see git log) |
| `4677dfd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 晃晃 Web 游戏 MVP 与主任务收尾

**Date**: 2026-07-16
**Task**: 晃晃 Web 游戏 MVP 与主任务收尾
**Branch**: `main`

### Summary

完成邀请制四人数字麻将 MVP、赖子与碰杠规则、房间生命周期、双主题横屏牌桌、动作提示与结算展示；完成顶部自摸/碰杠动作条和手牌高亮，修复阿里云生产镜像构建并部署 HTTPS；最终通过 lint、类型检查、生产构建与 52 项测试，归档主任务。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4b4efb2` | (see git log) |
| `fabe7c1` | (see git log) |
| `4677dfd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 麻将牌面素材咨询

**Date**: 2026-07-17
**Task**: 麻将牌面素材咨询
**Branch**: `main`

### Summary

分析当前麻将牌纯 CSS 绘制的实现方式（无图片素材），给出改用图片/SVG 素材重做牌面的方案：27 张牌面清单（万/条/筒各1-9）、SVG 格式建议、viewBox 尺寸、存放路径 apps/web/src/assets/tiles/，并整理成可直接交给 Codex 的生成 prompt。未修改任何代码；发现用户已在其他会话/工具中创建了 07-17-mahjong-tile-svg-assets 任务并完成素材生成与组件接入，本次不做归档。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Integrate mahjong SVG tile artwork

**Date**: 2026-07-17
**Task**: Integrate mahjong SVG tile artwork
**Branch**: `main`

### Summary

Imported and adapted 27 wan, tiao, and tong SVG tiles from lietxia/mahjong_graphic; unified MahjongTile rendering and the table-center wildcard display; added mapping and accessibility regression tests; validated SVG structure, tests, lint, typecheck, build, and responsive browser rendering.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0c7d304` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 房间生命周期与 iOS PWA 上线

**Date**: 2026-07-17
**Task**: 房间生命周期与 iOS PWA 上线
**Branch**: `main`

### Summary

完成多人牌桌交互成熟化、好友房三分钟回收、房主即时解散与转让、关闭通知后内存和 SQLite 物理删除，以及 iOS 动态视口和 PWA；完整质量门禁通过，生产备份、部署与线上房间回收验证完成。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e51e8c3` | (see git log) |
| `1b26e80` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 牌桌视觉完善与生产部署加速

**Date**: 2026-07-17
**Task**: 牌桌视觉完善与生产部署加速
**Branch**: `main`

### Summary

完成牌桌头像、余牌、终局手牌、聊天气泡、放赖与边框等视觉优化并部署生产；清理 Huanghuang 旧部署文件、镜像和残留单机房间；确认阿里云镜像加速器生效，重构 Dockerfile 依赖分层和 BuildKit 缓存，将增量镜像构建从约 486 秒降至 48.61 秒、核心发布降至 63.146 秒，并保存生产部署记录。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0888402` | (see git log) |
| `cbb97b2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 优化牌桌人机与结算

**Date**: 2026-07-17
**Task**: 优化牌桌人机与结算
**Branch**: `feat/table-ai-settlement-optimization`

### Summary

统一本人碰杠组合展示，精简终局信息，新增受限公开视图的均衡机器人策略并分离断线托管，补齐杠分与倍率回归，保留 SQLite。全量 100 个测试、lint、typecheck、build、Compose 与浏览器几何检查通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9d75067` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 牌桌品牌图标、动作按钮与背景上线

**Date**: 2026-07-20
**Task**: 牌桌品牌图标、动作按钮与背景上线
**Branch**: `main`

### Summary

使用新素材替换 Web/PWA 图标和七类游戏操作按钮，将过与碰杠响应合并到同一操作栏，接入双主题牌桌背景并压缩运行时资源；通过 102 项测试、lint、类型检查、生产构建及桌面/844x390 视觉验证，部署到 huanghuang.amazingzz.xyz，完成数据库与回滚镜像备份并验证 HTTPS、PWA 和 Socket.IO。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `973a564` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 优化移动端按钮与全屏牌桌

**Date**: 2026-07-20
**Task**: 优化移动端按钮与全屏牌桌
**Branch**: `main`

### Summary

去除图片动作按钮的矩形触控高亮并保留圆角键盘焦点，将牌桌背景扩展到游戏顶栏、桌面、底栏及安全区；通过 102 项测试、lint、Web 类型检查、生产构建和 844x390/1280x720 浏览器验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6b80a4c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: Complete bootstrap guidelines

**Date**: 2026-07-21
**Task**: 00-bootstrap-guidelines
**Branch**: `main`

### Summary

对照当前 monorepo 完成 Trellis bootstrap gap-fill：刷新前后端 directory / error-handling / type-safety / quality / hooks / logging / index，勾选 PRD 并 archive 任务；厚场景文档保持不变。

### Main Changes

- 同步 `apps/web` pure helpers 与 server 模块职责到 `.trellis/spec/`
- 将 index 脚手架改为 Pre-Development Checklist
- Archive `00-bootstrap-guidelines` → `archive/2026-07/`

### Git Commits

| Hash | Message |
|------|---------|
| `f1eca48` | chore(task): archive 00-bootstrap-guidelines |
| `1219a4c` | docs(spec): complete bootstrap guidelines gap-fill |

### Testing

- [OK] Path citations verified against live source files (docs-only change)

### Status

[OK] **Completed**

### Next Steps

- None - bootstrap complete; future sessions load filled specs


## Session 11: Miniprogram port planning + first three children

**Date**: 2026-07-21
**Task**: 07-21-miniprogram-port (+ children)
**Branch**: `miniprogram`

### Summary

Planned WeChat-only Taro React port with shared server token auth; implemented server dual auth, Taro scaffold, and core lobby/room client; integration docs/checklist ready; real-device AC5 left for operator.

### Main Changes

- Server Bearer/`X-Session-Token` + Socket auth; `/api/session`; optional WeChat code route
- `apps/miniprogram` Taro 4 scaffold + home/room core path
- Docs: `docs/miniprogram-auth.md`, `docs/miniprogram-device-qa.md`

### Git Commits

| Hash | Message |
|------|---------|
| `69474a5` | feat(server): dual cookie/Bearer session for miniprogram |
| `8bbca62` | feat(miniprogram): add Taro 4 WeChat scaffold |
| `f71dea6` | feat(miniprogram): core lobby and room game path |

### Testing

- [OK] pnpm lint / test (106) / miniprogram typecheck / build:weapp / web build

### Status

[WIP] Integration AC5 real-device pending user

### Next Steps

- Operator device QA; then archive integration + parent


## Session 12: Miniprogram playable in WeChat DevTools

**Date**: 2026-07-21
**Task**: 07-21-miniprogram-port / integration
**Branch**: `miniprogram`

### Summary

Operator verified core path in WeChat DevTools: realtime works after socket.io-mp switch; can discard and pong. Parent AC1–AC7 closed; integration and parent archived.

### Main Changes

- `socket.io-mp` for WeChat native WebSocket
- Room UI polish (functional, not web pixel parity)

### Git Commits

| Hash | Message |
|------|---------|
| `0914d13` | fix(miniprogram): use socket.io-mp for WeChat realtime |
| `e2a2ded` | docs(miniprogram): note socket.io-mp requirement |

### Testing

- [OK] Operator DevTools: play / pong / discard
- [OK] pnpm test / miniprogram build earlier in session

### Status

[OK] **Completed** (MVP core path)

### Next Steps

- Optional: UI closer to web, real-device on LAN, deploy miniprogram branch server + 合法域名
