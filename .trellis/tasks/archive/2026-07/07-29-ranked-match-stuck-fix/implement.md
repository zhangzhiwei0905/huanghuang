# 执行计划：排位赛卡死修复与韧性

## 步骤（建议按此顺序，各点可独立提交验证）

1. [ ] 修复点 A：`index/index.tsx` 的 `returnToCompetitiveMatch` catch 分支回写 state；补 `useDidShow`；轮询条件覆盖 MATCHED
2. [ ] 修复点 A 测试：模拟 `status()` 返回 `room: null` 时验证 matchmaking state 被正确更新为可重新排队
3. [ ] 修复点 D：`leaveCurrentRoom` 在 `ROUND_RESULT` + MATCH 模式下先 ack 再离开
4. [ ] 修复点 D 测试：验证结算阶段离开后不会被 `applyMatchmakingResponse` 弹回房间
5. [ ] 修复点 C：`useRoom.ts` 增加 `lastSettlement` 保留逻辑，房间关闭时不丢弃 matchId
6. [ ] 修复点 B：空壳页导航方式改为 `reLaunch`
7. [ ] 修复点 B/C 联合测试：房间 CLOSED → 空壳页 → 点击继续/回主页均可用
8. [ ] 韧性：`database.ts` 新增 `allow_bots` 列 + ALTER 迁移 + 读写逻辑；`matchmaking-service.ts` 改为 DB 优先、内存缓存
9. [ ] 韧性：新增 `CompetitiveMatchCreationConflictError`，替换字符串匹配判别
10. [ ] 韧性：心跳超时改为 8s
11. [ ] 韧性测试：服务重启（新建 `MatchmakingService` 实例）后 `allowBots` 偏好不丢失；建局冲突分支的错误类型断言
12. [ ] 运行 `pnpm test`（server + miniprogram）与 typecheck
13. [ ] **[需要用户配合]** 真机跑完整一局 bot 排位赛，验证三条路径

## 验证命令

```bash
pnpm --filter server test
pnpm --filter miniprogram test
pnpm --filter server typecheck
pnpm --filter miniprogram typecheck
```

## 回滚点

- 每个修复点独立 commit，任一点出问题可单独 revert，不影响其余修复
- `allow_bots` 列是增量 ALTER，回滚时无需 down migration（保留列即可，不影响旧代码路径）
