# Design

## R1 首页按钮/字体放大

`apps/miniprogram/src/pages/index/index.scss`,纯数值调整,不改结构:

| 选择器 | 属性 | 现值 | 新值 |
|---|---|---|---|
| `.mp-btn` | `font-size` | 3vmin | 3.6vmin(+px 楼层 14px/上限 20px) |
| `.mp-btn` | `min-height`/`height` | 9vmin | 10.5vmin(+px 楼层 42px/上限 60px) |
| `.mp-home__form-actions .mp-btn` | `font-size` | 2.6vmin | 3.1vmin |
| `.mp-home__form-actions .mp-btn` | `min-height`/`height` | 7.5vmin | 8.8vmin(+px 楼层 36px) |
| `.mp-field__input` | `font-size` | 2.6vmin | 3vmin |
| `.mp-field__label` | `font-size` | 2.3vmin | 2.7vmin |
| `.mp-home__tagline` | `font-size` | 2.2vmin | 2.5vmin |
| `.mp-score` | `font-size` | 2.4vmin | 2.8vmin |

px 楼层写法参照 `.mj-tile--compact` 的 `min-width`/`max-width` 模式,防止矮屏进一步缩水,同时用 `max-*` 防止宽屏/平板异常放大。

## R2 对局碰杠展示重设计

### 现状根因(已在 prd.md 确认)

`.player-station.pos-left/.pos-right` 用 `top: 42%; transform: translateY(-50%)` 做垂直居中,内容(碰杠牌组)撑高时向上、向下同时扩张,与 `self-area`(底部)或对面元素(顶部)重叠。`max-width: 30vmin` 过窄导致 3 组以上必然换行堆叠,而实测左右两侧到 `discard-zone` 之间有 ~60vmin 未使用的横向空间。

### 方案:缩小牌面 + 加宽卡片 + 单向扩张

**1. 新增专用小尺寸(碰杠牌面),不复用 discard-zone 或通用 compact:**

```scss
/* apps/miniprogram/src/pages/room/index.scss */
.player-station__melds .mj-tile--compact {
  width: 2.6vmin;
  height: 3.6vmin;
  min-width: 15px;
  min-height: 21px;
  max-width: 19px;
  max-height: 26px;
}
```

对比现值 3.6×5vmin(楼层 20×28),新尺寸各维度缩小 ~28%,单张牌面积减少 ~48%。

**2. 加宽 `player-station` 横向可用宽度:**

```scss
.player-station.pos-left,
.player-station.pos-right {
  max-width: 46vmin; /* 现值 30vmin */
}
```

取 46vmin 而非验证到的 ~60vmin 上限,留出 ~14vmin 缓冲给比参考机型更窄(宽高比更接近 1:1)的设备,避免加宽后在个别机型上反而顶到 `discard-zone`。

**3. 验证新尺寸下单行是否能容纳最坏情况(4 组 + 放赖子):**

4 组暴露面子(假设最坏为 4 杠,每组 4 张)= 16 张牌:
`16 × 2.6vmin + 12 × 0.15vmin(组内gap) + 3 × 0.6vmin(组间gap) + 放赖子区(~4vmin)`
`≈ 41.6 + 1.8 + 1.8 + 4 = 49.2vmin`

这已超过拟定的 46vmin 预算(且 4 杠同时出现的实际概率极低,3 组是更常见的上限)。因此**保留 `flex-wrap: wrap` 作为兜底**——极端 4 杠场景仍可能换行一次,但换行只增加一行(~4vmin),且下一步的定位改造保证换行只向下扩张,不再双向碰撞。不追求"任何情况下绝对单行",这符合 prd.md 里"不追求 100% 杜绝换行,但换行时只能向下"的验收标准。

**4. 垂直定位从"居中双向扩张"改为"仅向下扩张":**

```scss
.player-station.pos-left,
.player-station.pos-right {
  top: 39%;        /* 原 42%，上移 ~3 个百分点补偿去掉 translateY(-50%) 的偏移 */
  /* 不再有 transform: translateY(-50%) */
}
```

推导:当前空状态(无碰杠,仅名字+分数两行文字)卡片高度 ≈ 6.5vmin,`top:42%` 居中意味着空状态顶边 ≈ `42% - 3.25%(半高) ≈ 38.75%`。去掉居中 transform 后,若仍用 `top:42%` 作为顶边,空状态会比现状下移 ~3.25 个百分点。改为 `top:39%` 使空状态顶边位置与现状基本一致(≈ 38.75%~39%),即**碰杠为空或较少时视觉位置与现状几乎无差异**,只有牌组变多时卡片才向下变长——不再向上侵犯对面元素,验收标准里"正常场景无回归"由此满足。

`top:39%` 这个数值是基于文字行高估算的近似值,不是像素级精确测量(本环境无法对用户本地开发者工具做可视化验证)。实现后需要**用户在自己的开发者工具里目测确认**空状态位置是否跟现状一致,若有 1~2vmin 的偏差可现场微调 `top` 值,不是需要重新设计的问题。

**5. 弃牌区(discard-zone)不改**——重叠风险只来自 `player-station`,`discard-zone` 尺寸/位置本次不涉及。

## R3 好友房分享

### 分享入口

`apps/miniprogram/src/pages/room/index.tsx` 的等待大厅 / 对局头部区域,新增"分享邀请好友"按钮(復制房号按钮旁边),配合:

```tsx
import Taro from "@tarojs/taro";

Taro.useShareAppMessage(() => ({
  title: `晃晃麻将 · 房间 ${room.roomCode}`,
  path: `/pages/index/index?code=${room.roomCode}`,
}));
```

按钮本身可以是普通 `<Button open-type="share">`(微信原生转发能力,点击即触发分享面板,复用上面的 `useShareAppMessage` 回调提供卡片内容),不需要手动调用 `wx.shareAppMessage`(那是给非按钮场景用的编程式转发,`open-type="share"` 是标准做法且更符合小程序转发规范)。

### 分享目标 & 预填

不分享到 `pages/room/index`——该页面 `onLoad` 直接读 `Taro.getStorageSync("huanghuang_open_room")`,冷启动没有这个 storage 会渲染空/异常。分享目标固定为 `pages/index/index?code=<roomCode>`。

`apps/miniprogram/src/pages/index/index.tsx` 组件顶部增加:

```tsx
const router = Taro.useRouter();
const [mode, setMode] = useState<Mode>(() => {
  const code = router.params.code;
  return code !== undefined && /^\d{6}$/u.test(code) ? "JOIN" : "HOME";
});
const [roomCode, setRoomCode] = useState(() => {
  const code = router.params.code;
  return code !== undefined && /^\d{6}$/u.test(code) ? code : "";
});
```

好友点开分享卡片 → 直接落在"加入房间"表单,房号已填好 → 只需填昵称、点"进入"。不做"自动 join、跳过表单"(prd.md Out of Scope 已说明:那需要先有会话才能 join,属于更大的免登录深链改造)。

### 版本权限说明文档

新增 `docs/miniprogram-release-channels.md`(或并入现有 `docs/miniprogram-friend-room.md`),列出:
- 开发版:mp.weixin.qq.com → 管理 → 成员管理 → 添加"项目成员",需对方微信号,该成员用开发者工具/预览扫码可打开。
- 体验版:mp.weixin.qq.com → 管理 → 版本管理 → 选定上传版本设为体验版 → 添加"体验成员"(同样需要微信号,数量有上限),该成员扫体验版二维码可打开。
- 正式版:提交审核 → 通过后发布,任何人可搜索/扫码/通过分享卡片打开,不再需要名单。
- 明确这三层操作全部在 mp.weixin.qq.com 网页后台完成,当前代码/AppID/域名配置均已就绪,不阻塞。

## Risks / Rollback

- R1/R2 都是纯 CSS 数值 + 一处 `transform`/`top` 调整,单文件可回滚(`git diff`/`git checkout` 对应 scss 文件)。
- R2 的 `top` 精确值依赖用户目测确认,提前在 prd/design 里说明这一点,避免"设计已定" 的错觉。
- R3 新增的 `useShareAppMessage`/`useRouter` 用法是 Taro 官方 API(已在 `@tarojs/taro@4.2.1` 类型定义中确认存在),风险低;唯一行为改动点是 `pages/index/index` 的 `mode`/`roomCode` 初始值从路由参数派生,不影响无 `code` 参数的正常直接打开路径。
