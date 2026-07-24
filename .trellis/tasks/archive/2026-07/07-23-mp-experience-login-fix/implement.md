# 实施计划

## 1. 服务端安全解码与接口

- [x] 新增 `apps/server/src/avatar-upload.ts`，实现 base64、大小和 PNG/JPEG 文件头校验。
- [x] 新增 `apps/server/src/avatar-upload.test.ts`，覆盖有效 PNG/JPEG 和所有拒绝路径。
- [x] 在 `apps/server/src/index.ts` 增加 `/api/upload/avatar-data`，复用现有头像目录与 URL。
- [x] 保留并回归现有 multipart `/api/upload/avatar`。

## 2. 小程序上传通道

- [x] `apps/miniprogram/src/api/session.ts` 增加头像压缩和 FileSystemManager base64 读取封装。
- [x] `uploadAvatar()` 改用 `Taro.request` 调用 `/api/upload/avatar-data`。
- [x] 校验 HTTP 状态与响应 URL，保留原生错误详情。

## 3. 登录体验

- [x] `LoginGate` 将进度/错误状态移入卡片内部。
- [x] 添加微信昵称选择说明，保留 `type="nickname"`、原生 Form 最终值与手动编辑。
- [x] busy 按钮显示“正在进入…”，各阶段显示明确进度。
- [x] 失败保留头像与输入内容并解除 busy。
- [x] 调整 `index.scss`，确保反馈在横屏小尺寸设备可见。
- [x] 将未登录首页收敛为单一“微信登录”入口。
- [x] 点击入口后打开资料完善层，复用头像选择、昵称原生表单和上传登录逻辑。
- [x] 登录成功后在首页独立账户区同时显示头像和昵称。
- [x] 将退出登录移出创建/加入表单，作为独立账户按钮。
- [x] 验证退出后清除会话并回到单一登录入口。
- [x] `/api/auth/wechat` 支持 `resumeOnly`，仅恢复已有 openid 身份，不创建占位资料。
- [x] 点击“微信登录”时先尝试恢复服务器保存的头像昵称，首次用户再打开资料层。
- [x] 移除账户身份区白色长方形底框，缩小退出按钮的视觉尺寸并保留 44px 点击区。

## 4. 质量与构建

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] 变更范围 Prettier 检查（仓库全量 `format:check` 有 95 个既有非本任务问题）。
- [x] 生产地址构建小程序并检查 dist 域名。
- [x] 构建服务端镜像/产物。

## 5. 生产部署与验证

- [x] 记录当前生产镜像与健康状态。
- [x] 使用现有安全增量流程部署新服务端。
- [x] 验证 `/health/live` 和 `/health/ready`。
- [x] 生产正向测试 `/api/upload/avatar-data` 返回可访问头像 URL。
- [x] 生产反向测试非法图片被拒绝。
- [x] 通过 11352 开发者工具验证登录卡片初始与错误状态；成功链路由线上接口探测覆盖，避免模拟器登录写入真实开发者身份。
- [x] 确认没有启动本地服务，没有上传体验版。
- [x] 通过 11352 验证登录入口、资料完善层、登录后账户区与退出流程。
- [x] 通过 11352 验证快速恢复、首次资料回退和轻量账户区。

## Risk / Rollback

- base64 比二进制约膨胀 33%，因此必须先压缩且服务端保留硬上限。
- 发布顺序必须先服务端、后交付小程序 dist，否则新客户端会命中不存在的接口。
- 生产探测产生的临时头像文件在现有头像目录中，文件体积极小；测试完成后记录 URL，不触碰用户头像。
