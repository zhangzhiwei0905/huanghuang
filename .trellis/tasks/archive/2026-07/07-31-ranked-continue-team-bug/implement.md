# 执行清单：排位续局丢失队伍修复

1. `database.ts`：新增 `origin_party_id` 迁移列；`createCompetitiveMatch`/`createCompetitiveMatchWithBots` 输入类型与写入逻辑支持 `originPartyId`；读取路径（结算查询/当前对局查询）带出该字段。
2. `room-service.ts`：`createCompetitiveMatch`/`createCompetitiveMatchWithBots` 从 entries 派生 `originPartyId` 传给 database 层；`room.competitiveMatch` 投影新增 `originRoomCode`（查 `getRoomById` 解析房间码，找不到给 null）。
3. `packages/protocol/src/competitive.ts`：同步新增 `originRoomCode` 字段类型，检查是否有对应的 zod/校验 schema 需要一起改。
4. 确认结算页数据来源（`roomCtrl.lastSettlement` 或等价状态）是否也需要带上 `originRoomCode`，需要则一并补上。
5. `pages/room/index.tsx`：`continueCompetitiveMatch()` 按 `originRoomCode` 分支：非空则跳转回预备房间，空则保留现有单人续局逻辑。
6. 手动验证：起本地服务，模拟组队排位打完一局，确认续局能回到预备房间且可重新发起匹配；模拟原预备房间已解散场景，确认回退到单人续局不卡死；确认单人排位续局行为不变。
7. 补服务端单测覆盖 `originPartyId` 的写入与读取；跑现有相关测试确保不回归。
8. `tsc` 编译 + lint 检查 server / protocol / miniprogram 三个包。

## 验证命令

- `pnpm --filter @huanghuang/server test`
- `pnpm --filter @huanghuang/server typecheck`
- `pnpm --filter @huanghuang/protocol typecheck`（如有）
- `pnpm --filter @huanghuang/miniprogram typecheck`（或项目实际配置的命令）
