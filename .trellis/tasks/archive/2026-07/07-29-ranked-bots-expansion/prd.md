# 机器人扩充与多桌并行

父任务：`07-29-five-track-optimizations`。完整分析见 `/Users/zhang/.claude/plans/plan-1-2-federated-bunny.md` 第四节。

## Goal

排位赛机器人从 3 个扩充到 10 个，新增 7 个机器人：大力娃、千里眼、铁娃、火娃、水娃、隐身娃、葫芦娃，初始段位黑铁Ⅴ，和正常玩家打排位赛一样（段位自然漂移，非固定）。10 个机器人全部改为"只硬胡"，并支持多桌同时使用机器人补位（当前全局互斥，同一时刻只能开一桌）。

## Requirements

- 保留原 3 个机器人（赌神/赌侠/赌圣）现有段位不变
- 新增 7 个机器人，初始 `rankLevel: 0`（黑铁Ⅴ），和真人一样走完整段位结算（自然漂移，不钉在固定段位）
- 10 个机器人的 `botDifficulty` 全部改为 `"LOW"`（只硬胡，不可软胡）
- 移除机器人池全局互斥，改为筛选空闲机器人子集，支持多桌并行（10 个机器人 ⇒ 最多 3 桌并行，每桌 3 个机器人补位）
- 补充生产环境变量 `MATCHMAKING_BOTS_ENABLED=true`，否则新增机器人在线上不可见

## Acceptance Criteria

- [ ] `competitive-bots.ts` 的 `RANKED_BOTS` 扩充到 10 项，7 个新机器人名称、初始 rankLevel=0 符合要求
- [ ] `room-service.ts` 中两处写死的 `botDifficulty: "HIGH"` 改为 `"LOW"`
- [ ] `matchmaking-service.ts` 的 `bots.length === 3` 硬编码与全局 `hasActiveCompetitiveMatch` 互斥逻辑改为空闲机器人子集选取
- [ ] `deploy/compose.yaml` 新增 `MATCHMAKING_BOTS_ENABLED=true`
- [ ] 新增测试：10 个机器人可支持 3 桌并行、第 4 桌等待空闲机器人、同一机器人不会同时出现在两桌
- [ ] `pnpm test` 全绿，typecheck 通过
- [ ] 本地验证：并发发起 3+ 组排位赛队列（allowBots），确认可并行开 3 桌且无机器人重复占用

## Out of Scope

- 机器人段位钉死/例外结算逻辑（本次采用自然漂移，与真人完全一致）
- 机器人在客户端投影中显示段位信息（当前设计上刻意隐藏 bot 段位，本轮不改）

## Notes

- 关键文件：`apps/server/src/competitive-bots.ts`、`matchmaking-service.ts`、`room-service.ts`、`matchmaking-service.test.ts`、`deploy/compose.yaml`
- 建议在 `07-29-wildcard-achievement-and-audit` 之后进行，因为该任务的碰亮牌归属排查需要用到 bot 局
