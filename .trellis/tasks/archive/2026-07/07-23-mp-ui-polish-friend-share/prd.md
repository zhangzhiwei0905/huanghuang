# 小程序主页按钮加大、对局碰杠遮挡重设计、好友房分享排查

## Goal

三项独立的小程序体验改进:
1. 首页按钮/字体偏小,提升可读性和可点性。
2. 对局中左右玩家的碰/杠/放赖子牌组一多就会撑高信息卡片,挤压自己手牌/操作区,需要在**不使用横向滚动、不抽象为数量图标**的前提下,通过缩小牌面尺寸 + 更紧凑的布局解决遮挡。
3. 新增"分享邀请好友"能力:分享卡片携带房间号,好友点开后自动预填房间号(而非仅靠复制房号手动输入),并给出开发版/体验版/正式版的操作说明。

## Confirmed Facts

### R1 首页按钮/字体(`apps/miniprogram/src/pages/index/index.scss`)

- 全部用 `vmin` 定义,**无 px 下限**(对比对局页 tiles 普遍有 `min-width/min-height` px 楼层,见 `.mj-tile--compact`)。
- 落地设备是横屏手机,`vmin = min(width, height) / 100`,横屏下短边是高度(约 375–430 CSS px 实测机型范围,见 `.trellis/spec/frontend/miniprogram.md` "Layout math" 一节),即 1vmin ≈ 3.75–4.3px。
- 主菜单按钮 `.mp-btn`:`font-size: 3vmin`(≈11–13px)、`min-height: 9vmin`(≈34–39px)。
- 表单区按钮 `.mp-home__form-actions .mp-btn`:`font-size: 2.6vmin`、`height: 7.5vmin`。
- 输入框 `.mp-field__input`:`font-size: 2.6vmin`。标签/tagline/score chip 同级别,均 2.2–2.4vmin。
- 无 px 楼层是"偏小"的根因——矮屏机型上比对局页任何文字都更小,且缺乏兜底。

### R2 对局碰杠遮挡(`apps/miniprogram/src/pages/room/index.scss`)

- `.player-station.pos-left` / `.pos-right`:`position: absolute; top: 42%; transform: translateY(-50%)`,`max-width: 30vmin`,高度由内容撑开(无 `max-height`)。牌组多时,`transform: translateY(-50%)` 使得每一行新增高度**同时向上、向下扩张**——这是碰撞的结构性根因,不是偶发 bug。
- `.player-station__melds` 用 `flex-wrap: wrap`,每组 `.meld-group` 用 `.mj-tile--compact` 覆盖为 `width: 3.6vmin; height: 5vmin`(px 楼层 20×28)。一组 3~4 张牌 ≈ 11–15vmin 宽,`max-width: 30vmin` 下一行只能并排 ~2 组,第 3 组起就换行——而一名玩家最多可暴露 4 组(标准麻将结构 4 面子 + 1 对子,对子通常留在手牌不暴露),因此 3~4 组高杠场景必然多行堆叠。
- 关键发现:`.player-station.pos-left/.pos-right` 横向空间远未用满。`.discard-zone.pos-left/.pos-right` 与 `.player-station` 共享同一 42%/46% 的水平中心线,通过 `transform: translate(calc(-100% - 20vmin), -50%)` 定位,其左边缘距屏幕中心 ≈ `50% - 44vmin`(50% 是整屏宽度的一半,以 px 计;44vmin 只是短边尺度)。以参考机型(vmin≈3.75px,整屏宽 ≈812px)估算,`player-station-left`(左边缘固定于 `left:1vmin`)与 `discard-zone-left` 左边缘之间有 **≈60vmin 的可用横向空间**,而当前 `max-width:30vmin` 只用了一半不到——这就是"缩小牌面 + 加宽卡片、减少换行"这条路可行的关键证据。
- 结论(方向已与用户确认):不做横向滚动、不抽象为数量图标,而是①进一步缩小碰杠牌面尺寸,②加宽 `player-station` 的横向可用宽度以减少换行,③将 `pos-left/pos-right` 的垂直定位从"内容撑高时上下双向扩张"改为"仅向下扩张",从结构上消除双向碰撞风险。

### R3 好友房分享(代码 + 已有文档)

- 全仓库搜索确认:**没有 `wx.shareAppMessage` / 转发卡片实现**。当前唯一"邀请"路径是复制房间号(`docs/miniprogram-friend-room.md`),对方手动在"加入房间"里输入。
- `.trellis/spec/frontend/miniprogram.md`(2026-07-22 记录)确认:`appid` 已是**正式注册的小程序账号**(非测试号),服务器域名白名单(请求 + socket)已配置完成,真机联调已验证通过。
- 微信小程序分发有三层,**都是 mp.weixin.qq.com 后台配置,代码无法决定**:
  - **开发版**:仅后台"成员管理"里加过的项目成员(需对方微信号)能扫码打开。
  - **体验版**:后台"版本管理"指定某上传版本为体验版,仅体验成员(同样后台加好友微信号,人数有上限)能打开。
  - **正式版**:提交审核通过后发布,任何人可搜索/扫码/分享卡片打开。
- 用户尚未实际尝试分享。技术判断:AppID 已正式、域名已配置,唯一未做的是"后台加白名单"或"提审发布"——这两步都需要用户自己去 mp.weixin.qq.com 网页后台操作,任何代码都无法代劳。
- 代码可确定的事实:即使打通版本权限,当前入口(`pages/index/index`)对 `mode:"HOME"` 无路由参数处理,好友点开分享卡片后仍需手动切到"加入房间"、手动输入 6 位房号——没有一键预填。
- Taro 4.2.1 确认可用 API(`node_modules/.../@tarojs/taro/types/api/taro.hooks.d.ts`):`useShareAppMessage(callback)`(转发回调)、`useRouter<TParams>(dynamic?)`(读取页面路由参数,含分享 path 上的 query)。

## Requirements

### R1 首页按钮/字体放大
- 主菜单 `.mp-btn`:`font-size` 3vmin → 3.6vmin,`min-height` 9vmin → 10.5vmin,并补 px 楼层(参照对局页 `.mj-tile--compact` 的写法)。
- 表单区按钮/输入框/标签/tagline/score chip 同比例上调(约 +20%),同样补 px 楼层。

### R2 对局碰杠展示重设计
- 新增/调整专用于碰杠展示的牌面尺寸(比现有 `.player-station__melds .mj-tile--compact` 的 3.6×5vmin 更小,同时补更小的 px 楼层),使 4 组暴露面子(含杠)+ 放赖子在一行内大概率不换行。
- 加宽 `.player-station.pos-left/.pos-right` 的 `max-width`,在已验证的 ~60vmin 安全余量内取值(留出对更窄屏比例设备的缓冲,不能顶满)。
- 调整 `.player-station.pos-left/.pos-right` 的垂直定位方式,从"居中双向扩张"改为"仅向下扩张",消除结构性的双向碰撞。`flex-wrap` 保留作为极端情况(超窄屏 + 4 杠同时)的兜底,不追求 100% 杜绝换行,但换行时只能向下影响,不能影响 `self-area`。

### R3 好友房分享
- 新增分享入口:房间内(等待大厅或对局中)增加"分享邀请好友"按钮,触发 `wx.shareAppMessage`。
- 分享 path 指向 `pages/index/index?code=<roomCode>`(不能直接分享到 `pages/room/index`,该页依赖 `Taro.setStorageSync` 写入的会话/房间状态,冷启动直接进入会因缺状态崩溃或异常)。
- `pages/index/index` 用 `Taro.useRouter()` 读取 `code` 参数,若存在且为 6 位数字,进入时自动切到 `mode:"JOIN"` 并预填 `roomCode`,好友只需填昵称、点"进入"。
- 交付一份操作说明文档,说明开发版/体验版/正式版三层的后台操作入口(成员管理 / 版本管理 / 提交审核),明确这些步骤需要用户自己在 mp.weixin.qq.com 完成,代码侧已无阻塞项。

## Acceptance Criteria

- [ ] 横屏最小机型(vmin≈3.75px 档位)下,首页主按钮文字与点击区域肉眼可辨、不小于对局页任意可交互文字;`pnpm typecheck` 与 `pnpm build:weapp` 通过。
- [ ] 一名玩家同时存在 4 组碰/杠 + 放赖子时,`.player-station.pos-left/.pos-right` 不得与 `self-area` 发生视觉重叠(开发者工具人工验证);正常 0~2 组场景下卡片位置与现状视觉一致(无回归)。
- [ ] 房间内新增分享按钮,触发分享后卡片 path 含房间号;`pages/index/index` 收到 `code` 参数后自动进入"加入房间"模式并预填房号;`pnpm typecheck` 通过。
- [ ] 交付一份 mp.weixin.qq.com 后台操作说明(开发版/体验版/正式版),用户确认可按文档自行操作。

## Out of Scope

- 微信小程序审核提交本身(需要用户在 mp.weixin.qq.com 后台操作,本任务只给步骤说明)。
- 代码质量面板此前已处理的三项(JS 压缩、组件按需注入、图片资源)不在本任务范围内。
- 直接分享到 `pages/room/index` 的免手动加入(即分享后自动 join 房间、跳过昵称/加入操作)——服务器 join 需要先建立会话(`issueSession`),这属于更大的免登录深链改造,超出本次范围。
