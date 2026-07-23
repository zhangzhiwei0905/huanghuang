# Design

## Overview

Two layers of work:
- **R1 微信登录**:让 `openid` 持久标识一个用户,首次登录建档(昵称+头像),之后复用同一账号;`avatarUrl` 作为 `AnonymousSession` 的新字段,像现有 `nickname` 一样,在创建/加入房间时被快照进房间的 `SeatController`,再投影给客户端。
- **R2 大厅牌桌化**:`.lobby-grid` 改用对局页已有的 `pos-self/pos-right/pos-opposite/pos-left` 定位类,展示头像(若有)+ 昵称 + 状态。

R1 是这次的主体工作(server + protocol + client),R2 相对独立且小,放在 R1 之后做(依赖 R1 产出的 `avatarUrl` 字段才有真实头像可显示,否则只是空位)。

## R1 微信登录

### 数据库(`apps/server/src/database.ts`)

`anonymous_sessions` 增加两个可空列(纯新增,存量行天然为 NULL,不需要数据迁移):

```sql
ALTER TABLE anonymous_sessions ADD COLUMN wechat_open_id TEXT;
ALTER TABLE anonymous_sessions ADD COLUMN avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_sessions_open_id
  ON anonymous_sessions (wechat_open_id);
```

SQLite 的 `UNIQUE` 索引允许多行 NULL(旧的匿名 session 都是 NULL,互不冲突),只对真正写入了 `wechat_open_id` 的行强制唯一。`ALTER TABLE ADD COLUMN` 在列已存在时会报错——`migrate()` 里对这两条 `ALTER` 分别包一层 try/catch,忽略"duplicate column"错误,和 `CREATE TABLE IF NOT EXISTS` 一样做成幂等迁移。

`AnonymousSession` 类型:

```ts
export type AnonymousSession = {
  id: string;
  nickname: string;
  wechatOpenId: string | null;
  avatarUrl: string | null;
};
```

新增 `GameDatabase` 方法:

```ts
findSessionByOpenId(openId: string): AnonymousSession | null
upsertWechatSession(params: { openId: string; nickname: string; avatarUrl: string | null }, tokenHash: string): AnonymousSession
```

`upsertWechatSession`:先按 `openId` 查是否已有行——有则 `UPDATE ... SET nickname=?, avatar_url=?, token_hash=?, last_seen_at=?`(新登录换发新 token,旧 token 自然失效,MVP 不做多端并存);没有则 `INSERT` 新行并带上 `wechat_open_id`。

### `/api/auth/wechat` 改造(`apps/server/src/index.ts`)

现状(已确认)是"验证 code 有效性,但丢弃 openid,每次发全新匿名 session"。改为:

```ts
app.post("/api/auth/wechat", async (request, reply) => {
  // ...现有 appId/appSecret 检查、code 校验不变...
  const body = request.body as { code?: unknown; nickname?: unknown; avatarUrl?: unknown };
  // ...jscode2session 换 openId,失败分支不变...
  const nickname = /* 现有裁剪逻辑，默认 "微信玩家" */;
  const avatarUrl = typeof body.avatarUrl === "string" && body.avatarUrl.length > 0
    ? body.avatarUrl
    : null;
  const token = randomBytes(32).toString("base64url");
  const session = database.upsertWechatSession({ openId, nickname, avatarUrl }, hashToken(token));
  sessions.attachSessionTokenHeader(reply, token); // 复用现有 header 挂载,mp 端本来就走 Bearer 不走 cookie
  return { sessionId: session.id, nickname: session.nickname, avatarUrl: session.avatarUrl, sessionToken: token };
});
```

`SessionIssueResponse`(`apps/miniprogram/src/api/session.ts` 里定义的类型)需要加 `avatarUrl: string | null`,`/api/session`(GET,resolve 现有 token)也要把 `avatarUrl` 带上,这样"再次打开小程序"时不用重新走一遍登录,直接用已存的 token resolve 出昵称+头像。

### 头像上传端点(新增)

依赖新增 `@fastify/multipart`(`^9.4.0`,与已用的 `@fastify/cookie@^11`、`@fastify/static@^8.3` 同属 fastify 官方插件生态,兼容 fastify@^5.6)。

```ts
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB 上限，头像不需要更大

const avatarDir = process.env.AVATAR_DIR ?? resolve(dirname(process.env.DATABASE_PATH ?? "./data/huanghuang.sqlite"), "avatars");
mkdirSync(avatarDir, { recursive: true });
await app.register(fastifyStatic, { root: avatarDir, prefix: "/avatars/", decorateReply: false });
// decorateReply:false — 第二次注册 fastifyStatic 时必须关掉，第一次给 webRoot 的注册已经装饰过 reply.sendFile

app.post("/api/upload/avatar", async (request, reply) => {
  const file = await request.file(); // @fastify/multipart
  if (file === undefined) return reply.code(400).send({ error: "NO_FILE" });
  const ext = file.mimetype === "image/png" ? "png" : "jpg"; // chooseAvatar 输出 jpg/png
  const filename = `${randomUUID()}.${ext}`;
  await pipeline(file.file, createWriteStream(join(avatarDir, filename)));
  return { avatarUrl: `/avatars/${filename}` };
});
```

存到 `DATABASE_PATH` 同目录下的 `avatars/` 子目录——和 sqlite 文件一样,生产环境已经通过 `deploy/compose.yaml` 的 `game_data` volume 持久化,不需要额外的 volume 声明。返回相对路径 `/avatars/xxx.jpg`,客户端拼 `API_BASE` 前缀使用(和现有 `tableBackground` 之类的静态资源引用方式不同,这个是运行时上传的动态资源,不能走 `import`)。

### 协议(`packages/protocol/src/projections.ts`)

```ts
export type PlayerProjection = {
  // ...现有字段...
  avatarUrl: string | null;
};

export type LobbySeatProjection = {
  // ...现有字段...
  avatarUrl: string | null;
};
```

`createRoomSchema`/`joinRoomSchema` **不改动**——`nickname` 字段继续存在(Web 端仍手动填,不受影响,满足 prd.md 的 Out of Scope);`avatarUrl` 不通过这两个命令传递,而是服务端在 resolve session 时就已经知道(见下)。

### `apps/server/src/room-service.ts`

`SeatController` 加 `avatarUrl: string | null`:

```ts
type SeatController = {
  seat: Seat;
  sessionId: string | null;
  nickname: string;
  avatarUrl: string | null;
  controller: PlayerController | "EMPTY";
  connected: boolean;
};
```

`botSeat()`:`avatarUrl: null`。
`humanSeat()`:形参类型从 `Pick<AnonymousSession, "id" | "nickname">` 扩到 `Pick<AnonymousSession, "id" | "nickname" | "avatarUrl">`,函数体加一行 `avatarUrl: session.avatarUrl`。
两处调用 `humanSeat(...)` 的 call site(`createRoom`/`joinRoom`)不用改——它们已经传入完整的 `session: AnonymousSession` 对象,类型扩展后自动满足。

`project()` 里两处读取 `controller.nickname` 的构造(`players` 数组 ~L788、`lobbySeats` 数组 ~L894)各加一行 `avatarUrl: controller.avatarUrl`。

### 客户端(`apps/miniprogram`)

**登录态检查**(新文件 `src/api/wechatAuth.ts` 或并入现有 `session.ts`):

```ts
export async function resolveIdentity(): Promise<{ nickname: string; avatarUrl: string | null } | null> {
  const token = getStoredSessionToken();
  if (token === null) return null;
  const response = await Taro.request({ url: `${API_BASE}/api/session`, header: authHeaders(token) });
  if (response.statusCode !== 200) return null;
  return response.data as { nickname: string; avatarUrl: string | null };
}
```

**首页登录门禁**(`src/pages/index/index.tsx`):组件顶部新增 `identity` state,`useEffect`(mount 时)调用 `resolveIdentity()`;结果为 `null`(没存 token,或 token 已失效)时渲染登录引导视图,而非直接进 `HOME` 菜单;拿到已登录身份则跳过登录视图,`nickname` 直接取自 `identity.nickname`,CREATE/JOIN/BOT 各表单原有的"昵称"手动输入框**移除**(nickname 静默透传给 `roomApi.create/join` 的既有 `nickname` 参数,不需要用户再填一遍)。

登录引导视图:

```tsx
function LoginGate({ onDone }: { onDone: (identity: Identity) => void }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  async function onChooseAvatar(e: { detail: { avatarUrl: string } }) {
    setBusy(true);
    try {
      const uploadRes = await Taro.uploadFile({
        url: `${API_BASE}/api/upload/avatar`,
        filePath: e.detail.avatarUrl, // chooseAvatar 回调字段名叫 avatarUrl，实际是本地临时路径
        name: "file",
      });
      const { avatarUrl: uploaded } = JSON.parse(uploadRes.data);
      setAvatarUrl(uploaded);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const { code } = await Taro.login();
      const res = await Taro.request({
        url: `${API_BASE}/api/auth/wechat`,
        method: "POST",
        data: { code, nickname: nickname.trim(), avatarUrl },
      });
      const data = res.data as SessionIssueResponse & { avatarUrl: string | null };
      if (data.sessionToken !== null) setStoredSessionToken(data.sessionToken);
      onDone({ nickname: data.nickname, avatarUrl: data.avatarUrl });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mp-login">
      <Button openType="chooseAvatar" onChooseAvatar={onChooseAvatar} className="mp-login__avatar-btn">
        {avatarUrl !== null ? <Image src={`${API_BASE}${avatarUrl}`} className="mp-login__avatar" /> : "选择头像"}
      </Button>
      <Input type="nickname" value={nickname} onBlur={(e) => setNickname(e.detail.value)} placeholder="给自己起个名字" />
      <Button className="mp-btn mp-btn--primary" disabled={busy || nickname.trim().length === 0} onClick={() => void submit()}>
        进入晃晃
      </Button>
    </View>
  );
}
```

`wx.login()` 的 `code` 一次性、几分钟内失效——只在用户点"进入晃晃"提交那一刻才去拿,不提前拿,避免用户填昵称填太久导致 code 过期。

**合规提醒(mp.weixin.qq.com 后台步骤,代码之外)**:收集用户头像属于"收集用户信息",微信要求小程序在 mp.weixin.qq.com 后台的"隐私保护指引"里声明会收集头像/昵称等信息,否则 `chooseAvatar`/上传流程在审核或真机上可能被拦截或提示——这和之前踩过的"域名白名单"是同一类"后台配置门槛",不是代码能解决的,写进 design.md 供上线前检查清单用,不在本任务实现范围内验证。

## R2 大厅牌桌化

`apps/miniprogram/src/pages/room/index.tsx` 的 `WAITING` 阶段 `.lobby-grid` 替换为复用 `POSITION_CLASS`(该常量已在文件顶部定义:`["pos-self","pos-right","pos-opposite","pos-left"]`)的座位布局:

```tsx
<View className="lobby-table">
  {room.lobbySeats.map((seat) => {
    const pos = POSITION_CLASS[relativePosition(seat.seat, selfSeat)] ?? "pos-self";
    return (
      <View key={seat.seat} className={`lobby-station ${pos}${seat.isSelf ? " is-self" : ""}${seat.ready ? " is-ready" : ""}`}>
        <View className="lobby-station__avatar">
          {seat.avatarUrl !== null ? (
            <Image src={`${API_BASE}${seat.avatarUrl}`} className="lobby-station__avatar-img" />
          ) : (
            <Text className="lobby-station__avatar-fallback">{seat.nickname?.slice(0, 1) ?? "?"}</Text>
          )}
        </View>
        <Text className="lobby-station__name">{seat.occupied ? seat.nickname : "空位"}</Text>
        <Text className="lobby-station__meta">
          {seat.isOwner ? "房主 · " : ""}
          {seat.occupied ? (seat.ready ? "已准备" : "未准备") : "等待中"}
        </Text>
      </View>
    );
  })}
</View>
```

CSS(`.lobby-station` 系列)直接照抄 `.player-station` 系列的定位/配色写法(同一套 `pos-*` 定位规则可以整体复用,只是容器换了个类名,避免和对局内 `.player-station` 的内容差异——碰李/操作态——耦合在一起),空位(`!seat.occupied`)用较淡的样式(不描边高亮),无头像时退化成"昵称首字"圆形占位,不引入额外图标资源。

## Risks / Rollback

- 数据库迁移是纯新增列 + 幂等 `ALTER`,不影响存量行,可安全回滚(回滚只需要不再读写这两列,列留着不会破坏旧代码路径)。
- `/api/auth/wechat` 修改前后签名兼容(返回值新增 `avatarUrl` 字段,旧客户端忽略多余字段不受影响)。
- 头像上传接口是全新路由,不影响现有路由;`avatarDir` 用现有 `DATABASE_PATH` 同目录,复用现有 volume,无需变更部署拓扑。
- 前端登录门禁是新增的"首屏拦截视图",如果 `/api/session` 或 `/api/auth/wechat` 请求失败,需要有清晰的失败态(比如网络错误提示 + 重试按钮),不能让用户卡死在白屏——implement.md 里列为验收项。
- Web 端完全不动(`createRoomSchema`/`joinRoomSchema` 不变,`PlayerProjection`/`LobbySeatProjection` 新增字段是可选读取,Web 端 `PlayerStation` 不读 `avatarUrl` 就还是现在的空占位符,不会报错也不会显示新头像——这是可接受的:prd.md 已把 Web 端头像/登录列为 Out of Scope)。
