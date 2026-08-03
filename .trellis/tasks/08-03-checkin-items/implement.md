# 实施计划：签到活动与道具体系

对应 `design.md`。按层自底向上实施，每步完成后跑对应测试。

## 阶段 1：引擎与协议（无副作用基础层）

- [x] 1.1 `packages/game-engine/src/competitive-rank.ts`：
  - WIN outcome 增加 `doubleCard?` → 加星 ×2；LOSS outcome 增加 `protectionHalved?` → 扣星先减半（floor）再抵保星卡；免疫优先。
  - transition 增加 `winDoubleCardUsed` / `rankProtectionApplied` 字段。
- [x] 1.2 `competitive-rank.test.ts` 扩展：加倍、减半、1→0、减半+抵卡、免疫优先、既有回归。
- [x] 1.3 `packages/protocol`：`GameCommand` + `CONFIRM_DOUBLE_CARD`；`RoomProjection.doubleDecision`；结算投影新字段；`SelfCompetitiveProfile` 道具字段；签到 DTO + `CHECKIN_MILESTONES` 常量（protocol 或 server 导出，客户端复用类型）。
- [x] 1.4 `npx vitest run packages`（引擎/协议）+ `pnpm typecheck`（apps 端待后续阶段完成后全量复核）。

## 阶段 2：服务端数据层

- [x] 2.1 `database.ts`：`check_in_records` 表；`competitive_profiles` 三新列（含旧库幂等补列）；`competitive_match_players` 两审计列；对应 CRUD（签到读写、道具增减、结算写入扩展 + 前置校验扩展）。
- [x] 2.2 `competitive-database.test.ts` / `database.test.ts`：迁移幂等、签到读写、结算审计列。

## 阶段 3：服务端业务层

- [x] 3.1 新建 `checkin-service.ts`：北京时间工具、`getCheckInStatus`、`sign`（幂等+里程碑发放）、`useRankProtection`（叠加 2h）。
- [x] 3.2 `checkin-service.test.ts`：周边界（北京时间周一 0 点、周日 23:59）、同日幂等、里程碑单次、跨周重置、叠加时长。
- [x] 3.3 `room-service.ts` 加倍决策门：`RoomState.doubleDecision`（含 Persisted/normalize 三条路径）、转场完成时挂起结算、`CONFIRM_DOUBLE_CARD` execute 分发、tick 超时结算、结算时注入 `doubleCard` / `protectionHalved`、扣卡与结算同事务。
- [x] 3.4 `room-service.test.ts`：用卡结算×2、不用/超时正常结算、非本人/超时命令拒绝、保护卡生效减半、低段免疫优先（引擎层 1.2 已覆盖）、决策门持久化恢复。
- [x] 3.5 `index.ts` 路由：checkin status/sign、use-rank-protection、profile 返回扩展。

## 阶段 4：客户端

- [x] 4.1 `api.ts`（或现有 API 封装）新增签到/道具接口调用。
- [x] 4.2 `pages/checkin`：7 格签到 UI + 签到按钮 + 奖励说明弹窗；注册路由；首页入口。
- [x] 4.3 `pages/backpack`：三道具卡 + 保护卡使用/倒计时；PlayerProfileModal 入口；注册路由。（偏差：道具图片改为服务端 `/cards/` 静态托管——三张图共 508KB 会突破小程序主包 2MB 限制；已压缩到 ≤200KB/张但仍超限）
- [x] 4.4 房间页：`doubleDecision` 弹窗（赢家限时选择）+ 其他玩家等待提示；`useRoom` 投影透传。
- [x] 4.5 `RoundSettlementModal` 等文案「保护卡」→「保星卡」+ 加倍/减半展示行。
- [x] 4.6 客户端纯函数测试（签到里程碑渲染映射、弹窗触发条件等，按现有测试风格）。

## 阶段 5：质量门与交付

- [x] 5.1 `npx vitest run`（全量，500 通过）、`pnpm typecheck`、`pnpm lint`。
- [x] 5.2 `pnpm --filter @huanghuang/miniprogram build:weapp`（dist 2012KB < 2MB 主包上限）。
- [ ] 5.3 后端部署线上（本次含 apps/server + packages 改动）：scp 增量文件 → docker build（APP_REVISION）→ sqlite 备份 + 回滚容器改名 → 新容器 → 验证 /api/version 与 /health/ready。
- [ ] 5.4 提交并推送；提醒用户上传小程序体验版。

## 风险点

- 加倍决策门横跨 commitAcceptedRule / tick 两条提交路径，改动 room-service.ts 核心提交流程——先补测试再改，保持 saveAcceptedTransition 原子性。
- DB 迁移需幂等（线上库已有数据）；部署前备份 sqlite（部署 runbook 已含）。
- 「保护卡」改名需全仓 grep 复核，避免遗漏。
