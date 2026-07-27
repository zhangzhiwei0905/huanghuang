# 设计：4人满座积分清零重算

## 方案选择

清零的触发点有三个候选：

| 候选 | 说明 | 取舍 |
|---|---|---|
| A. `setReady()` 最后一个 ready 分支 | 语义最贴近「准备好之后」 | 只覆盖好友房手动 ready 这一条路径，`tick`/其它未来入口会漏 |
| B. `startRound()` 开头 | 所有开局路径的唯一收口 | 选中。`setReady` / `continueBotRound` / `createRoom(BOT)` 全部经过这里 |
| C. `enterWaiting()` 顶替机器人时 | 顶替即清零 | 过早：顶替后可能有人离座又变成机器人，会出现清零后仍与机器人同局 |

选 B。`startRound()` 是唯一给 `createRound` 传 `startingScores` 的地方，把「清零」和「记录本局是否有机器人」这两件事放在同一个收口，语义闭合，不会漏路径。

## 状态字段

`RoomState` 新增：

```ts
scoresIncludeBotRounds: boolean;
```

含义：当前 `room.scores` 里是否累计过「至少一个座位不是真人」的局。它是清零的必要条件，也是清零后要复位的标记。

`startRound()` 在创建新局前按顺序做两件事：

```ts
const allHuman = SEATS.every((seat) => room.seats[seat].controller === "HUMAN");
if (allHuman && room.scoresIncludeBotRounds) {
  room.scores = { ...ZERO_SCORES };
  room.scoresIncludeBotRounds = false;
}
room.scoresIncludeBotRounds = room.scoresIncludeBotRounds || !allHuman;
room.round = createRound({ ..., startingScores: room.scores });
```

- 纯真人连续局：`scoresIncludeBotRounds` 一直是 `false`，不清零，满足 R2 / AC2。
- `BOT` 模式房：每局都有机器人，标记恒为 `true`，`continueBotRound` 不清零，满足 AC3。
- 机器人局 → 真人满座：第一局把标记置 `true`，顶替后满座开局时清零并复位，之后回到纯真人累计，满足 R1 / AC1。

`EMPTY` 座位不可能进入 `startRound`（开局条件要求四座非 `EMPTY`），因此判定只需要区分 `HUMAN` 与 `BOT`。

## 投影

`RoomProjection` 新增：

```ts
scoreResetPending: boolean;
```

计算式：`room.scoresIncludeBotRounds && SEATS.every((seat) => room.seats[seat].controller === "HUMAN")`。

语义是「下一局开局时会清零」，为真的前提是牌桌已经全真人。客户端只读这个布尔量渲染提示，不做任何座位或分数推导，满足 R3。

`schemaVersion` 由 `6` 提升到 `7`。字段是纯新增，旧客户端忽略即可。

## 持久化兼容

`PersistedRoomState` 新增可选字段 `scoresIncludeBotRounds?: boolean`。`normalizeRoom()` 的两个分支都要给默认值：

```ts
scoresIncludeBotRounds:
  persisted.scoresIncludeBotRounds ??
  SEATS.some((seat) => persisted.seats[seat].controller === "BOT"),
```

对旧快照做保守推断：当前坐着机器人的房间视为「积分含机器人局」，将来满座后清零；已经全真人的旧房间视为 `false`，不会凭空清掉玩家已有积分（满足 R5 / AC5）。legacy `waitingHumans` 分支重建座位时没有机器人，取 `false`。

## 客户端

两端都在等待阶段渲染提示，文案统一为「四人满座开局后积分将重新计算」。

- Web：`apps/web/src/components/GameTable.tsx` 等待视图（`waiting-list` 附近）。
- 小程序：`apps/miniprogram/src/pages/room/index.tsx` 的 `lobby-stage` 区块。

纯展示，无本地状态，符合 `frontend/state-management.md` 里「`lobbySeats` 是唯一等待房座位来源、客户端只做投影派生」的约定。

## 已知副作用：中途掉线被机器人顶替

标记在**开局时刻**计算（`!allHuman`），不是局末。这带来一个需求文字没描述的分支：

四真人房打了几局（标记 `false`，积分累计），某人 `leaveRoom` 后座位被 `botSeat()` 顶替，接着又开了一局 → 该局开局时有机器人 → 标记变 `true`。之后新真人补进来满座准备，会把**包括之前纯真人局在内的全部积分**清零。

这与父任务确认的「清零重新开始计分」是一致的（该口径本身就是整体清零，不做分局拆分），但它的触发场景比"先带机器人练手"更宽。如果希望掉线顶替不触发清零，需要把标记的语义从「本局有机器人」改成「本局是机器人练手局」，那需要额外区分 `addBot` 补位与 `leaveRoom` 顶替，属于新的需求决策。

## 风险

- 唯一的行为回归风险是误清零纯真人房积分。由 AC2 / AC3 的既有测试守住。
- `scoresIncludeBotRounds` 是新的持久化字段，写入 `save(room)` 的 JSON。`database.ts` 存的是整体 JSON，不需要 schema 迁移。
