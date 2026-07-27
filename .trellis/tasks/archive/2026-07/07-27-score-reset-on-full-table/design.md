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
fullTableScoreResetDone: boolean;
```

含义：本房间是否已经做过那唯一一次满座清零。`createRoom` 初始化为 `false`，只会 `false → true` 单向翻转。

`startRound()` 在创建新局前：

```ts
if (!room.fullTableScoreResetDone && isAllHumanTable(room.seats)) {
  room.scores = { ...ZERO_SCORES };
  room.fullTableScoreResetDone = true;
}
room.round = createRound({ ..., startingScores: room.scores });
```

- 机器人局 → 真人满座：机器人局开局不满足全真人，标记保持 `false`；顶替后满座开局清零并置 `true`，满足 R1 / AC1。
- 纯真人连续局：第一局就把这次清零消耗在一个本来就是 0 的账本上，之后正常累计，满足 R2 / AC2。
- `BOT` 模式房：永远坐着机器人且不能被加入，标记恒为 `false`，`continueBotRound` 不清零，满足 AC3。
- 掉线顶替 → 重连：标记已是 `true`，不再清零，掉线前的积分继续有效。

`EMPTY` 座位不可能进入 `startRound`（开局条件要求四座非 `EMPTY`），因此判定只需要区分 `HUMAN` 与 `BOT`。

## 投影

`RoomProjection` 新增：

```ts
scoreResetPending: boolean;
```

计算式：`!room.fullTableScoreResetDone && isAllHumanTable(room.seats)`。

语义是「下一局开局时会清零」，为真的前提是牌桌已经全真人。客户端只读这个布尔量渲染提示，不做任何座位或分数推导，满足 R3。

`schemaVersion` 由 `6` 提升到 `7`。字段是纯新增，旧客户端忽略即可。

## 持久化兼容

`PersistedRoomState` 新增可选字段 `fullTableScoreResetDone?: boolean`。`normalizeRoom()` 的三个返回分支都要给默认值：

```ts
fullTableScoreResetDone:
  persisted.fullTableScoreResetDone ??
  !SEATS.some((seat) => seats[seat].controller === "BOT"),
```

对旧快照做保守推断：已经全真人的旧房间视为「清零已完成」，不会凭空清掉玩家已有积分；当前坐着机器人的房间视为还欠一次清零，将来满座时补上（满足 R5 / AC5）。legacy `waitingHumans` 分支重建出的座位全是真人且积分归零，直接取 `true`。

## 客户端

两端都在等待阶段渲染提示，文案统一为「四人满座开局后积分将重新计算」。

- Web：`apps/web/src/components/GameTable.tsx` 等待视图（`waiting-list` 附近）。
- 小程序：`apps/miniprogram/src/pages/room/index.tsx` 的 `lobby-stage` 区块。

纯展示，无本地状态，符合 `frontend/state-management.md` 里「`lobbySeats` 是唯一等待房座位来源、客户端只做投影派生」的约定。

## 已确认：清零是房间级一次性行为

标记语义经用户确认为「本房间是否已经做过那唯一一次清零」，不是「本局有没有机器人」。

- 触发：某局开局时四座全是真人，且本房间还没清零过 → 清零并置 `true`。
- 之后永不再触发。玩家掉线被 `botSeat()` 顶替、打完几局、玩家重连回到该座位，四座重新全真人，**不清零**，掉线前的积分继续有效。
- 想要全新的计分账本只能重新创建房间。

早期版本用的是「本局有机器人则重新武装标记」（`scoresIncludeBotRounds = !allHuman`），会让一次掉线顶替导致后续满座把纯真人局的积分也清掉。这是错的，已废弃。

## 风险

- 唯一的行为回归风险是误清零纯真人房积分。由 AC2 / AC3 的既有测试守住。
- `fullTableScoreResetDone` 是新的持久化字段，写入 `save(room)` 的 JSON。`database.ts` 存的是整体 JSON，不需要 schema 迁移。
