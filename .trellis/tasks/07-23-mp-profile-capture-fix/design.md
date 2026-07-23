# 小程序头像昵称采集与牌桌身份展示设计

## Scope

本任务只修改小程序客户端：

- `apps/miniprogram/src/pages/index/index.tsx`
- `apps/miniprogram/src/pages/index/index.scss`（仅在表单语义调整需要样式时）
- `apps/miniprogram/src/pages/room/index.tsx`
- `apps/miniprogram/src/pages/room/index.scss`

现有服务端和协议已经提供完整字段与接口，不修改 `apps/server`、`packages/protocol`、数据库或部署拓扑。

## 1. 登录资料采集

### 1.1 数据流

```text
用户点击选择头像
  → chooseAvatar 返回本地临时路径
  → avatarTempPath state
  → 立即用本地路径渲染预览

用户聚焦昵称输入框
  → 微信键盘提供“使用微信昵称”
  → 用户可继续编辑
  → Form submit 从 event.detail.value.nickname 读取最终原生值

提交
  → 校验头像已选择、昵称 trim 后非空
  → uploadAvatar(avatarTempPath)
  → 线上 /api/upload/avatar 返回持久 avatarUrl
  → wechatLogin(nickname, avatarUrl)
  → 线上 /api/auth/wechat 持久化 openid + 昵称 + 头像
  → 保存 session token，进入首页
```

### 1.2 原生 Form 边界

当前实现把昵称作为 React 受控值，并依赖 `onInput`/`onBlur` 更新 state。微信原生“使用微信昵称”可能只更新原生输入框而不触发这些事件，因此 React state 不是可靠提交源。

改为：

- `LoginGate` 使用 Taro `Form`。
- `Input` 设置 `name="nickname"`、`type="nickname"`、`maxlength={12}`，不再用 React `value` 控制原生值。
- 登录按钮设置 `formType="submit"`。
- `Form.onSubmit` 从 `event.detail.value.nickname` 读取提交瞬间的原生值。
- trim 和非空校验仍在客户端执行；服务端继续作为最终 12 字限制边界。

这既能捕获微信昵称建议，也保留手动编辑。

### 1.3 头像状态与失败恢复

状态只保存微信返回的本地临时路径 `avatarTempPath`：

- `onChooseAvatar` 只校验路径非空并更新 state，不发网络请求。
- `<Image src={avatarTempPath}>` 立即显示本地预览。
- 提交时先上传，再登录。
- 上传失败保留 `avatarTempPath`，用户可直接重试，不必重新选头像。
- 登录失败也保留已选头像和输入框当前值；`finally` 必须解除 busy。
- 未选头像或昵称为空时在发请求前提示，头像为必填。

## 2. 牌桌身份信息

### 2.1 投影边界

客户端只展示服务端投影：

- 等待大厅：`LobbySeatProjection.avatarUrl`、`nickname`、`score`、`isOwner`、`ready`、`connected`。
- 正式对局：`PlayerProjection.avatarUrl`、`nickname`、`score`、`handCount`、`personalMultiplier`、`connected`、`controller`。

`packages/protocol/src/projections.ts` 与 `apps/server/src/room-service.ts` 已完整提供这些字段，不新增派生账号状态或客户端计分。

### 2.2 复用头像渲染

在 `room/index.tsx` 内定义页面局部的 `SeatAvatar` 展示组件，供大厅与正式对局复用：

- `avatarUrl !== null`：显示 `${API_BASE}${avatarUrl}` 图片。
- 无头像且 `controller === "BOT"`：显示“机”。
- 无头像真人：显示昵称首字；空座位显示空字符串。
- 组件只负责展示，不持有状态、不发请求。

大厅现有头像结构迁移到 `SeatAvatar`，并在 meta 中加入服务器下发的积分。

### 2.3 正式对局布局

每个 `.player-station` 调整为：

```text
identity row
├── avatar
└── copy
    ├── nickname + bot marker
    └── score · hand count · multiplier · connection

meld row (existing, full width)
```

头像使用紧凑尺寸并设 `flex-shrink: 0`；昵称继续单行省略。碰/杠牌组保持在独立的下一行，避免头像改变其可用宽度。四个方位仍沿用 `POSITION_CLASS`，不改变牌桌权威布局或操作区域。

## 3. Compatibility

- 返回用户通过 `/api/session` 恢复已持久身份，不重复采集。
- 历史无头像真人使用首字占位；机器人使用“机”。
- 体验版和自动化构建必须显式注入 `https://huanghuang.amazingzz.xyz`。
- 不启动本地服务。
- 微信开发者工具 11352 是 HTTP 服务端口；用 CLI 从该端口开启 automation，并以 `dist` 为项目目录，避免源码根 `miniprogramRoot` 在独立自动化窗口中的路径识别问题。

## 4. Validation

1. 小程序 TypeScript 类型检查。
2. Prettier 检查修改文件。
3. 使用生产 API 地址构建 weapp。
4. 检查 `dist/common.js` 含生产域名且不含 `127.0.0.1:3000`。
5. 请求线上 `/health/live`，预期 HTTP 200。
6. 通过 11352 启动 `dist` 自动化会话：
   - 清空测试会话存储并打开首页；
   - 页面栈包含 `pages/index/index`；
   - 登录门禁截图包含头像、昵称和提交控件；
   - 通过生产服务器创建临时匿名 BOT 房，仅用于验证无头像真人首字、机器人“机”、昵称、积分和其他 meta 的牌桌布局；不触碰真实微信账号资料。
7. 原生微信昵称建议与头像选择的最终验收在真机体验版完成；开发者工具对原生 input/chooseAvatar 的模拟不等价于真机。

## 5. Rollback

本任务无数据库迁移和服务端变更。回滚只需恢复上述小程序源文件并用同一生产 API 地址重新构建 `dist`。
