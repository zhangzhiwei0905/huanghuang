# 好友组队与机器人排位体验升级实施计划

## 1. 协议与数据库

- [x] 在 `packages/protocol/src/social.ts` 增加 4 位玩家 ID、社交玩家、好友申请、好友列表、房间邀请和社交快照 schema/type。
- [x] 从 `packages/protocol/src/index.ts` 导出社交协议。
- [x] 给房间玩家、等待座位和观战投影增加 `playerId: string | null`。
- [x] 将团队匹配成员数扩为 1-4，并增加团队开始 `{ allowBots }` 输入 schema。
- [x] 扩展 `AnonymousSession` 和统一 session 查询列。
- [x] 迁移 `anonymous_sessions.player_id`、唯一索引、好友申请、好友关系和房间邀请表。
- [x] 安全重建 `matchmaking_entries`，把 `party_size` CHECK 从 2-4 扩为 1-4，保留现有数据与索引。
- [x] 为现有微信账号回填唯一 4 位 ID，新微信账号在事务中分配；机器人保持 `NULL`。
- [ ] 增加数据库事务测试：ID 唯一与耗尽、迁移保留、申请接受、重复申请、删除好友、邀请过期。

## 2. 社交服务与 API

- [x] 新建 `apps/server/src/social-service.ts`，实现精确查找、申请、接受、拒绝、撤回、删除和快照。
- [x] 实现房间邀请创建、拒绝、接受、10 分钟过期及房间状态失效。
- [x] 在 `apps/server/src/index.ts` 注册社交 REST 路由，统一认证、状态码和日志。
- [x] 让每个认证 Socket 加入 `session:<sessionId>` 私有频道。
- [x] 社交变更只向相关私有频道发送 `social:update` 提示。
- [ ] 增加错误映射与服务测试，覆盖越权、自己添加、非好友邀请、好友离线、房满和竞态。

## 3. 统一排位房

- [x] 主页“排位赛”统一创建 `TEAM_MATCH` 房，删除主页直接单排调用和单双排双入口。
- [x] 让团队排队接受 1-4 人与 `allowBots`，整队同值原子写入。
- [x] 修改 `prepareTeamMatch`：房主点击开始代表自己准备，只校验非房主成员 ready。
- [x] 修改等待房投影与客户端条件，支持一人直接开始。
- [x] 保持取消、断线恢复、当前比赛恢复和整队不可拆分语义。
- [x] 增加数据库、算法、服务和房间测试，覆盖 1/2/3/4 人队伍。

## 4. 机器人候选与公平轮换

- [x] 从数据库读取每个空闲机器人的实时段位和最近比赛时间。
- [x] 抽取纯函数选择完整真人队伍与机器人候选，复用 `matchmakingRange()`。
- [x] 保留 5 秒真人聚合窗口；在 10/20/40 秒边界验证段位范围。
- [x] 按最近使用时间公平轮换，不再 `slice()` 固定数组头部。
- [x] 覆盖 10 个机器人可达性、段位不兼容、范围扩大、并发占用和队伍不拆分测试。

## 5. 小程序社交状态

- [x] 在 `apps/miniprogram/src/api/http.ts` 增加 typed social API 与房间邀请 API。
- [x] 新建 `apps/miniprogram/src/hooks/useSocial.ts`，实现私有 Socket 提示、串行刷新、清理和 mutation lock。
- [x] 在 `apps/miniprogram/src/lib/errors.ts` 增加所有稳定中文错误文案。
- [x] 更新身份类型与恢复逻辑，读取并保存 `playerId`。
- [x] 扩展 `normalizeRoomProjection`，兼容旧投影缺失 `playerId`。
- [ ] 增加社交投影、错误映射、刷新去重和旧房间归一化测试。

## 6. 小程序主页与好友管理

- [x] 重构 `pages/index/index.tsx` 主页信息架构，只保留一个主排位入口。
- [x] 账号条展示并可复制 4 位 ID，好友入口展示待处理角标。
- [x] 新建可复用好友管理/邀请面板，覆盖好友、申请、精确 ID 搜索、在线状态、撤回与删除。
- [x] 缩小次级模式按钮，使用翡翠主色和同色系不同明度，不改变 Logo 与桌面背景。
- [x] 完成好友列表 loading、empty、error 和禁用状态。
- [ ] 更新 `index.scss`，验证横屏安全区、窄高度设备和无横向溢出。

## 7. 小程序排位房与玩家资料

- [x] 排位房桌面边缘加入“允许机器人补位”勾选并在排队时隐藏，避免与中央状态和开始按钮重叠。
- [x] 房主显示开始或取消匹配；非房主显示准备或取消准备。
- [x] 空位和房间工具栏可打开在线好友邀请面板。
- [x] 在线房间邀请实时弹出；接受后写入 room storage 并导航。
- [x] 扩展 `PlayerProfileModal` 展示玩家 ID 和好友关系操作。
- [x] 机器人资料保持无 ID、无好友按钮；自己资料只展示和复制 ID。
- [x] 为弹层与状态过渡增加 reduced-motion 回退。

## 8. 规范、验证与回滚检查

- [x] 更新 `.trellis/spec/backend/database-guidelines.md`、`team-matchmaking.md`、`quality-guidelines.md`。
- [x] 更新 `.trellis/spec/frontend/state-management.md`、`miniprogram.md`、`quality-guidelines.md`。
- [ ] 运行 `pnpm --filter @huanghuang/protocol test`。
- [ ] 运行 `pnpm --filter @huanghuang/server test`。
- [x] 运行 `pnpm --filter @huanghuang/miniprogram typecheck`。
- [x] 运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`。
- [x] 运行 `pnpm --filter @huanghuang/miniprogram build:weapp`。
- [x] 运行 `pnpm build`，确认 Web 端共享协议兼容。
- [ ] 用微信开发者工具验证主页、好友管理、单人排位、2-4 人组队、机器人补位、邀请失效与资料卡。
- [ ] 在生产数据库副本验证迁移和回滚：新增表可保留，旧服务端可忽略新增列。

## 风险文件与回滚点

- `apps/server/src/database.ts`：表重建与玩家 ID 回填必须独立测试，提交前备份生产 SQLite。
- `apps/server/src/matchmaking-service.ts`：机器人和整队选择必须保持创建事务的冲突保护。
- `apps/server/src/room-service.ts`：只放宽 `TEAM_MATCH`，不得改变 `FRIEND` 和 `MATCH` 的准备/开局语义。
- `packages/protocol/src/projections.ts`：Web 与小程序都消费该文件，任何必填字段变更都要通过全仓 typecheck。
- `apps/miniprogram/src/pages/index/index.tsx` 与 `pages/room/index.tsx`：保留现有断线恢复、结算和房间导航守卫。
