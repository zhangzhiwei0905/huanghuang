# 实施计划

## 1. 登录页

- [x] `pages/index/index.tsx` 引入 `Form`，把登录门禁改为原生表单提交。
- [x] 昵称 `Input` 使用 `name="nickname"` + `type="nickname"`，移除以 React state 为唯一提交源的受控 `value`/`onInput`/`onBlur`。
- [x] 从 `Form.onSubmit` 的 `event.detail.value.nickname` 读取最终值并执行 trim/非空校验。
- [x] 头像选择只保存本地临时路径并立即预览，不在选择事件里上传。
- [x] 头像设为必填；提交时按“上传头像 → 微信登录”顺序调用线上接口。
- [x] 分别保留头像上传和微信登录的可诊断错误；所有失败路径解除 busy 且允许重试。

## 2. 牌桌身份信息

- [x] `pages/room/index.tsx` 增加无状态 `SeatAvatar`，统一真实头像、真人首字和机器人“机”的展示。
- [x] 等待大厅复用 `SeatAvatar`，并把 `LobbySeatProjection.score` 加入 meta。
- [x] 正式对局的 `.player-station` 增加头像与 identity row。
- [x] 保留昵称、积分、手牌张数、个人倍数、连接状态、机器人标识和现有 meld 渲染。
- [x] `pages/room/index.scss` 增加紧凑头像/identity 样式，检查四方位和多组碰杠时无覆盖。

## 3. 静态质量检查

- [x] `pnpm --filter @huanghuang/miniprogram typecheck`
- [x] `pnpm exec prettier --check "apps/miniprogram/src/pages/index/index.tsx" "apps/miniprogram/src/pages/index/index.scss" "apps/miniprogram/src/pages/room/index.tsx" "apps/miniprogram/src/pages/room/index.scss"`
- [x] 检查 diff，确认没有服务端、协议、数据库和本地服务改动。

## 4. 生产地址构建

- [x] `TARO_APP_API_BASE=https://huanghuang.amazingzz.xyz pnpm --filter @huanghuang/miniprogram build:weapp`
- [x] 验证 `apps/miniprogram/dist/common.js` 包含生产域名。
- [x] 验证 `apps/miniprogram/dist/common.js` 不包含 `127.0.0.1:3000`。
- [x] `curl https://huanghuang.amazingzz.xyz/health/live` 返回 HTTP 200。

## 5. 微信开发者工具验证

- [x] 通过 `cli auto --port 11352 --project apps/miniprogram/dist` 开启独立 automation 端口。
- [x] 连接 automation，验证首页页面栈、空存储登录门禁和截图。
- [x] 使用线上服务创建临时匿名 BOT 房并注入测试会话，验证真人首字、机器人“机”、头像位、昵称、积分、手牌张数、倍数和连接状态。
- [x] 抓取横屏截图检查四个座位、碰杠区域、弃牌区、操作栏和自己手牌没有遮挡。
- [x] 记录开发者工具不能替代真机验证微信昵称建议和 `chooseAvatar` 原生选择器。

## Risk / Rollback Points

- 昵称可靠性依赖原生 Form 的提交值，不再依赖可能缺失的 input 事件。
- 头像上传推迟到提交阶段；失败时必须保留本地预览和重试能力。
- 牌桌头像可能增加 station 宽高；若截图发现覆盖，优先缩小头像/间距，不移动中央牌桌或操作栏。
- 无服务端迁移；回滚四个小程序文件并重建即可。
