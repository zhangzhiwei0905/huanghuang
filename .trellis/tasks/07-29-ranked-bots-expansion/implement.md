# 执行计划：机器人扩充与多桌并行

## 步骤

1. [ ] `competitive-bots.ts`：`RANKED_BOTS` 追加 7 个新机器人（名称/id/rankLevel=0 见 design.md）
2. [ ] `room-service.ts`：两处 `botDifficulty: "HIGH"` 改为 `"LOW"`
3. [ ] `matchmaking-service.ts`：
   - 移除 `bots.length === 3` 硬编码
   - 全局互斥改为空闲 bot 子集筛选 + 按需取用
4. [ ] `deploy/compose.yaml`：新增 `MATCHMAKING_BOTS_ENABLED: "true"`
5. [ ] `matchmaking-service.test.ts` 新增测试：
   - 10 bot 场景下可同时支撑 3 桌不同的 allowBots 队列
   - 空闲 bot 不足时新请求等待，不抢占正在使用的 bot
   - 同一 bot 不会被分配到两个并发建房事务（并发冲突走现有 catch 重试路径）
6. [ ] 运行 `pnpm --filter server test` 与 typecheck
7. [ ] **[需要用户配合]** 本地起服务，模拟 3+ 组 allowBots 队列并发入队，观察日志/DB 确认 3 桌并行、无重复占用

## 验证命令

```bash
pnpm --filter server test -- matchmaking
pnpm --filter server typecheck
```

## 回滚点

- 常量扩充与并发策略改动可整体一次性提交（改动面小、耦合紧），如需回滚整体 revert 即可
- `deploy/compose.yaml` 的环境变量改动是纯配置，回滚不影响代码
