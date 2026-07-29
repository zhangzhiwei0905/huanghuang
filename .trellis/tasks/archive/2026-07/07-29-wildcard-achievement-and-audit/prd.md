# 放赖成就与碰亮牌归属排查

父任务：`07-29-five-track-optimizations`。完整分析见 `/Users/zhang/.claude/plans/plan-1-2-federated-bunny.md` 第三节。

## Goal

新增"放赖"成就（游戏核心机制，记录真实排位赛中放出的赖子个数），排在成就展示第一位；同时排查用户实测发现的"碰亮牌"成就疑似归属错误（真人打出亮牌、机器人碰了之后，真人的计数反而 +1）。

## Requirements

### 放赖成就（新增）

- `RELEASE_WILDCARD` 目前被显式排除在成就统计外（`room-service.ts:342` 返回 `null`），且局内的 `releasedWildcards` 局终即失效，需要新增持久化计数
- 展示顺序：放赖排第一位，其余四项（明杠/碰亮牌/补杠/暗杠）顺延

### 碰亮牌归属排查（先验证，不猜着改）

- 代码逐行核对显示归属逻辑本身是对的（meld 记在认领者名下、`detectEffectDescriptor` 取 meld 变化座位、埋点取该座位 sessionId），但用户实测现象与此矛盾
- 必须先写一个服务端集成测试，在 ranked-bot MATCH 房间精确复现"真人打出亮牌 → bot 碰"，断言 `competitive_action_events` 记录的 `session_id` 到底是谁
- 根据测试结果定位问题：优先排查 `createCompetitiveMatchWithBots` 座位洗牌与 session 映射是否错位；其次排查 `pendingEffectTransition` 期间 `room.round` 是否为过期状态；最后排查展示层数据源

## Acceptance Criteria

- [ ] 协议层 `competitive.ts` 新增 `RELEASE_WILDCARD` 枚举值与 `releaseWildcard` 统计字段
- [ ] `database.ts` 新增 `release_wildcard_count` 列（走现有 ALTER 增量模式）+ CHECK 约束更新
- [ ] `room-service.ts:342` 的 `competitiveAchievementAction` 不再排除 `RELEASE_WILDCARD`
- [ ] `counterColumn` 映射表新增放赖列
- [ ] `PlayerProfileModal.tsx` 成就展示："放赖"排第一位，统一三处不一致的中文文案（碰亮牌/亮牌碰杠/亮杠）到共享常量
- [ ] 新增服务端集成测试复现"真人打出亮牌被 bot 碰"场景，断言归属 session_id；测试结果驱动后续是否需要修复代码
- [ ] 若测试确认存在归属错误，修复根因并补充回归测试；若测试证明服务端无误，记录结论并将排查方向写入任务笔记供后续排查客户端展示层
- [ ] `pnpm test` 全绿，typecheck 通过
- [ ] 真机验证：打一局排位赛，放赖后资料卡计数正确增加且排位第一

## Out of Scope

- 成就系统整体重构（图标、成就页面等）—— 当前仍是资料卡内的简单计数展示

## Notes

- 关键文件：`apps/server/src/room-service.ts`、`database.ts`、`competitive-database.test.ts`、`room-service.test.ts`、`packages/protocol/src/competitive.ts`、`apps/miniprogram/src/components/PlayerProfileModal.tsx`
- 排查方式遵循 systematic-debugging：先复现，再定位，再修复，不允许跳过复现步骤直接改代码
