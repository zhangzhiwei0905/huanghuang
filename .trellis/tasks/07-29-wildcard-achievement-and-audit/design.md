# 设计：放赖成就与碰亮牌归属排查

## 边界与契约

- `publicCompetitiveProfileSchema.achievements`（`packages/protocol/src/competitive.ts`）新增字段是**向后兼容的加法变更**：旧客户端忽略新字段，新客户端处理旧数据时需对新字段做默认值兜底（现有 `competitive_profiles` 行经 ALTER 后新列默认值为 0）
- `competitive_action_events` 表结构不变，只是 CHECK 约束的合法值集合扩大

## 放赖成就数据流

1. `room-service.ts:332-346` `competitiveAchievementAction`：`RELEASE_WILDCARD` 分支从 `return null` 改为 `return action`（即 `"RELEASE_WILDCARD"`）
2. `database.ts` 改动：
   - `competitive_profiles` 表加列 `release_wildcard_count INTEGER NOT NULL DEFAULT 0 CHECK (release_wildcard_count >= 0)`（ALTER 增量模式，`database.ts:319-336` 旁新增一段）
   - `competitive_action_events` 的 CHECK 约束 `action IN (...)` 加入 `'RELEASE_WILDCARD'`
   - `counterColumn` 映射（`database.ts:1181-1195`）加 `RELEASE_WILDCARD: "release_wildcard_count"`
   - `getPublicCompetitiveProfiles` / `getCompetitiveProfile` 的 SELECT 列表加 `release_wildcard_count AS releaseWildcardCount`
3. `packages/protocol/src/competitive.ts`：`competitiveAchievementActionSchema` 枚举加 `RELEASE_WILDCARD`；`competitiveAchievementTotalsSchema` 加 `releaseWildcard: z.number().int().nonnegative()`
4. `room-service.ts:293` 附近的 profile 投影函数补充 `releaseWildcard: profile.releaseWildcardCount`
5. `PlayerProfileModal.tsx:92-109`：新增一行"放赖"放在最前面，读取 `competitiveProfile.achievements.releaseWildcard`

## 碰亮牌归属排查设计

**先写复现测试，后定位，后修复** —— 不允许跳过复现直接改代码。

### 复现测试设计

在 `apps/server/src/room-service.test.ts` 或 `competitive-database.test.ts` 新增集成测试：

1. 用 `createCompetitiveMatchWithBots` 建一个真人 + 3 bot 的 MATCH 房（复用现有测试 helper）
2. 通过牌局构造手段（直接操纵 `RoundState` 或驱动到能触发 `CLAIM_INDICATOR_PONG_KONG` 的局面）让真人打出与 `indicatorTile` 同花色点数的牌，bot 座位手里有 2 张同款
3. 驱动 bot 认领 `CLAIM_INDICATOR_PONG_KONG`
4. 查询 `competitive_action_events` 表该 `INDICATOR_PONG_KONG` 事件行的 `session_id`，断言等于 bot 的 session id（不是真人）

### 定位路径（按测试结果分支）

- **若测试红**（真人的 session_id 被记录）：
  1. 检查 `createCompetitiveMatchWithBots` 的座位分配（`room-service.ts` 中 `rankedBotSeat` 与洗牌逻辑）是否与 `competitive_match_players` 写入顺序一致
  2. 检查 `shuffleCompetitivePlayers` 洗牌后 `room.seats[]` 索引是否和结算/投影使用的座位索引对齐
  3 若发现映射错位，修复座位赋值逻辑，保证 `descriptor.actorSeat` 到 `room.seats[actorSeat].sessionId` 的映射与实际操作者一致
- **若测试绿**（服务端记录正确）：
  1. 结论是服务端无误，问题在客户端展示或用户观测路径（例如看错了 `GET /api/competitive/profile` 返回的是自己的 profile，而不是 bot 的）
  2. 记录复现步骤与结论到任务笔记，不做代码修改，仅保留该测试作为防回归用例
  3. 若怀疑是 `pendingEffectTransition` 期间 `room.round` 过期导致的边界问题，额外构造"特效未落地时又提交一次规则"的场景验证 `detectEffectDescriptor` 是否会 diff 到错误的 round

## 权衡

- 优先信任代码审查（已确认逻辑自洽），但用户的真机观察是一手证据，测试是唯一能裁决二者矛盾的方式
- 不引入"碰亮牌被打出"新成就（这是另一个可选方向，本轮不做，只处理归属正确性）
