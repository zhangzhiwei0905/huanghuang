# 设计：排位续局丢失队伍修复

## 方案取舍（需要你确认）

考虑过两种方案：

**方案A（推荐，本设计采用）：续局把玩家带回原队伍的预备房间，沿用现成的组队排队 UI**
- 组队排位匹配成功前的"预备房间"（`mode: TEAM_MATCH`）在匹配成功后依然存在（不会被销毁），只是当前代码没有利用它。
- 结算后点"继续游戏"：如果这局是组队来源，就把玩家 `reLaunch` 回原预备房间（同一个房间码），而不是调用单人续局接口。回到预备房间后，走的是**现成已经上线、测试过的组队排位 UI**——成员重新"准备"，房主再次点击"开始匹配"。
- 代价：不是纯一键无感继续，队伍需要重新走一遍"准备+房主开始匹配"（通常几秒内），但没有新的踩坑风险（不引入"部分队友没点继续导致永久卡住排队"这类新边界情况），复用度高、改动面小。

**方案B（更順滑但复杂、有新风险，不建议现在做）**：点"继续游戏"后台自动把原队伍重新整体加入排位队列，无需手动准备/房主再点。问题在于原队伍人数是"记录在案的固定值"，但"继续游戏"是每个客户端各自独立点击的动作——如果队伍原来3人、只有2人点了继续，系统要么永远凑不齐（软死锁），要么需要更复杂的"允许部分队友确认+超时改用当前已确认人数"的协调逻辑，改动和测试成本明显更高。

**本任务采用方案A**。如果你更倾向于方案B（一键自动续局，愿意接受更复杂的实现和更多测试），告诉我，我会重新设计这部分。

## 改动范围（方案A）

### 数据库：`apps/server/src/database.ts`

- 沿用现有 `ALTER TABLE ... ADD COLUMN` 迁移模式（参考约450-458行已有先例），新增：
  - `ALTER TABLE competitive_matches ADD COLUMN origin_party_id TEXT`（可空，null 表示非组队来源，即当前所有历史对局的默认值）。
- `createCompetitiveMatch`/`createCompetitiveMatchWithBots`（约1465、1551行）的输入类型增加可选 `originPartyId?: string | null`，写入新列。
- 读取对局详情的地方（结算查询、`getCurrentCompetitiveMatch` 等）需要一并把 `originPartyId` 带出来，供 room-service 组装到房间投影里。

### `apps/server/src/room-service.ts`

- `createCompetitiveMatch(sessions, entries)`（约1254行）：从 `entries` 中取 `entry.partyId`（多个人应该共享同一个 partyId，取任意一个非空值即可；纯单人排位撮合出的桌子 `partyId` 全部为 null）作为 `originPartyId` 传给 `database.createCompetitiveMatch`。
- `createCompetitiveMatchWithBots`（约1341行）同理，从 `humanEntries` 里取。
- `room.competitiveMatch` 投影结构（当前是 `{ matchId, ruleVersion }`）增加 `originRoomCode: string | null` 字段（不直接暴露内部 partyId，而是解析成预备房间的房间码，方便前端直接跳转）——通过 `origin_party_id` 查 `rooms.getRoomById()` 拿到 `code`；如果原房间已不存在，给 `null`。

### `packages/protocol/src/competitive.ts`

- `CompetitiveMatchRef`（或对应的类型，具体名字以现有类型为准）增加 `originRoomCode: string | null` 字段，前后端共享类型同步更新。

### 前端 `apps/miniprogram/src/pages/room/index.tsx`

- `continueCompetitiveMatch()`（约668-690行）改为：
  - 读取 `room?.competitiveMatch?.originRoomCode`（或结算数据里的等价字段，settlement 页面用的是 `roomCtrl.lastSettlement`，需要确认该结构是否也带上了这个字段，若没有需要一并补上）。
  - 若 `originRoomCode` 非空：不调用 `competitiveApi.queue`，改为 `Taro.reLaunch` 跳转回该房间码对应的房间页（`/pages/room/index`，带上目标房间码，具体传参方式参照现有"加入房间"跳转逻辑）。跳转后由房间页现成的组队准备/开始匹配 UI 接管。
  - 若 `originRoomCode` 为空（含"原房间已解散"的情况）：保持现有单人续局行为不变（回退路径，避免卡死）。
- 需要确认玩家跳转回预备房间时，房间页要能正确识别"我曾经是房主/成员"并展示对应的准备/开始匹配入口——如果房间的 `ownerSessionId`、`seats` 在匹配发生后没有被清空/复用，这部分大概率不需要额外改动，但需要在实现时用真实数据验证一次。

## 风险与测试要点

- 老数据（改动前创建的 `competitive_matches` 行）`origin_party_id` 全部是 `null`，历史对局续局行为不变，兼容安全。
- 需要测试：原预备房间仍存在时，续局正确跳转且能重新发起组队匹配；原预备房间已被解散/超时清理时，正确回退到单人续局而不是报错卡死；单人排位续局行为完全不受影响。
- 是否要给"回到预备房间"配一个提示文案（比如"队伍已重新集合，请准备后开始匹配"），实现时可以顺手加，不是强制项。
