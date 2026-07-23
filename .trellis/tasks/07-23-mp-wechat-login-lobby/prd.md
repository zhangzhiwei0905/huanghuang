# 小程序微信登录 + 好友房大厅牌桌化

## Goal

1. 好友房等待大厅从当前"卡片列表"改为"牌桌坐姿"视觉(参考 `apps/web` 对局内 `PlayerStation` 的布局语言),每个座位显示头像、昵称、准备状态。
2. 接入真实微信登录,取代当前"手动输入昵称"的匿名会话,让昵称/头像来自用户的微信身份;首次打开小程序强制完成一次登录(选头像+确认昵称),之后自动复用同一身份,人机对战/好友房共用一套身份。

## Confirmed Facts

### 大厅展示现状

- `apps/miniprogram/src/pages/room/index.tsx` 的 `WAITING` 阶段用 `.lobby-grid` 渲染 `room.lobbySeats`,每项只是文字卡片(昵称+"座N·房主·在线·已准备"),没有头像、没有牌桌视觉。
- 参考对象 `apps/web/src/components/GameTable.tsx` 的 `PlayerStation`(web 端没有独立等待大厅,直接复用对局桌面):`<span className="player-avatar" aria-label="...头像，暂未设置" />` 是**空占位符**——web 端从未实现真实头像图片,能参考的只是"头像位+昵称+状态"这个布局语言,不是可搬运的头像系统。
- `LobbySeatProjection`/`PlayerProjection`(`packages/protocol/src/projections.ts:6-18, 32-41`)均**没有 avatar 字段**。

### 认证/会话模型现状

- 全应用是匿名会话:`apps/server/src/session-service.ts` 的 `issue`/`ensure` 生成随机 token,存进 sqlite `anonymous_sessions` 表(`id, token_hash, nickname, created_at, last_seen_at`——无 openid/avatar 列)。
- 小程序端 `apps/miniprogram/src/api/session.ts` 的 token 持久化机制(存 `Taro Storage`、`Authorization: Bearer` 复用)是现成的,可以直接承载"登录后不用每次重新授权"。
- **`apps/server/src/index.ts` 已有半成品端点 `POST /api/auth/wechat`**(历史提交 `69474a5`,从未被小程序客户端调用过):用 `js_code` 换 `openid`(标准 `sns/jscode2session`),但换到后**完全丢弃**(注释明写"MVP: openId is not logged, persistence can land later"),只验证 code 有效就发一个全新匿名 session——不认识回头客。没有头像逻辑。服务端已有"半条腿"基础设施,缺持久化、缺头像、客户端从未接入。
- `fastifyStatic` 目前只托管 `apps/web` 构建产物,**没有任何文件上传/媒体存储端点**。

### 微信平台硬限制(非实现选择)

- `wx.getUserProfile`(静默拿用户信息)已废弃。当前官方做法:头像用 `<button open-type="chooseAvatar">`(默认从用户当前微信头像起选,回调给一个**临时本地文件路径**,需上传变成永久 URL);昵称用 `<input type="nickname">`(系统建议真实昵称,但仍是可编辑文本框)。"微信直接登录带来名称和头像"落地效果是"用户主动确认/微调一次系统预填值",不是纯静默一次性获取——这是所有小程序的通行限制。
- 收集头像/昵称属于"收集用户信息",微信要求 mp.weixin.qq.com 后台"隐私保护指引"里声明,否则 `chooseAvatar` 流程可能在审核/真机上被拦截——这是后台配置门槛(与之前的域名白名单同类),不在本任务代码实现范围,需用户自行配置。

### AppSecret 与环境变量链路(已解决)

用户已有 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`,已写入 `apps/server/.env`(gitignored,未提交)。补齐了原本缺失的加载/透传链路:`apps/server/package.json` 的 `dev` 脚本改用 `node --env-file-if-exists=.env`(Node 24 原生支持,不引入 dotenv 依赖);`deploy/compose.yaml` 的 `app.environment` 增加 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`(走 docker compose 的 `${VAR}` 插值,和现有 `DOMAIN`/`APP_REVISION` 用法一致);`deploy/.env.example` 补充占位说明。生产环境仍需用户自己在 Aliyun 服务器部署 `.env` 里填真实值(运维步骤,不在本任务代码改动范围)。

## Requirements

### R1 微信登录

- `openid` 持久标识用户:`anonymous_sessions` 增加可空的 `wechat_open_id`/`avatar_url` 列(纯新增,存量行天然 NULL,唯一索引允许多行 NULL);首次登录建档,再次登录(同一 openid)复用同一账号并刷新 token,而不是每次发新 session。
- `/api/auth/wechat` 改为持久化版本:换到 `openid` 后 `upsert`(按 openid 查找/更新或插入),而不是丢弃后发匿名 session;返回体带 `avatarUrl`。`/api/session` GET 同步带上 `avatarUrl`,用于"再次打开小程序"时静默复用已登录身份。
- 新增头像上传端点(`POST /api/upload/avatar`,`@fastify/multipart`,2MB 限制,落盘到 `DATABASE_PATH` 同目录的 `avatars/` 子目录,复用现有 `game_data` volume,不需要新增部署拓扑),返回 `{avatarUrl}` 供 `/api/auth/wechat` 请求携带。
- 小程序首页(`pages/index/index.tsx`)加登录门禁:mount 时用已存 token 调 `/api/session` 检查身份,没有则渲染登录引导视图(`wx.login()` 拿 `code` + `chooseAvatar` 选头像上传 + `<input type="nickname">` 确认昵称 → 调 `/api/auth/wechat` → 存 token),有则跳过直接进首页菜单。CREATE/JOIN/BOT 表单原有的手动昵称输入框移除,静默使用登录身份的昵称。
- `code` 只在用户提交登录那一刻现取(`wx.login()` 结果几分钟内失效,不能提前拿等用户慢慢填表单)。
- 登录/身份解析失败要有清晰错误提示+重试,不能白屏卡死。

### R2 大厅牌桌化

- `.lobby-grid` 改为复用对局页已有的 `POSITION_CLASS`(`pos-self/pos-right/pos-opposite/pos-left`)围坐布局,每座显示:头像(有则图片、无则"昵称首字"占位圆形,不引入新图标资源)、昵称、房主/准备/在线状态。
- `LobbySeatProjection`、`PlayerProjection` 增加 `avatarUrl: string | null`,贯穿 `packages/protocol` → `room-service.ts` 的 `SeatController`/两处投影构造 → 客户端渲染(`humanSeat()` 从 `session.avatarUrl` 取值,`botSeat()` 恒为 `null`)。

## Acceptance Criteria

- [ ] 首次打开小程序:无存量 token → 渲染登录引导页(选头像+确认昵称)→ 提交后进入首页菜单;再次打开:已存 token 有效 → 直接进首页菜单,不再要求登录。
- [ ] 创建/加入房间不再出现手动昵称输入框,昵称静默来自登录身份。
- [ ] 好友房等待大厅按四个方位围坐展示,含头像(或首字占位)+昵称+房主/准备/在线状态;视觉上与对局内 `.player-station` 一致的定位语言。
- [ ] `apps/server`、`apps/miniprogram`、`packages/protocol` 的 `pnpm typecheck` 通过;`apps/miniprogram` 的 `pnpm build:weapp` 通过;`prettier --check` 通过。
- [ ] Web 端(`apps/web`)不受影响——`createRoomSchema`/`joinRoomSchema` 未改动,`PlayerProjection`/`LobbySeatProjection` 新增字段是可选读取,Web 端头像占位符行为不变。
- [ ] 本地起 `apps/server`(读取 `apps/server/.env` 里的真实 AppSecret)+ 开发者工具,能走通"登录选头像→创建房间→大厅看到自己头像"的端到端联调。

## Out of Scope

- Web 端(`apps/web`)头像/登录改造——本任务只动 `apps/miniprogram` + 必要的共享 `apps/server`/`packages/protocol` 改动。
- 微信 `unionid`(跨应用统一身份)——只处理单小程序内的 `openid`。
- 登录后的头像/昵称编辑入口(设置页)——本轮只做首次登录采集,不做后续修改界面。
- 多端并存登录(同一 openid 在两台设备同时持有有效 token)——每次登录换发新 token,旧 token 自然失效,不做显式互踢提示。
