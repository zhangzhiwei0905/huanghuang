# 房间准备与人机入口流程优化：技术设计

## 1. 设计目标

把当前“好友等待区叠加在机器人牌局上”的混合模型拆成两条互不渗透的流程：

1. `FRIEND` 好友房：四个固定真人座位，`WAITING → PLAYING → ROUND_RESULT → WAITING`。
2. `BOT` 人机对战：一位真人和三位机器人，`PLAYING → ROUND_RESULT → 玩家确认后 PLAYING`。

麻将规则引擎保持不变；本任务只调整房间生命周期、协议投影、API 和界面状态。

## 2. 当前问题与边界

- `apps/server/src/room-service.ts` 的 `createRoom` 总是立即创建一局并补三名机器人，导致“好友房等待”和“人机局”共享同一状态。
- `waitingHumans` 与 `seats` 同时表达房内真人，加入者没有真正占据固定座位。
- `tick` 在 `ROUND_OVER` 后固定调用 `startNextRound`，无法支持好友房重新准备或人机玩家确认。
- `RoomProjection` 缺少房间模式、房间阶段和四座等待投影；前端只能通过 `selfSeat === null` 猜测是否在等待。
- `PlayerStation` 已通过 `is-active` 边框及中央名称展示当前玩家，本次在同一组件增加箭头，不另建第二套回合判断。

## 3. 服务端领域模型

### 3.1 房间模式与阶段

在协议和服务端定义唯一枚举：

```ts
type RoomMode = "FRIEND" | "BOT";
type RoomStage = "WAITING" | "PLAYING" | "ROUND_RESULT";
```

- `FRIEND` 新房间从 `WAITING` 开始，不创建 `RoundState`，不设置动作截止时间，也不运行机器人。
- `BOT` 新房间直接从 `PLAYING` 开始，座位 0 为真人，其余三座为机器人。
- `ROUND_RESULT` 仍持有已完成的 `RoundState`，用于权威结算投影。

### 3.2 固定座位与房间积分

重构 `RoomState`：

- `mode: RoomMode`
- `stage: RoomStage`
- `seats: Record<Seat, SeatController>`，内部控制器允许 `EMPTY`，好友加入时直接占据第一个空座。
- 删除 `waitingHumans`；所有真人归属都由固定座位表达。
- `readySessionIds: string[]` 仅在 `FRIEND + WAITING` 有效。
- `scores: Record<Seat, number>` 保存跨局累计积分；新会话初始化为 0。
- `nextDealerSeat: Seat` 保存下一局庄家；首局随机，结算后取规则引擎的 `outcome.nextDealerSeat`。
- `round: RoundState | null`；仅 `PLAYING`/`ROUND_RESULT` 非空。
- `roundStartedAt: string | null` 为客户端开局提示提供服务端时间锚点。

进入 `ROUND_RESULT` 后从完成局同步 `scores` 和 `nextDealerSeat`。创建下一局统一调用一个 `startRound(room)`，使用房间级累计积分，避免好友局和人机局各写一套发牌逻辑。

### 3.3 生命周期转换

#### 好友房

```text
创建/加入
  → WAITING（占固定座位、各自准备）
  → 四座均为真人且四人全部准备
  → PLAYING（清空准备状态、服务端发牌、记录 roundStartedAt）
  → ROUND_RESULT（保留现有约 4 秒结算展示）
  → dissolveAfterRound ? CLOSED : WAITING（保留座位与累计积分、清空准备）
```

`setReady` 必须幂等：重复准备不重复加版本、不重复发牌；只有 `FRIEND + WAITING` 且调用者占座时有效。最后一位玩家准备触发一次原子开局。

#### 人机对战

```text
主页点击人机对战
  → PLAYING
  → ROUND_RESULT
  → 玩家点击继续：PLAYING（保留累计积分）
  → 玩家点击退出：CLOSED / 返回主页
```

人机结算不设置自动续局时间。新增显式继续操作，只允许该房间唯一真人且必须处于 `BOT + ROUND_RESULT`；服务端再次校验阶段，防止双击产生两局。

### 3.4 离开、解散与断线

- 好友房等待阶段：玩家主动离开后座位变空并移除准备状态；房主离开仍按既有规则随机转让给其他真人，无人时关闭房间。
- 好友局进行中：保留既有机器人/托管接管当前局的行为；该局结束回到等待房后，已主动离开的座位显示为空，机器人不作为下一局好友房成员。
- 好友房等待阶段房主解散可立即关闭；进行中仍设置 `dissolveAfterRound`。
- 人机模式不允许加入；退出即关闭该单人房间。
- 断线不等于离房：`PLAYING` 中转托管，`WAITING` 中保留座位和准备状态并标记离线；原匿名会话重连恢复。

## 4. API 与协议契约

### 4.1 创建与加入

扩展 `createRoomSchema`：

```ts
{ nickname, baseScore, mode: "FRIEND" | "BOT" }
```

- 主页“创建房间”发送 `FRIEND`。
- 主页“人机对战”发送 `BOT`。
- `joinRoom` 只接受 `FRIEND` 且存在空座的房间；人机房返回不可加入，满员好友房返回 `ROOM_FULL`。

### 4.2 准备与继续

- 保留 `POST /api/rooms/:code/ready`，只处理好友等待房。
- 新增 `POST /api/rooms/:code/continue`，只处理人机结算阶段。
- 两个接口均返回最新 `RoomProjection` 并通过现有 `room:update` 通知其他订阅者。

### 4.3 投影

`RoomProjection` 新增：

- `mode: RoomMode`
- `stage: RoomStage`
- `roundId: string | null`
- `roundStartedAt: string | null`
- `actingSeat: Seat | null`，专门表示当前需要行动或响应的座位；既有 `currentSeat` 继续表示规则引擎的当前回合座位，供弃牌响应牌推导使用。
- `lobbySeats: { seat, nickname, occupied, ready, connected, isOwner, isSelf, score }[]`

等待阶段返回 `roundId = null`、`players = []`、无牌墙/亮牌/合法动作。牌桌只在 `PLAYING` 或 `ROUND_RESULT` 消费 `players`。前端不得再用 `selfSeat === null` 推断等待状态，因为好友房玩家在等待时已经拥有座位。

## 5. 前端信息架构

### 5.1 主页

- 保留昵称和底分选择逻辑。
- 增加与“创建房间”“加入房间”同级的“人机对战”入口。
- 创建好友房按钮改为“创建房间”，不再使用“创建并开局”。
- 人机模式进入牌桌后隐藏房间码分享/邀请能力。

### 5.2 好友等待房

- `GameTable` 根据 `room.stage === "WAITING"` 渲染等待房，不再按 `selfSeat` 分支。
- 固定渲染东南西北四个座位：昵称、房主标记、自己标记、在线状态、累计积分、准备状态；空位显示“等待加入”。
- 所有已占座玩家都可准备；准备后按钮禁用并显示“已准备，等待其他玩家”。
- 结算展示结束后服务端投影切回 `WAITING`，页面自然回到同一等待房。

### 5.3 开局提示与回合箭头

- 客户端根据新的 `roundId/roundStartedAt` 显示一次短暂“本局开始”覆盖提示，不阻断牌桌操作，并遵循低调/精美主题现有视觉约束。
- `PlayerStation` 继续使用传入的 `active` 作为唯一判断；该值来自服务端 `actingSeat`，激活时渲染 CSS 箭头并提供 `aria-label`。
- 上、下、左、右四个相对方位分别调整箭头方向和位置，使箭头指向对应玩家信息区；`currentSeat === null` 时不渲染。

### 5.4 结算动作

- 好友房结算弹框显示“即将返回房间准备”，保持现有短暂展示后由服务端切换等待阶段。
- 人机结算弹框提供“继续游戏”和“退出到主页”两个明确按钮；未选择前停留在结算阶段。

## 6. 持久化与兼容

SQLite 表结构不变，继续保存 JSON 房间快照。构造 `RoomService` 时集中执行旧快照归一化：

- 旧的一真人三机器人、无等待者房间归为 `BOT`，保留当前牌局。
- 旧的四真人房间归为 `FRIEND`，按当前局阶段恢复。
- 旧的混合机器人牌局且存在等待真人时归为 `FRIEND + WAITING`：终止旧机器人过渡局，将房内真人依加入顺序放入固定座位，并从等待状态重新准备。
- 新字段提供安全默认值；归一化后立即使用新结构，业务代码不继续兼容两套字段。

## 7. 风险与回滚

- 最大风险是 `round` 可空后遗漏旧代码直接访问。通过 TypeScript 收窄、集中阶段守卫和全量 typecheck 解决，不使用非空断言掩盖。
- 第二风险是局终计分复制时机错误。新增跨局累计测试，分别覆盖自摸、流局、杠分、人机继续和好友回房。
- 第三风险是重复准备或继续导致双开局。服务端阶段检查和幂等测试作为合并门槛。
- 部署仍使用现有 JSON/SQLite；若线上异常，可回滚应用镜像。旧版无法理解新快照，因此部署前保留数据库卷备份，回滚时同步恢复备份。
