# 好友组队与机器人排位体验升级技术设计

## 1. 设计目标与边界

本次在现有单实例 Fastify + Socket.IO + SQLite 架构内完成，不引入外部消息队列、微信订阅消息或第二套用户系统。

交付客户端仅为 `apps/miniprogram`。`apps/web` 不新增好友界面，但必须继续通过共享协议类型检查、测试和构建。

权威边界：

- SQLite 持有玩家 ID、好友申请、好友关系和房间邀请。
- `RoomService` 持有当前房间成员、队伍状态和可加入性。
- `MatchmakingService` 持有排队编组与机器人补位选择。
- `SessionPresence` 持有当前进程内在线状态。
- 小程序只渲染服务端投影并发送意图，不在本地推断好友关系、邀请有效性或匹配结果。

## 2. 现状审计

### 2.1 产品与信息架构

- 小程序主页账号条已经包含头像、昵称、段位和退出入口。
- 主操作区纵向堆叠“单人排位、组队排位、人机对战、创建房间、加入房间”五个大按钮。
- “允许机器人”勾选项位于主页，只能影响单人排位。
- `TEAM_MATCH` 已提供固定规则等待房、分享房号、队员准备、房主开始和整队取消。
- 玩家详情弹窗已在主页、等待房和牌桌复用，但没有玩家 ID 与好友操作。

### 2.2 视觉资产与保留项

- 保留双麻将牌“晃晃”Logo、牌桌背景、翡翠绿主色、米白牌面和段位徽章。
- 保留横屏、无滚动主场景和安全区适配。
- 退休五个同权重大按钮的纵向菜单，以及主页内独立的单双排入口。
- 统一圆角规则：容器 14px，输入和普通按钮 10px，状态标签使用全圆角。
- 主强调色保持 `#2f6a4c`。次级入口用同一冷绿中性色的深浅变化，不引入多组高饱和强调色。

### 2.3 现有缺陷证据

- `MatchmakingService.enqueueParty()` 只接受 2-4 人，并把整队 `allowBots` 固定为关闭。
- 机器人补位从 `idleBots.slice(0, neededBotCount)` 固定截取数组头部。
- 机器人补位没有读取机器人的实际竞技段位，也没有复用等待范围。
- 后 7 个预置机器人初始段位为 0，前三个为 17、13、9；固定数组顺序直接造成少数机器人反复出现。

## 3. 共享协议

新增 `packages/protocol/src/social.ts`，由协议包统一导出运行时 schema 与 TypeScript 类型。

核心类型：

```ts
type PlayerId = string; // schema: /^[1-9]\d{3}$/

type SocialPlayer = {
  playerId: PlayerId;
  nickname: string;
  avatarUrl: string | null;
  competitiveProfile: PublicCompetitiveProfile | null;
};

type FriendSummary = SocialPlayer & {
  online: boolean;
  friendsSince: string;
};

type FriendRequestProjection = {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  player: SocialPlayer;
  createdAt: string;
};

type RoomInviteProjection = {
  id: string;
  roomCode: string;
  inviter: SocialPlayer;
  expiresAt: string;
};

type SocialSnapshot = {
  self: SocialPlayer;
  friends: FriendSummary[];
  friendRequests: FriendRequestProjection[];
  roomInvites: RoomInviteProjection[];
};
```

房间投影扩展：

- `PlayerProjection.playerId: PlayerId | null`
- `LobbySeatProjection.playerId: PlayerId | null`
- `SpectatorProjection.playerId: PlayerId | null`
- 预置机器人和旧匿名账号投影为 `null`。
- Web 客户端可忽略新增字段，不需要新增界面。

排位协议扩展：

- `teamMatchmakingProjectionSchema.memberCount` 从 2-4 调整为 1-4。
- 新增团队开始输入 `{ allowBots?: boolean }`。
- `RoomProjection` 中团队排队状态继续作为房间唯一展示来源。

## 4. SQLite 数据模型与迁移

### 4.1 玩家 ID

给 `anonymous_sessions` 增加：

```sql
player_id TEXT CHECK (player_id IS NULL OR player_id GLOB '[1-9][0-9][0-9][0-9]')
```

增加部分唯一索引：

```sql
CREATE UNIQUE INDEX idx_anonymous_sessions_player_id
ON anonymous_sessions(player_id)
WHERE player_id IS NOT NULL;
```

分配规则：

- 只给微信绑定真人分配，机器人与旧匿名账号保持 `NULL`。
- 现有微信账号在启动迁移中补齐。
- 新微信账号创建时在同一事务内分配。
- 从 1000-9999 的未占用值中选择，使用随机起点后顺序探测，唯一索引处理竞争。
- 9000 个值耗尽时返回稳定错误 `PLAYER_ID_CAPACITY_EXHAUSTED`，不得覆盖已有 ID。

`AnonymousSession` 与统一 `SESSION_COLUMNS` 增加 `playerId`，所有 session 查询共用该字段来源。

### 4.2 好友申请

```sql
CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  requester_session_id TEXT NOT NULL,
  recipient_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (requester_session_id <> recipient_session_id),
  FOREIGN KEY (...) REFERENCES anonymous_sessions(id) ON DELETE CASCADE
);
```

使用部分唯一索引保证同方向只有一条待处理申请。反方向已有待处理申请时不自动加好友，返回该申请供客户端提示用户去“收到的申请”中确认。

### 4.3 好友关系

```sql
CREATE TABLE friendships (
  lower_session_id TEXT NOT NULL,
  upper_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (lower_session_id, upper_session_id),
  CHECK (lower_session_id < upper_session_id),
  FOREIGN KEY (...) REFERENCES anonymous_sessions(id) ON DELETE CASCADE
);
```

接受申请在一个事务内：

1. 校验接收方、待处理状态和双方账号。
2. 按排序后的 session id 写入唯一好友关系。
3. 将该申请标为 `ACCEPTED`。
4. 将双方之间其他待处理申请关闭。

删除好友只删除一条无方向关系，历史比赛与申请审计记录不删除。

### 4.4 房间邀请

```sql
CREATE TABLE room_invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  inviter_session_id TEXT NOT NULL,
  invitee_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (...) REFERENCES anonymous_sessions(id) ON DELETE CASCADE
);
```

同一房间、同一邀请人和接收人的待处理邀请幂等复用。查询社交快照时把超过 10 分钟或房间已不可加入的邀请视为失效。房间关闭、开始排队、满员时由领域服务批量失效。

## 5. 服务端社交领域

新增 `apps/server/src/social-service.ts`，封装所有好友与邀请业务判断。数据库类只负责事务和查询，不读取在线状态或房间内存。

`SocialService` 依赖：

- `GameDatabase`
- `(sessionId) => presence.isConnected(sessionId)`
- 房间查询、成员校验和可加入性函数

REST 契约：

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/social` | 获取自己的好友、申请和有效房间邀请 |
| GET | `/api/players/:playerId` | 精确搜索玩家并返回关系状态 |
| POST | `/api/friend-requests` | 按 4 位玩家 ID 发起申请 |
| DELETE | `/api/friend-requests/:id` | 申请方撤回 |
| POST | `/api/friend-requests/:id/accept` | 接收方接受 |
| POST | `/api/friend-requests/:id/decline` | 接收方拒绝 |
| DELETE | `/api/friends/:playerId` | 二次确认后双向删除好友 |
| POST | `/api/rooms/:code/invites` | 当前房间成员邀请在线好友 |
| POST | `/api/room-invites/:id/accept` | 接受并加入仍可加入的排位房 |
| POST | `/api/room-invites/:id/decline` | 拒绝邀请 |

搜索仅支持完整 4 位 ID，不提供模糊列表，避免把 4 位空间直接暴露成通讯录。

稳定错误码：

- `PLAYER_NOT_FOUND`
- `PLAYER_ID_CAPACITY_EXHAUSTED`
- `SELF_FRIEND_REQUEST`
- `ALREADY_FRIENDS`
- `FRIEND_REQUEST_PENDING`
- `INCOMING_FRIEND_REQUEST_PENDING`
- `FRIEND_REQUEST_NOT_FOUND`
- `NOT_FRIENDS`
- `FRIEND_OFFLINE`
- `ROOM_INVITE_NOT_AVAILABLE`
- 复用 `ROOM_FULL`、`ROOM_NOT_JOINABLE`、`NOT_A_MEMBER` 和 `UNAUTHENTICATED`

## 6. 实时通知与在线状态

每个已认证 Socket 在连接后加入私有频道 `session:<sessionId>`。

社交变更只发送：

```ts
socket.emit("social:update", { reason: "FRIEND_REQUEST" | "FRIENDSHIP" | "ROOM_INVITE" });
```

事件不携带好友列表或邀请详情。接收端串行调用 `GET /api/social`，从服务端重新获取自己的私有快照。

小程序新增 `useSocial`：

- 主页实例负责好友角标、管理面板和房间邀请。
- 房间页实例负责牌桌内好友申请和邀请选择器。
- 使用命名 handler，卸载时逐一清理。
- 多个页面 Socket 可同时存在，`SessionPresence` 的 socket 计数保证只有最后一个断开才变为离线。
- 所有 HTTP 变更完成后立即刷新本地社交快照，不做乐观关系写入。

## 7. 统一排位房

### 7.1 入口与房间

主页只保留一个主入口“排位赛”，点击后创建 `TEAM_MATCH` 房并进入等待页。单人不再直接从主页写入普通匹配队列。

队伍大小改为 1-4：

- SQLite `party_size` CHECK 扩为 1-4，需要安全重建 `matchmaking_entries` 并保留现有行。
- `enqueueMatchmakingParty` 接受 1-4 个唯一 session。
- 一人队伍仍携带 `party_id = room.id`，保证取消、恢复和房间投影只有一套逻辑。
- 普通算法把一人队伍视为完整队伍，仍可与单排或其他整队组合，永不拆队。

### 7.2 准备与开始

- `TEAM_MATCH` 房主不显示准备按钮。
- 非房主成员使用现有幂等 ready API。
- `prepareTeamMatch` 校验 1-4 人，且所有非房主成员均已准备。
- 房主点击开始时提交 `{ allowBots }`，服务端把同一值原子写入整队所有排队行。
- 排队开始后禁止加入、继续邀请或修改机器人选项。
- 任一成员取消仍取消整队并清空队员准备状态。

### 7.3 邀请加入

- 排位房任一真人成员可从自己的在线好友中发邀请。
- 接收方接受时复用 `RoomService.joinRoom()` 的唯一座位逻辑。
- 接受成功后返回接收方私有 `RoomProjection`，小程序写入 `huanghuang_open_room` 并导航到房间。
- 满员、已开始排队、房间关闭、非好友或邀请过期都拒绝加入，不能在客户端绕过。

## 8. 机器人匹配算法

机器人候选使用数据库中的实时竞技档案，不使用 `RANKED_BOTS` 的初始等级常量判断。

新增纯函数：

```ts
selectBotFillGroup(entries, botCandidates, now): {
  humans: MatchmakingCandidate[];
  bots: RankedBotCandidate[];
} | null
```

规则：

1. 最早等待且开启机器人补位的完整队伍为锚点。
2. 可追加兼容的完整队伍或单人，最多凑到 3 名真人，不能拆队。
3. 5 秒聚合窗口前不使用机器人。
4. 每个机器人必须与组内每名非同队真人满足该真人当前等待范围。
5. 机器人必须没有活动竞技比赛。
6. 候选按 `lastMatchedAt ASC NULLS FIRST` 排序，再以稳定 session id 打破同次平局。
7. 机器人不足时继续等待，10/20/40 秒后沿用 `matchmakingRange()` 自动扩大。
8. 40 秒后范围为无限，空闲机器人足够时必须开局。

数据库提供机器人最近比赛时间查询。比赛创建事务继续负责最终活动比赛冲突校验。

测试覆盖：

- 10 个机器人都能在兼容条件下被选中。
- 连续对局不会固定使用数组前三项。
- 高低段位不兼容时在扩展前不补位，扩展后可补位。
- 1-4 人整队从不拆分。
- 多桌并发不复用正在比赛的机器人。

## 9. 小程序界面设计

### 9.1 主页

横屏初始视口内完成所有主要操作：

- 左上账号条：头像、昵称、段位、`ID 1234`，点击 ID 可复制。
- 右上好友入口：文字“好友”加待处理数量角标。
- 中央主入口：一张紧凑横向的深翡翠色“排位赛”赛券，左侧配麻将字牌，说明“单人开始，也可邀请好友组队”。
- 下方次级操作采用非对称结构：好友房使用较大的米纸色入口，人机练习和输入房号在右侧窄列叠放；不使用三个同权等宽卡片。
- “允许机器人补位”不再出现在主页。

好友管理使用横屏右侧抽屉：

- 使用带“友”字麻将牌的茶馆标题、暖色纸纹、方圆头像和玉绿色主操作，形成可爱但克制的卡通风格。
- 收到的申请、好友列表、发出的申请和精确 ID 添加在同一可滚动名册中展示。
- 空态给出自己的 4 位 ID 和添加说明，并使用字牌插画而不是单行占位文案。
- 邀请模式复用同一好友行，但主操作变为“邀请”。

### 9.2 排位等待房

- 继续使用四座牌桌空间关系，不重做牌桌视觉。
- 中央面板只展示成员数、状态及开始或取消匹配；机器人补位勾选放在桌面左上边缘，避免与中央内容重叠。
- 顶部离开、音效、复制房号、邀请、分享和解散操作使用统一尺寸与中性色表面，危险操作只以低饱和陶红色区分。
- 空座点击打开好友邀请面板。
- 房主只有开始按钮；非房主只有准备或取消准备。
- 排队中锁定邀请与勾选项，并展示等待秒数和当前段位范围。

### 9.3 玩家资料

扩展现有 `PlayerProfileModal`：

- 昵称下展示 `ID 1234`，点击复制。
- 真人非自己根据关系显示“添加好友”“申请已发送”“接受好友”或“已是好友”。
- 机器人不显示 ID 和好友按钮。
- 好友管理入口中的删除好友是低优先级危险操作，调用系统确认框后执行。

### 9.4 状态与动效

- 页面载入使用与最终行高一致的骨架块，不使用全局转圈。
- 空列表、搜索无结果和网络错误均在所属面板内展示。
- 按钮保留 `scale(0.97)` 按压反馈。
- 弹层淡入与上移只用于层级切换，遵守 `prefers-reduced-motion` 时关闭动画。
- 不使用滚动监听、无限循环装饰或新图片素材。

## 10. 兼容、上线与回滚

- 协议字段采用可归一化的新增字段；小程序边界对旧服务端缺失 `playerId` 归一为 `null`。
- 服务端先上线，旧小程序继续工作；新小程序在没有社交 API 时显示可重试错误，不影响普通房间和牌局。
- `MATCHMAKING_BOTS_ENABLED=false` 时仍显示或隐藏现有机器人选项，服务端忽略 `allowBots`。
- SQLite 迁移必须在备份副本和内存数据库测试，确认表重建保留队列行、版本、party 信息和 allow_bots。
- 回滚应用代码时新增表和列可保留；旧代码会忽略它们。不要在回滚中删除好友数据。
