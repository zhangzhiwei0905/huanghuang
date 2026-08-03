# 技术设计：签到活动与道具体系

对应 PRD：`prd.md`（R1–R5 / AC1–AC7）

## 架构总览

```
客户端(Taro)                      服务端(Fastify + sqlite)
┌──────────────────┐   HTTP    ┌─────────────────────────────┐
│ pages/checkin    │◄─────────►│ /api/checkin/status|sign     │
│ pages/backpack   │           │ /api/items/use-rank-protection│
│ 房间页加倍弹窗    │◄─room────►│ RoomService                  │
└──────────────────┘  socket   │  ├ 加倍决策门(新)             │
                               │  └ competitiveTerminalSettlement│
                               │ competitive-rank.ts(engine)   │
                               │ database.ts(新表+新列)        │
                               └─────────────────────────────┘
```

## 1. 数据模型（apps/server/src/database.ts）

### 1.1 签到表（新）

```sql
CREATE TABLE check_in_records (
  session_id TEXT NOT NULL,
  week_start TEXT NOT NULL,          -- 北京时间该周周一日期 'YYYY-MM-DD'
  signed_dates TEXT NOT NULL,        -- JSON 数组：本周已签到的北京日期 'YYYY-MM-DD'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, week_start)
);
```

- 累计天数 = `signed_dates.length`；里程碑按天数自动发放（发放动作在 sign 接口内完成，无需单独 claimed 位——重复签到被日期去重挡住）。
- 每周新行；旧周行保留（可做历史查询，量小），查询只取当前周。

### 1.2 competitive_profiles 新列

```sql
ALTER TABLE competitive_profiles ADD COLUMN win_double_cards INTEGER NOT NULL DEFAULT 0 CHECK (win_double_cards >= 0);
ALTER TABLE competitive_profiles ADD COLUMN rank_protection_cards INTEGER NOT NULL DEFAULT 0 CHECK (rank_protection_cards >= 0);
ALTER TABLE competitive_profiles ADD COLUMN rank_protection_active_until TEXT;  -- ISO 时间，null=未生效
```

迁移方式与现有风格一致：建表时写入新列 + 启动时对旧库 `ALTER TABLE`（参考现有 migration 处理；若无现成机制，用 `PRAGMA table_info` 判断后补列，幂等）。

### 1.3 competitive_match_players 审计列

```sql
ADD COLUMN win_double_card_used INTEGER;      -- 0/1/null
ADD COLUMN rank_protection_applied INTEGER;   -- 0/1/null
```

`saveCompetitiveSettlement` 的前置校验与写入同步扩展。

## 2. 引擎（packages/game-engine/src/competitive-rank.ts）

`CompetitiveRankOutcome` 扩展：

- `WIN`：新增 `doubleCard?: boolean` → `appliedDelta = magnitude * (doubleCard ? 2 : 1)`，`rawDelta` 同步 ×2。
- `LOSS`：新增 `protectionHalved?: boolean` → 在保星卡抵扣**之前** `magnitude = Math.floor(magnitude / 2)`；免疫段位逻辑不变（优先不扣不耗）。

`CompetitiveRankTransition` 新增只读字段：`winDoubleCardUsed: boolean`、`rankProtectionApplied: boolean`（供结算投影与审计）。纯函数改造，全部用单元测试覆盖（含 1 星减半为 0、减半后再抵卡、免疫优先）。

## 3. 服务端

### 3.1 签到与道具接口（新文件 apps/server/src/checkin-service.ts）

- `getCheckInStatus(session)`：计算北京时间当前周周一 key、已签日期、今日是否已签、里程碑清单（含每项已达成状态）。
- `sign(session)`（幂等）：
  1. `assertWechatLinked`；
  2. 今日北京日期已在 `signed_dates` → 直接返回当前状态（无新奖励）；
  3. 追加今日 → 天数 n → 对里程碑表 `CHECKIN_REWARDS[n]` 发放（保星卡→protection_cards、加倍卡→win_double_cards、保护卡→rank_protection_cards）；
  4. 单事务写回，返回 `{ status, granted: [{ day, item, amount }] }` 供客户端弹说明。
- `useRankProtection(session)`：`rank_protection_cards -1`；`activeUntil = max(now, 现值) + 2h`；返回新的到期时间。

北京时间工具：`beijingDate(now): string`、`beijingWeekStart(now): string`（UTC+8 偏移纯函数，放 checkin-service 或 lib，单测覆盖跨周一边界）。

里程碑奖励表常量 `CHECKIN_MILESTONES: { day, item: 'PROTECTION'|'WIN_DOUBLE'|'RANK_PROTECTION', amount }[]` 同时被服务端与 protocol 类型引用，客户端渲染同一份定义。

### 3.2 胡牌加倍卡决策门（apps/server/src/room-service.ts）

现状：回合特效转场完成（`commitAcceptedRule` / tick 两条路径）→ 立即 `competitiveTerminalSettlement` + `saveAcceptedTransition`。

改造：

- `RoomState` 新增 `doubleDecision: { sessionId: Seat对应session; deadlineAt: string } | null`（PersistedRoomState 同步 + normalize 兜底 null）。
- 转场完成时判定：若结算将是 WIN 且赢家 `win_double_cards >= 1` → 不立即结算，置 `doubleDecision = { sessionId, deadlineAt: now + 10s }`，`room.version += 1` 并 save；stage 保持 ROUND_RESULT，但 `roundSettlement` 投影为 null。
- 新协议命令（packages/protocol）：`CONFIRM_DOUBLE_CARD { use: boolean }`；execute 分发仅接受 `doubleDecision.sessionId` 本人、且在 deadline 内；用卡时 `win_double_cards -1`（在结算提交同事务内扣，防竞态）。
- tick：`doubleDecision !== null && deadline 到期` → 按 `use=false` 结算。
- `competitiveTerminalSettlement` 接收决策结果：赢家 WIN outcome 附 `doubleCard: use`；所有 LOSS 附 `protectionHalved = profile.rankProtectionActiveUntil > settledAt`。
- 结算提交后清空 `doubleDecision`。

### 3.3 HTTP 路由（apps/server/src/index.ts）

- `GET /api/checkin/status`、`POST /api/checkin/sign`
- `POST /api/items/use-rank-protection`
- `GET /api/competitive/profile` 的返回（`SelfCompetitiveProfile`）扩展 `winDoubleCards`、`rankProtectionCards`、`rankProtectionActiveUntil`。

## 4. 协议（packages/protocol）

- `RoomProjection`：新增 `doubleDecision: { deadlineAt: string; isSelf: boolean } | null`。
- `RoundSettlementProjection` / `CompetitiveSettlementProjection.self`：新增 `winDoubleCardUsed`、`rankProtectionApplied`（赢家与输家各自相关字段）。
- `GameCommand` 联合类型 + `CONFIRM_DOUBLE_CARD`。
- 签到/道具相关 DTO：`CheckInStatusProjection`、`CheckInSignResult`、`CheckInMilestone`。

## 5. 客户端（apps/miniprogram）

### 5.1 新页面

- `pages/checkin`：7 格签到条（每日奖励图标+数量）+ 签到按钮（今日已签置灰）；签到成功若有 `granted` → 弹「道具说明」弹窗（道具名、效果、使用方式文案）。
- `pages/backpack`：三张道具卡（图标用 `apps/miniprogram/src/assets/cards/` 下的 保星卡.png / 加倍卡.png / 排位保护卡.png，原图约 1.7MB/张，需先压缩到 ≤200KB/张再入库，避免突破小程序包体限制）、名称、剩余数量、效果说明；排位保护卡卡片带「使用」按钮与「生效中 · 剩余 HH:MM:SS」倒计时（目标时间驱动，复用 remainingSecondsUntilTarget 思路）；保星卡/加倍卡标注自动生效场景。
- 入口：首页加「签到」入口按钮；玩家信息面板（PlayerProfileModal）加「背包」入口。
- app.config.ts 注册新页面路由。

### 5.2 房间内加倍弹窗

- `useRoom` 投影带出 `doubleDecision`；`doubleDecision.isSelf === true` 时渲染限时弹窗（deadline 目标时间驱动倒计时，10s）：「使用胡牌加倍卡（剩 N 张）」/「不使用」→ `roomCtrl.send("CONFIRM_DOUBLE_CARD", { use })`；超时自动消失（服务端已按不用结算，下一版本投影带出结算）。
- 非赢家且 `doubleDecision !== null`：显示轻量等待提示「等待赢家选择道具…」。

### 5.3 结算弹窗与文案

- `RoundSettlementModal`：「保护卡」→「保星卡」；新增「胡牌加倍 ×2」与「排位保护生效 · 扣星减半」展示行；`RoundOutcomePanel` 等其余出现处同步改名。

## 6. 兼容性与回滚

- 新列有默认值，旧房间快照 normalize 时 `doubleDecision ??= null`；旧结算行审计列允许 null。
- 回滚：服务端回滚镜像即可——新列/新表对旧代码无害（旧代码不读）；加倍决策门随旧代码消失，行为退回现状。
- 图片资源：云存储 mp3 不涉及；道具图片已提供于 `apps/miniprogram/src/assets/cards/`（保星卡.png/加倍卡.png/排位保护卡.png），需压缩后使用。

## 7. 测试要点

- engine：加倍/减半/叠加顺序/免疫优先（competitive-rank.test.ts 扩展）。
- server：北京时间周边界与幂等签到、里程碑单次发放、保护卡叠加时长、加倍决策门（用卡/不用/超时/非本人命令拒绝）、结算审计列、DB 迁移幂等。
- client：签到里程碑映射、背包倒计时、加倍弹窗触发条件（如现有 roomTransitions 风格的纯函数测试）。
