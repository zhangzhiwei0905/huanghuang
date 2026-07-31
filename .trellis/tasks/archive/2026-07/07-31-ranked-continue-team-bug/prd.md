# 排位续局丢失队伍修复

## Goal

组队排位对局结算后，点击"继续游戏"会让玩家变回单人排位（原队伍解散），而不是带着原班队伍继续下一局。目标：团队排位结算后点"继续游戏"，应该让原队伍能够方便地再次一起排位，而不是被拆散成单人排位。

## 根因（已确认）

- 前端 `apps/miniprogram/src/pages/room/index.tsx` 的 `continueCompetitiveMatch()`（约第668-690行）不区分对局来源，统一调用 `competitiveApi.queue({ previousMatchId, allowBots })`。
- 服务端 `POST /api/matchmaking/queue`（`apps/server/src/index.ts` 约555-578行）在带 `previousMatchId` 时调用 `matchmaking.continueMatchmaking()`（`matchmaking-service.ts` 约206-223行），该方法**只针对单个 session**，最终调用 `database.acknowledgeAndEnqueueCompetitiveMatch()` 把这一个玩家重新加入**单人**排位队列，不带任何 `partyId`。
- 更根本的是：一旦组队排位成功匹配、进入真正对局房间（`mode: "MATCH"`），该房间与"原队伍是谁"这个信息完全脱钩——`RoomService.createCompetitiveMatch`/`createCompetitiveMatchWithBots`（`room-service.ts` 约1254-1440行）接收的 `MatchmakingEntryRow`（含 `partyId`）只用到了 `entry.version`，`partyId` 没有被写入 `competitive_matches`/`competitive_match_players`（`database.ts` 约1465、1551行）任何一处，对局结算后系统已经"忘记"了这4个人里哪几个原本是一个队。
- 组队排位的"预备房间"（`mode: "TEAM_MATCH"`，即队伍集合、准备匹配的那个房间）在匹配成功后依然独立存在（`matchmaking.cancel()` 里 `rooms.getRoomById(entry.partyId)` 可以找回它），并没有被销毁，只是当前"继续游戏"完全没有利用这一点。

## Requirements

- 组队排位对局结算后，点击"继续游戏"时，原队伍成员应当被带回各自能够重新一起排队的路径，而不是各自单独进入单人排位队列。
- 需要在对局/结算数据里补上"这局是否由某个组队 party 撮合而来"的记录（当前完全没有持久化，需要新增字段），否则服务端在结算后无法判断"这几位曾经是一个队"。
- 单人排位（非组队来源）对局结算后点击"继续游戏"的现有行为不变。
- 如果原队伍的预备房间已经不存在（比如被解散），需要有合理的兜底（退回现有的单人续局行为），不能让玩家卡住无法继续。

## Acceptance Criteria

- [x] 组队排位（1~3人队伍+可能的机器人补位）打完一局后，队伍任一成员点击"继续游戏"，能够回到可以重新一起排队的状态（而不是变成单人排位），队伍无需重新创建房间/重新邀请好友。
- [x] 单人排位对局结算后点击"继续游戏"，行为与现在完全一致（进入单人排位队列）。
- [x] 原队伍预备房间已不存在等异常情况下，不会让玩家卡死，能正常回退到单人续局或返回大厅。
- [x] TypeScript 编译通过，服务端相关单测覆盖"续局识别队伍来源"逻辑。

## Notes

- 复杂任务，涉及数据库 schema 变更（需要新增字段持久化对局的队伍来源）、服务端接口调整、小程序前端续局逻辑分支，需要 `design.md` 明确具体方案后再 `task.py start`。
- 设计方案里对"续局要不要一键自动重新组队"做了权衡取舍，见 `design.md`，需要你过一遍确认是否接受这个取舍。
