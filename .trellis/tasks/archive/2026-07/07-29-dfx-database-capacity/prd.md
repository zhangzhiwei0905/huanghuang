# DFX 数据库容量分析

父任务：`07-29-five-track-optimizations`。完整分析见 `/Users/zhang/.claude/plans/plan-1-2-federated-bunny.md` 第五节。

## Goal

评估当前 SQLite 数据库是否能承受排位赛的写入压力，给出是否需要迁移 Postgres 的明确结论，并指出项目运行时真正的压力点。本任务为分析交付，不做迁移落地。

## Requirements

- 盘点当前压力点：每个动作全量重写房间 JSON 快照、匹配心跳无条件写库、`project()` 每次调用查竞技档案等
- 给出本地写入基准数据支撑结论（例如 `synchronous=NORMAL` 前后对比）
- 明确回答："是否需要迁 PG" 以及触发迁移的真实条件是什么
- 列出成本更低、收益更高的优化建议，按优先级排序

## Acceptance Criteria

- [ ] 交付分析文档（`docs/dfx-capacity-2026-07.md` 或 Trellis research 目录下）
- [ ] 文档包含：现状盘点、压力点排序、`synchronous=NORMAL` 前后本地基准数据、PG 迁移的真实触发条件、优化优先级清单
- [ ] 明确指出并记录顺带发现的问题（`apps/server/.env` 疑似提交了真实 AppSecret 需核实、误提交的 `tsup.config.bundled_*.mjs` 构建产物）供用户决定是否处理
- [ ] 文档结论清晰可执行，不需要用户再自行分析

## Out of Scope

- 实际迁移 Postgres
- 实际修改 `synchronous` pragma 或房间快照写入策略（仅在文档中给出建议，不在本任务落地代码变更）

## Notes

- 本任务是 PRD-only 轻量任务，不需要 design.md/implement.md
- 建议放在其余四个任务之后执行，便于文档同时反映最新的代码状态
