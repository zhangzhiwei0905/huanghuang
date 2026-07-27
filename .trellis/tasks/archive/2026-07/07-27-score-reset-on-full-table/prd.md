# 4人满座积分清零重算

父任务：`07-27-laiyou-and-score-reset`

## Goal

好友房先用机器人补位开局练手，等真人陆续进来把机器人全部顶替掉之后，正式局的积分从零开始计算，机器人时期的历史局分不计入正式战绩。

## 背景事实（已核对代码）

- 「创建玩家房间后先加机器人玩」对应的真实流程是 `FRIEND` 模式房间 + 房主 `addBot` 补空位，不是 `BOT` 模式房间（`BOT` 模式 `joinRoom` 直接返回 `ROOM_NOT_JOINABLE`）。
- 真人在牌局进行中加入 `FRIEND` 房只能成为 `spectators`；`enterWaiting()` 在回到等待阶段时把旁观者逐个顶替 `BOT` 座位（`apps/server/src/room-service.ts`）。
- 累计积分存在 `RoomState.scores`，`startRound()` 把它作为 `startingScores` 透传给 `createRound()`，`syncRoundResult()` 在局末回写。目前没有任何清零逻辑。
- `FRIEND` 房开局条件在 `setReady()`：四座全部非 `EMPTY` 且所有真人都已 ready，立即 `startRound()`。

## Requirements

- R1. 某局开局时四个座位全部是真人，且本房间还没做过清零，就把四个座位的累计积分清零，然后以 0 分开始新的一局。
- R2. 清零是**房间级一次性**行为。之后的纯真人连续对局继续累计；玩家掉线被机器人顶替、再重连回座位导致四座重新全真人，也不再清零，掉线前的积分继续有效。想要全新账本只能重新创建房间。
- R3. 清零必须由服务端决定并落到投影，客户端不得自行判断或本地清零。
- R4. 等待阶段需要让玩家知道「下一局开局时积分会重新计算」，Web 与小程序两端提示语义一致。
- R5. 历史房间快照（不含新字段）必须能正常反序列化，新字段有兼容默认值。

## 非目标

- 不改动 `FRIEND` / `BOT` 房间模式语义，不新增房间模式。
- 不改动 `addBot` / `removeBot` / `joinRoom` / `enterWaiting` 的座位分配规则。
- 不做历史战绩留档或「机器人局」单独统计。

## Acceptance Criteria

- [ ] AC1. 机器人补位的好友房打完至少一局后，真人顶替掉所有机器人并全部 ready，新一局 `startingScores` 为 `{0:0,1:0,2:0,3:0}`，`room.scores` 同步归零。
- [ ] AC2. 四真人房连续两局，第二局的 `startingScores` 等于第一局结束时的累计分（不清零）。现有测试 `returns a completed friend round to waiting and keeps seats and scores` 保持通过。
- [ ] AC3. `BOT` 模式房 `continueBotRound` 仍然保留累计分。现有测试 `waits for bot confirmation and keeps cumulative scores...` 保持通过。
- [ ] AC4. 投影新增字段能表达「下一局将清零」，Web 与小程序等待房都渲染对应提示。
- [ ] AC5. 缺少新字段的持久化快照经 `normalizeRoom` 后得到合理默认值，且不会误触发清零。
- [ ] AC7. 清零完成后，玩家离座（机器人顶替）→ 打完若干局 → 玩家重连入座 → 四人准备，新一局的 `startingScores` 等于掉线期间累计的分数，不再清零。
- [ ] AC6. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。

## Notes

- 与 `07-27-laiyou-gameplay` 共同接触 `apps/server/src/room-service.ts` 的 `project()` 与 `packages/protocol/src/projections.ts`。两者唯一的硬耦合是 `RoomProjection.schemaVersion`：本任务先执行，把 6 提升到 7；来由任务随后提升到 8。
