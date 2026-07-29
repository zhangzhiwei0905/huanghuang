# 执行计划：放赖成就与碰亮牌归属排查

## 步骤

### Part 1：碰亮牌复现测试（先做，结果决定后续是否需要修复）

1. [ ] 在 `apps/server/src/room-service.test.ts` 新增测试：真人 + ranked bot 的 MATCH 房，构造真人打出亮牌、bot 碰亮牌的场景
2. [ ] 断言 `competitive_action_events` 记录的 `session_id` 应为 bot 的 session id
3. [ ] 运行测试，记录结果（红/绿）
4. [ ] 若红：按 design.md 的定位路径排查座位映射，修复根因，重跑测试至绿，补充边界测试
5. [ ] 若绿：记录结论到任务笔记，保留测试作为防回归用例，不做代码修改

### Part 2：放赖成就（独立于 Part 1，可并行）

6. [ ] `packages/protocol/src/competitive.ts`：枚举 + schema 加字段
7. [ ] `apps/server/src/database.ts`：ALTER 加列、CHECK 约束、SELECT 列表、`counterColumn` 映射
8. [ ] `apps/server/src/room-service.ts:342`：`RELEASE_WILDCARD` 不再排除；profile 投影补充字段
9. [ ] `apps/miniprogram/src/components/PlayerProfileModal.tsx`：新增"放赖"展示项排第一位；统一动作文案到共享常量（检查 `apps/web/src/components/playerActionNotice.ts`、`GameTable.tsx`、`apps/miniprogram/src/pages/room/index.tsx` 三处不一致的"碰亮牌/亮牌碰杠/亮杠"文案）
10. [ ] 新增/更新测试：`competitive-database.test.ts` 验证放赖计数累加与去重；`room-service.test.ts` 验证成就事件生成
11. [ ] 运行 `pnpm test`、typecheck 全绿

### 收尾

12. [ ] **[需要用户配合]** 真机打一局验证放赖计数与展示顺序

## 验证命令

```bash
pnpm --filter server test -- room-service
pnpm --filter server test -- competitive-database
pnpm --filter protocol test
pnpm --filter miniprogram typecheck
pnpm test
```

## 回滚点

- Part 1（排查）与 Part 2（新增成就）相互独立，可分别提交，互不影响回滚
- 若 Part 1 发现需要修复座位映射，该修复必须单独 commit 并附带清晰的 before/after 测试证据
