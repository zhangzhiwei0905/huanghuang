# Bug Analysis: 体验版选择头像后无法进入

## Bayesian Diagnosis

| Hypothesis | Prior | Evidence update | Final |
|-----------|------:|-----------------|------:|
| `uploadFile` 合法域名或体验版平台拦截 | 45% | 真机调试上传与登录均为 200；体验版点击后生产端没有新的上传请求；开发工具 `urlCheck: false` 会掩盖域名校验 | 90% |
| 昵称原生输入值没有进入 React 状态 | 35% | 既有实现已经通过原生 `Form.onSubmit` 读取最终值，且本次失败发生在服务端收到登录请求之前 | 5% |
| 服务端微信登录接口异常 | 20% | 同版本真机调试 `/api/auth/wechat` 返回 200，体验版失败时服务端没有登录请求 | 5% |

最有区分度的证据是生产访问日志：体验版失败时，头像上传和登录接口都没有收到请求，因此问题在微信客户端的平台拦截阶段，而不是登录业务逻辑。

## 1. Root Cause Category

- **Category**: D - Test Coverage Gap；E - Implicit Assumption
- **Specific Cause**: 验证只覆盖了开发者工具和真机调试，默认它们与体验版执行相同的网络域名策略。实际上 `uploadFile` 与 `request` 使用独立合法域名，且 `urlCheck: false`/调试通道会掩盖发布环境限制。错误信息又渲染在横屏登录卡片之外，让平台拒绝看起来像按钮没有响应。

## 2. Why Fixes Failed

1. **原生 Form 取昵称**：修复了微信昵称建议不一定触发 Taro 输入事件的问题，但没有覆盖头像上传的发布环境通道。
2. **真机调试通过即认为完成**：测试环境没有执行与体验版一致的域名校验，属于环境覆盖不足。
3. **页面级错误提示**：网络错误虽然被捕获，但横屏布局中提示位于可视卡片之外，用户无法看见真实失败原因。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Architecture | 压缩头像后用 base64 JSON 走已有 `request` 合法域名，避免登录依赖独立 `uploadFile` 白名单 | DONE |
| P0 | Runtime UX | 上传、登录进度及原始平台错误都在登录卡片内展示，并在失败后解除 busy、保留输入 | DONE |
| P0 | Release verification | 先发布服务端，再用正式域名构建小程序；线上正向/反向探测头像接口 | DONE |
| P1 | Test coverage | 单测覆盖 base64、大小、PNG/JPEG 文件头的所有接受/拒绝路径 | DONE |
| P1 | Documentation | 在小程序规范记录体验版与调试环境差异，在后端规范记录头像接口契约 | DONE |

## 4. Systematic Expansion

- **Similar Issues**: WebSocket 仍依赖独立 `socket` 合法域名；未来任何重新引入的 `wx.uploadFile` 都必须单独验证体验版白名单。
- **Design Improvement**: 登录关键链路统一走一个 HTTPS request origin，减少平台配置面；服务端在写盘前集中验证头像数据。
- **Process Improvement**: “开发工具/真机调试通过”不能替代体验版验收。发布前检查正式构建产物中的域名，并核对线上是否实际收到关键请求。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/frontend/miniprogram.md`：请求域名头像通道、卡片内反馈、体验版验证。
- [x] 更新 `.trellis/spec/backend/error-handling.md`：`/api/upload/avatar-data` 状态码和错误契约。
- [x] 项目没有 `src/templates/markdown/spec/` 模板树，因此无可同步模板。
- [x] 在本任务中保存根因、证据、预防机制和生产验证结果。
