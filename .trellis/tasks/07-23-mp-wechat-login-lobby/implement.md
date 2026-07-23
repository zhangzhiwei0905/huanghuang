# Implementation Checklist

## Server: database + session persistence
- [ ] `apps/server/src/database.ts`:`AnonymousSession` 加 `wechatOpenId`/`avatarUrl`;`migrate()` 加两条幂等 `ALTER TABLE`(try/catch 忽略重复列错误)+ 唯一索引。
- [ ] 新增 `findSessionByOpenId` / `upsertWechatSession` 方法。
- [ ] `SessionService`/`/api/session` GET 返回体带上 `avatarUrl`。

## Server: /api/auth/wechat + 头像上传
- [ ] `apps/server/package.json` 加 `@fastify/multipart@^9.4.0` 依赖。
- [ ] `apps/server/src/index.ts`:注册 `multipart` 插件;新增 `avatarDir`(基于 `DATABASE_PATH` 目录)+ 第二个 `fastifyStatic` 注册(`prefix:"/avatars/", decorateReply:false`)。
- [ ] 新增 `POST /api/upload/avatar`(multipart,2MB 限制,落盘,返回 `{avatarUrl}`)。
- [ ] 改造 `POST /api/auth/wechat`:接收 `avatarUrl`,调用 `upsertWechatSession` 而不是 `sessions.issue`,返回体带 `avatarUrl`。

## Protocol
- [ ] `packages/protocol/src/projections.ts`:`PlayerProjection`、`LobbySeatProjection` 加 `avatarUrl: string | null`。

## Server: room-service 投影
- [ ] `SeatController` 类型加 `avatarUrl`。
- [ ] `botSeat()` 填 `null`;`humanSeat()` 形参类型扩展 + 填 `session.avatarUrl`。
- [ ] `project()` 里 `players` 数组与 `lobbySeats` 数组两处构造各加 `avatarUrl: controller.avatarUrl`。

## Miniprogram: 登录门禁
- [ ] `src/api/session.ts`:`SessionIssueResponse` 加 `avatarUrl`;新增 `resolveIdentity()`(GET `/api/session` 验证已存 token)。
- [ ] 新增 `wx.login()` + `chooseAvatar` + 昵称输入的登录引导视图(`LoginGate`,可先内联在 `pages/index/index.tsx`,不拆独立页面)。
- [ ] `pages/index/index.tsx`:mount 时 `resolveIdentity()`,无身份则渲染 `LoginGate`,有身份则跳过、直接进 `HOME` 菜单;`identity.nickname` 替代 CREATE/JOIN/BOT 表单里原有的手动昵称输入(移除该 Input,静默透传)。
- [ ] 登录/身份解析失败态:清晰错误提示 + 重试按钮,不能白屏卡死。

## Miniprogram: 大厅牌桌化
- [ ] `pages/room/index.tsx`:`WAITING` 阶段 `.lobby-grid` 换成复用 `POSITION_CLASS` 的 `.lobby-station` 布局(见 design.md 代码示例)。
- [ ] `pages/room/index.scss`:新增 `.lobby-station` 系列样式,参照 `.player-station` 系列的定位/配色。
- [ ] 无头像时用"昵称首字"占位圆形,不新增图标资源。

## Validation
```bash
cd apps/server && pnpm typecheck
cd apps/miniprogram && pnpm typecheck && pnpm build:weapp
pnpm exec prettier --check "apps/server/src/**/*.ts" "apps/miniprogram/src/**/*.{ts,tsx,scss}" "packages/protocol/src/**/*.ts"
```
- 端到端联调(依赖用户已提供的 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`,已写入 `apps/server/.env`):本地起 `apps/server`(`pnpm --filter @huanghuang/server dev`,读取 `--env-file-if-exists=.env`),开发者工具里走一遍"首次登录选头像+昵称→进首页→创建房间→大厅看到自己头像"。
- 用户需要在自己的开发者工具里目测大厅牌桌布局与登录页交互——本环境无法直接截图验证微信原生组件(`chooseAvatar`/`type="nickname"`)的真实渲染效果。

## Rollback Points
- 数据库迁移(新增列)与 `/api/auth/wechat` 改造可独立回滚(`git revert` 对应 commit),旧客户端/Web 端不受影响。
- 客户端登录门禁是 `pages/index/index.tsx` 内的新增分支逻辑,如果登录流程有问题,可临时把 `resolveIdentity()` 的判断跳过(强制走 HOME),不影响其余页面。

## Compliance Reminder (not code, but blocks real-device rollout)
- mp.weixin.qq.com 后台"隐私保护指引"需要声明收集头像/昵称信息,否则 `chooseAvatar` 上传流程可能在审核或真机上被拦截——用户需自行在后台配置,和当年的域名白名单是同一类"后台配置门槛"。
