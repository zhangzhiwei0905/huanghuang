# 修复小程序微信头像昵称采集

## Goal

修复体验版首次登录页中“头像选择后看不到结果、使用微信昵称后提交仍为空”的问题。头像与昵称均由用户通过微信原生能力确认；昵称优先使用微信键盘提供的当前微信昵称，并允许用户在提交前手动修改。所有网络请求继续统一访问生产服务器，不启动或依赖本地服务。

## Background

- 当前登录页已使用 `openType="chooseAvatar"` 和 `type="nickname"`，但头像在选择后立即上传，只有上传成功才更新预览（`apps/miniprogram/src/pages/index/index.tsx:42-67`）。真机上传失败时，用户看到的效果等同于“没有选中”。
- 当前昵称是 React 受控输入框，并依赖 `onInput`/`onBlur` 把值同步到 state（`apps/miniprogram/src/pages/index/index.tsx:102-114`）。微信原生“使用微信昵称”自动填充并不保证触发这些事件，因此界面可能出现昵称、提交 state 仍为空。
- 微信不允许小程序静默读取用户头像和昵称。合规路径是：用户点击 `chooseAvatar` 选择头像；聚焦 `input type="nickname"` 后点击微信键盘给出的昵称建议，或自行输入。
- `uploadAvatar()` 已统一通过 `${API_BASE}/api/upload/avatar` 上传服务器（`apps/miniprogram/src/api/session.ts:133-145`）；`wechatLogin()` 已把服务端头像 URL 和昵称提交到 `${API_BASE}/api/auth/wechat`（`apps/miniprogram/src/api/session.ts:114-130`）。
- 当前 `dist/common.js` 已确认生产构建指向 `https://huanghuang.amazingzz.xyz`，线上 `/health/live` 返回 HTTP 200。
- 微信开发者工具 HTTP 服务端口为 11352。自动化会话需由该端口启动，并以 `apps/miniprogram/dist` 为项目根连接独立 WebSocket 端口；直接以源码项目根启动会错误寻找 `pages/index/index.wxml`。

## Requirements

### R1 昵称采集

- 使用微信原生昵称输入能力，输入框聚焦时允许用户选择当前微信昵称。
- 不再把 `onInput`/`onBlur` 同步到 React state 作为提交值的唯一来源。
- 登录提交必须读取原生表单当时的真实 `nickname` 值，以覆盖“使用微信昵称不触发 input 事件”的真机行为。
- 用户必须能够编辑、替换系统建议的昵称；提交时继续执行 trim、非空和服务端既有 12 字限制。

### R2 头像采集

- 用户完成 `chooseAvatar` 后立即使用微信返回的本地临时路径显示预览，不等待网络上传。
- 头像为首次微信登录的必填资料；未选择头像时不得提交登录，并显示明确提示。
- 登录提交时再把已选本地头像上传到生产服务器，成功后将服务器 URL 交给 `wechatLogin()` 持久化。
- 头像上传和登录错误必须显示可诊断信息，并允许用户重试；按钮 busy 状态不能永久锁死。

### R3 牌桌身份信息

- 等待大厅和正式对局中的四个座位都必须展示玩家头像、昵称和积分。
- 正式对局继续展示现有手牌张数、个人倍数、在线/离线状态和机器人标识，不因增加头像而丢失信息（`apps/miniprogram/src/pages/room/index.tsx:457-477`）。
- 正式对局直接使用服务端已下发的 `PlayerProjection.avatarUrl`、`nickname`、`score`、`handCount`、`personalMultiplier` 和 `connected` 字段；这些字段已在 `packages/protocol/src/projections.ts` 定义，并由 `apps/server/src/room-service.ts:783-804` 投影，不新增客户端自行推导的账号状态。
- 等待大厅继续使用 `LobbySeatProjection` 的头像、昵称、积分、房主、准备和在线状态；当前大厅已有头像与名称，但需补充积分展示并统一座位信息层级（`apps/miniprogram/src/pages/room/index.tsx:382-415`）。
- 有真实头像的玩家显示图片；存量无头像真人显示昵称首字；机器人显示“机”，不新增默认头像图片。
- 头像卡片不得遮挡碰/杠牌组、弃牌区、操作栏或自己手牌；横屏小尺寸设备仍需可读。

### R4 服务与兼容性

- 所有 REST、上传和登录流量继续使用 `API_BASE` 对应的生产服务器；不得启动本地 server。
- 保留现有 openid 会话持久化、旧 token 识别、返回用户自动恢复身份和房间流程。
- 不修改服务端、协议或数据库契约，除非实现验证证明现有接口无法满足要求。
- 生产构建必须显式注入 `TARO_APP_API_BASE=https://huanghuang.amazingzz.xyz`，不得依赖 `src/config.ts` 的本地回退值。

## Acceptance Criteria

- [ ] 首次进入登录页，点击头像并选择后，页面立即显示所选头像，即使服务器上传尚未开始。
- [ ] 聚焦昵称输入框后可使用微信当前昵称建议；提交得到的昵称与输入框最终显示一致。
- [ ] 用户可以在昵称建议基础上继续修改，也可以完全手动输入新昵称。
- [ ] 空昵称不能登录，并显示明确提示。
- [ ] 选定头像后提交：客户端把临时头像上传至线上 `/api/upload/avatar`，再把返回 URL 与昵称提交到线上 `/api/auth/wechat`。
- [ ] 上传或登录失败后保留可重试状态，不白屏、不永久 disabled。
- [ ] 等待大厅的每个已占座位显示头像、昵称、积分以及房主/准备/在线状态。
- [ ] 正式对局的每个座位显示头像、昵称、积分、手牌张数、个人倍数、在线状态和机器人标识。
- [ ] 头像与身份信息在四个方位均不遮挡牌组、弃牌区、操作栏和自己手牌。
- [ ] `pnpm --filter @huanghuang/miniprogram typecheck` 通过。
- [ ] 使用生产 API 地址完成 `pnpm --filter @huanghuang/miniprogram build:weapp`，并验证 `dist/common.js` 不含 `127.0.0.1:3000`。
- [ ] 通过微信开发者工具 11352 服务端口启动自动化会话，验证登录页加载、页面栈、空存储登录门禁和构建产物截图。
- [ ] 不启动本地服务；线上 `/health/live` 验证保持 HTTP 200。

## Out of Scope

- 静默读取用户微信昵称或头像（微信平台不提供此能力）。
- 登录后的独立个人资料设置页面。
- 服务端账号模型、数据库迁移、房间投影和部署拓扑调整。
- 代替用户配置 mp.weixin.qq.com 的隐私保护指引和 request/uploadFile 域名白名单。
