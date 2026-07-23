# 小程序体验版登录修复设计

## 1. 根因与边界

失败发生在发布环境的客户端网络边界，而不是表单值、微信登录服务或头像选择本身：

```text
chooseAvatar（本地成功）
  → uploadFile（体验版可能被独立白名单拦截）
  → 请求未到服务器
  → 错误渲染在卡片外
  → 用户观察为“点击没反应”
```

本次用普通 `request` 传输压缩后的头像，复用已经为 REST 登录配置的合法域名。保留旧 multipart 路由作为兼容通道。

## 2. 服务端头像数据接口

新增页面无关的纯模块 `apps/server/src/avatar-upload.ts`：

- `decodeAvatarData(input)` 接收未知 JSON 字段。
- base64 文本必须非空、字符合法且长度有上限。
- 解码后最大 2 MiB。
- 通过 magic bytes 判断 PNG 或 JPEG，不信任客户端 MIME。
- 返回 `{ bytes, extension }`；错误返回可区分的业务原因或抛出专用错误。

`apps/server/src/index.ts` 新增：

```text
POST /api/upload/avatar-data
Content-Type: application/json
{ data: "<base64>" }

200 { avatarUrl: "/avatars/<uuid>.png|jpg" }
400 { error: "INVALID_AVATAR" }
413 { error: "AVATAR_TOO_LARGE" }
```

路由使用现有 `avatarDir` 和 UUID 文件名。Fastify 默认 JSON body limit 约 1 MiB；客户端把头像压缩到 256×256 后，正常请求远低于限制。纯模块仍保留 2 MiB 解码上限作为防御边界。

## 3. 小程序头像上传

`apps/miniprogram/src/api/session.ts` 的 `uploadAvatar()` 改为：

1. `Taro.compressImage({ src, quality: 82, compressedWidth: 256, compressedHeight: 256 })`。
2. 通过 `Taro.getFileSystemManager().readFile({ encoding: "base64" })` 读取压缩文件。
3. `Taro.request()` POST `/api/upload/avatar-data`。
4. 校验 HTTP 状态和响应 `avatarUrl`。

若压缩 API 失败，可回退读取原始临时文件；服务器大小和文件头校验仍是最终边界。客户端不再依赖 `Taro.uploadFile`，但服务端旧路由不删除。

## 4. 登录卡片交互

`LoginGate` 自己持有 `feedback`，避免父页面横向 flex 把错误排到卡片外：

```text
选择头像
微信昵称输入框
昵称说明
卡片内反馈：处理头像 / 上传 / 登录 / 错误
进入晃晃（busy 时显示“正在进入…”）
```

`Input` 保持不受控：

- `name="nickname"`
- `type="nickname"`
- `Form.onSubmit` 读取最终值
- 用户可以选择微信键盘建议并继续编辑

不调用 `getUserProfile`：现行规则不支持静默带出真实昵称，且旧接口在新基础库中可能只返回通用资料。

## 5. 验证与发布

- 纯函数单元测试覆盖 JPEG、PNG、非法字符、错误文件头、空数据和超限数据。
- 完整 lint、typecheck、test、format。
- 构建并部署服务端到现有阿里云 Docker 容器；无 DB 迁移。
- 生产接口使用临时生成的极小 PNG 数据探测，确认返回头像 URL，并验证非法数据为 400。
- 用生产 API 构建小程序。
- 通过开发者工具 11352 注入文件读取/请求模拟，验证进度和错误均在卡片内部；真实微信昵称键盘仍由体验版手机最终确认。

## 6. Rollback

- 客户端可回滚 `session.ts` 与登录页两个文件并重建。
- 服务端可保留新接口而回滚客户端，无兼容风险。
- 若需完整回滚，恢复部署前镜像；无数据库变更。
