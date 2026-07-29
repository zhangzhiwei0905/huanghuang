# DFX：数据库容量与迁移评估（2026-07）

任务来源：`.trellis/tasks/07-29-dfx-database-capacity`（父任务 `07-29-five-track-optimizations`）。
结论先行：**不需要迁 Postgres**。当前 SQLite 用量远低于其单机吞吐上限，真正的规模天花板是「单进程/单实例」架构本身，
迁 PG 只是多实例横向扩展这个更大工程里的一环，单独换库不解决任何现存问题。以下是支撑这个结论的现状盘点、压力点排序、
实测基准数据，以及更值得先做的低成本优化清单。

## 1. 现状架构一览

服务端是一个 Node/Fastify + socket.io 单进程服务，游戏状态完全保存在内存（`RoomService` 里的 `Map<code, RoomState>`），
`better-sqlite3` 只作为「重启后可恢复」的持久化层和竞技排位的权威账本：房间快照（`rooms` 表）、幂等请求结果
（`processed_requests`）、竞技档案/赛事流水（`competitive_*` 表）、匹配队列（`matchmaking_entries`）都在同一个 SQLite
文件里，用同一条同步连接顺序执行。没有 ORM，没有连接池（`better-sqlite3` 本身就是同步单连接，池化也无意义），迁移靠
`migrate()` 里手写的 `CREATE TABLE IF NOT EXISTS` + try/catch 的增量 `ALTER TABLE`。这个设计对当前量级（好友房 + 少量并发
排位桌）完全够用，下面的基准数据也证明了这一点；真正该关注的是内存态房间只活在一个进程里，一旦要多机部署，socket.io
广播和"谁能改这个房间"的单写者语义都要重新设计，而不是数据库选型问题。

## 2. 压力点排序（按当前代码实测影响力从高到低）

### 2.1 房间快照全量重写（影响最大，但绝对值仍很小）

- **位置**：`apps/server/src/database.ts:1400-1414`（`saveRoom`）用 `INSERT ... ON CONFLICT(id) DO UPDATE` 整体覆盖
  `state_json` 列，没有任何增量 diff。
- **调用方**（`apps/server/src/room-service.ts`，均经由 `saveAcceptedTransition` → `saveRoom`）：
  - `commitAcceptedRule`（`room-service.ts:934-961`，落库调用在 950）：每一个被接受的真人操作（出牌/吃碰杠/胡牌等）触发一次全量快照写入。这是 socket 命令路径（`room-service.ts:2022` 调用 `commitAcceptedRule`）和到期自动出牌路径（`room-service.ts:1159`）共用的唯一提交点。
  - `tick()` 里的特效过渡收尾（`room-service.ts:1068-1084`，写入在 1077）：凡是触发了"碰/杠/胡"这类有可视特效的动作，`acceptRule`（`room-service.ts:815-829`）会先把新状态挂到 `pendingEffectTransition` 而不立刻生效，等 `tick()` 在特效动画结束后再落地——这意味着**一次有特效的操作会产生两次全量快照写入**（一次在 accept 时机的隐式版本+1，一次在特效收尾时的真正状态落地），而不是文档最初假设的"每次操作一次"。
  - `tick()` 里到期未操作的兜底刷新（`room-service.ts:1160-1165`）：也会在没有实际状态变化时写一次快照（仅用于刷新 `actionDeadlineAt`）。
- **今天的相关变更**：房间调度 tick 间隔从 250ms 降到 50ms（用于让特效收尾更贴近动画结束帧），但这个改动本身**不会**让写库频率变成"每 50ms 一次"——`tick()` 对每个房间只在真的有状态跃迁（特效到期、回合到期等）时才调用 `saveAcceptedTransition`，其余大多数 50ms 轮询只是遍历内存里的条件判断，没有 DB 写入。50ms 只是把「等特效动画放完再落库」这件事从最多 250ms 延迟收紧到 50ms，对 DB 写入总量的影响可以忽略。
- **实测房间快照大小**：用 `RoomService.createRoom(owner, 2, "BOT")` 构造一局真实的 4 人（1 真人 + 3 bot）房间并 `JSON.stringify`：
  - 开局（发牌后立即序列化）：**6,201 字节**
  - 驱动 400 次 `tick()`（约等于走完若干回合的 bot 出牌/吃碰）后：**6,473 字节**
  - 与 PRD 预估的 5-20KB 区间吻合，取中间略保守的 **8KB** 作为基准测试载荷（局末讨论牌堆更满时可能到 10-12KB，但不会到 20KB 这个量级——房间快照里最大的字段是四家的整副墙/手牌/牌河，字段数量固定不随局数线性增长，只有每人的出牌记录数组会变长）。
- **一局麻将约 60-120 次被接受的操作** → 若其中一部分带特效（双倍写入），保守估计一局约产生 **80-150 次全量快照写入**，每次约 8KB。

### 2.2 `synchronous` PRAGMA 未显式设置（当前默认 FULL，可优化项，非当前瓶颈）

- **确认现状**：`apps/server/src/database.ts:227-231` 只设置了 `journal_mode = WAL`、`foreign_keys = ON`、
  `busy_timeout = 5000`，**没有** `synchronous` 设置，SQLite 在 WAL 模式下默认是 `FULL`（每次事务提交都做一次同步
  fsync）。这一点在今天的其它四个任务改动里都没有触碰，依然成立。
- **基准测试**：写了一个一次性脚本（`bench-sqlite-write.mjs`，已在生成本文档后删除，未纳入仓库——见下方"清理说明"），
  在临时目录建表结构与 `rooms` 表完全一致（含相同的 `INSERT...ON CONFLICT DO UPDATE`），WAL 模式下对比
  `synchronous=FULL`（默认）与 `synchronous=NORMAL`，单进程顺序写入 3000 次、每次 payload 约 8KB：

  | synchronous | 总耗时（3000 次） | 吞吐 | 单次平均延迟 |
  |---|---|---|---|
  | FULL（当前默认） | ~130-140ms | ~21,000-23,000 ops/sec | ~0.043-0.047ms |
  | NORMAL | ~49-52ms | ~58,000-61,000 ops/sec | ~0.016-0.017ms |

  （本机跑了 3 轮取值范围，数据稳定；测试机是 macOS 开发笔记本的 SSD，不是生产环境的机器，绝对值仅供量级参考，但
  **NORMAL 比 FULL 快约 2.6-2.7 倍**这个相对关系符合 SQLite 官方文档对该 PRAGMA 的一贯描述，方向性结论可信。）
- **结论**：即使在最保守的 `synchronous=FULL` 下，单次 8KB 房间快照写入也只要 ~0.045ms，对应单机吞吐两万级 ops/sec——
  而一局麻将全程只产生百来次写入、分摊在几分钟到十几分钟的对局时间里，实际写入速率是"每几秒一次"量级，
  比 SQLite 单机上限低 4-5 个数量级。**`synchronous=NORMAL` 是一个几乎零风险、随手可做的优化，但它优化的是一个远没有
  被跑满的维度，不是当前的性能瓶颈。**
  - 安全性说明（供决策参考，不在本任务落地）：`synchronous=NORMAL` 配合 WAL 模式，SQLite 官方文档的说法是——应用崩溃
    （进程挂了）依然是完全安全的（不会损坏数据库），只有在"操作系统级崩溃或掉电"且恰好发生在 WAL 还没
    checkpoint 到主数据库文件之间的窗口内时，才可能丢失最近几次已提交事务。对这个麻将游戏的可容忍度而言（丢一局房间
    状态，重启后玩家从上一次成功保存的进度重连，不是资金类不可恢复损失），这是一个官方认可的、被广泛采用的合理取舍。

### 2.3 `project()` 每次投影都查一遍竞技档案

- **位置**：`apps/server/src/room-service.ts:1721-1737`（`project()`），仅当 `room.mode === "MATCH"` 时才触发，
  调用 `this.database.getPublicCompetitiveProfiles(humanSessionIds)`（`database.ts:712-728`，一条
  `SELECT ... WHERE session_id IN (...)`，按房间里的真人数量批量查，不是逐人单查）。
- **调用频率**：`project()` 本身在 `apps/server/src/index.ts` 里被大量路径调用——每次 HTTP 房间操作响应
  （`index.ts:427/441/452/466/481/494/511/524/534/542/592/622`）以及最关键的 `emitRoomProjection`
  （`index.ts:140-162`）：房间状态每次变化后，对房间内**每一个在线 socket 成员都单独调用一次 `project()`**
  （`index.ts:151`，`for (const memberSocket of roomSockets)` 循环内）。也就是说一次状态变化会触发
  "房间人数"次 `project()` 调用，每次都对竞技档案表发一条 `SELECT`。
- **影响评估**：这条 SQL 有索引覆盖（`session_id` 是主键），单次查询成本很低，且只在 `MATCH`（排位赛）房间生效，
  友房不受影响。按 2.1 的写入频率类比，这个读放大是"账面上看起来冗余，但绝对量仍然很小"的问题——4 人房间每次广播是
  4 次可命中主键索引的 SELECT，量级上比 2.1 的全量写入便宜得多。列为第三优先级是因为它是**最容易免费优化掉**的一项
  （见下方优化清单），不是因为它现在拖累了性能。

## 3. 是否需要迁移 Postgres？

**不需要，现在不需要。** 上面的实测数据说明 SQLite 单机写入吞吐（两万级 ops/sec，8KB payload，最保守的 `synchronous=FULL`
配置下）比这个游戏实际产生的写入速率高出几个数量级；`better-sqlite3` 的同步单连接模型对这种"单进程持有全部内存态、
数据库只是持久化影子"的架构反而是优势——没有网络往返、没有连接池排队、没有 ORM 开销。

**触发迁移的真实条件**：当且仅当需要**多实例横向扩展**（超出单进程能承载的并发房间数/CPU/内存）时，才需要迁 PG——而且
迁 PG 本身**不是**解决多实例扩展的完整方案，它只是必要不充分条件。完整的多实例改造需要三件事同时到位：

1. **数据库换成支持多连接并发写的引擎**（PG 或类似），因为 `better-sqlite3` 的单文件单连接模型不支持多进程共享写。
2. **socket.io 的 Redis adapter**（或等价的跨实例广播机制），因为现在 `sockets.to(roomId).emit(...)` 依赖单进程内的
   socket.io room registry，多实例部署下同一个房间的两个成员可能连到不同实例，不接 adapter 广播就会失效。
3. **房间"单写者"机制**（比如按房间 ID 做一致性哈希路由到固定实例，或者用分布式锁/乐观版本号仲裁），因为现在
   `RoomState` 的读改写全部假设"同一时刻只有一个进程在内存里持有并修改这个房间"，这个假设一旦跨实例就不成立，
   单纯换成支持并发写的数据库并不会自动解决"两个实例同时改同一个房间内存态"的竞态问题。

换句话说，"要不要迁 PG"这个问题本身问错了粒度——真正要回答的是"要不要做多实例部署"，如果答案是否，PG 和 SQLite
在这个项目当前的使用方式下几乎没有实际差异；如果答案是是，那么 PG 只是三块拼图里最容易实现的一块，Redis adapter
和单写者机制才是更难啃的部分，且必须一起做，分开做没有意义。

## 4. 优化优先级清单（成本从低到高排序）

| 优先级 | 优化项 | 预期收益 | 成本/风险 |
|---|---|---|---|
| 1 | `connection.pragma("synchronous = NORMAL")`，紧跟现有 `journal_mode = WAL` 之后一行 | 写入延迟降约 2.6 倍（见 2.2 实测），几乎不影响代码结构 | 极低；崩溃安全性语义变化需要在 PR 描述里写清楚（见 2.2 的安全性说明），但对这个游戏的容错要求是可接受的 |
| 2 | 缓存 `project()` 里的竞技档案查询（比如按房间维度做一次批量查询后在同一次 `emitRoomProjection` 的多次 `project()` 调用间复用，而不是每个 socket 成员各查一次） | 把"房间人数"次 SELECT 降到 1 次；对 MATCH 房间的广播路径是免费的吞吐提升 | 低；`emitRoomProjection`（`index.ts:140-162`）改造成"先批量取一次 profiles map，传给每次 `project()` 调用"即可，`project()` 签名需要新增一个可选的 profiles 参数或抽出一个辅助方法 |
| 3 | 解耦匹配心跳写库与热轮询路径：`/api/matchmaking/status`（`index.ts:314-323`）每次都调用 `matchmaking.heartbeat()` → `markMatchmakingEntryConnected`（`database.ts:821-830`，一次 UPDATE），客户端约 1 秒轮询一次；可以改成内存态维护"最近心跳时间"，只在状态真的从"离线转在线"时才落库（`markMatchmakingEntryConnected` 本身的 SQL 已经用 `WHERE disconnected_at IS NOT NULL` 做了这个短路,但即使 UPDATE 影响 0 行,每次调用依然要走一次 SQLite 语句执行开销） | 把队列中每个玩家的写入频率从"每秒 1 次"降到"仅状态翻转时" | 中；`MatchmakingService.heartbeat()`（`matchmaking-service.ts:110-114`）已经有一个 `heartbeatAtBySessionId` 内存 Map,可以在这个 Map 基础上加一层"上次已知的 disconnected 状态"缓存,避免对每次心跳都调用数据库方法 |
| 4 | 房间快照写入合并/防抖：把 2.1 里"一次带特效的操作产生两次全量写"的情况合并成一次(比如 accept 时不写库,只在 tick 收尾或下一次真正需要持久化的时机写),或者引入基于时间窗口的防抖(比如 100ms 内的多次状态变化只保留最后一次落库) | 按 2.1 的估算,理论上能把一局对局的写入次数减半甚至更多 | 较高；这触碰断线重连恢复逻辑的正确性(见 `room-service.ts:528/582` 从持久化状态恢复 `pendingEffectTransition` 的代码),需要仔细验证"如果服务器在防抖窗口内重启,会不会丢失中间状态并导致断线重连行为异常",建议放到有明确性能问题信号(比如实际监控到写入延迟)之后再做,当前基准数据不支持这是紧急项 |

排序依据：1 和 2 是"改一行/改一个函数签名"级别的低风险高杠杆项,建议随手做;3 需要小心处理内存缓存与数据库真实状态
的一致性(尤其是服务器重启后内存 Map 清空,但数据库里的 `disconnected_at` 还留着上次的状态,需要确认冷启动路径不会
误判);4 收益理论上最大,但涉及断线重连正确性,风险最高,而且 2.1/2.2 的实测数据已经证明当前写入量远没有跑满 SQLite,
不建议在没有真实性能问题信号前就去动它。

## 5. 顺带发现的问题（不在本任务范围内，仅供用户决定是否处理）

以下两项是分析过程中顺带检查到的，明确标注**不是本任务的交付范围**，本任务未对它们做任何修改：

- **`apps/server/.env`**：核实结果——**该文件当前没有被 git 追踪**（`git ls-files apps/server/.env` 返回空，
  `git check-ignore -v` 确认它命中根 `.gitignore` 第 5 行的 `.env` 规则；`git log --all -- apps/server/.env`
  在全部历史里也没有任何提交记录），所以**不存在"已提交到仓库历史"的泄露风险**，PRD 里"疑似提交了真实 AppSecret"
  的担忧核实下来不成立。文件本地内容里的 `WECHAT_APP_SECRET`/`WECHAT_APP_ID` 字段长度（分别为 32 位和 18 位）
  和真实微信凭证的典型格式一致，看起来不是占位符文本——但因为它从未进入 git 历史，这只是"本地开发机文件管理"层面
  需要注意（比如别手滑 `git add -f`），不是需要清理仓库历史的紧急事项。
- **`apps/server/tsup.config.bundled_fvfgytieioq.mjs`**：确认**仍然被 git 追踪**（在提交 `e8b8d43`
  "fix(matchmaking): seed ranked bot highestMajorIndex..." 中被加入仓库），内容是 `tsup` 为了执行
  TypeScript 格式的 `tsup.config.ts` 而生成的一次性编译产物（带 base64 内联 sourcemap，sourcemap 里还硬编码了
  提交者本机的绝对路径 `/Users/zhang/Documents/...`）。`.gitignore` 里没有覆盖 `tsup.config.bundled*` 这个模式，
  这类文件大概率是执行 `tsup`/`pnpm build` 时被无意用 `git add -A`/`git add .` 带入暂存区的。建议后续（不在本任务
  内）在根 `.gitignore` 补一条 `apps/server/tsup.config.bundled_*.mjs` 或更通用的 `tsup.config.bundled_*.mjs`
  规则，并 `git rm` 掉这个已提交的文件。

## 6. 基准脚本清理说明

按任务要求，生成本文档所需的一次性基准脚本（`bench-sqlite-write.mjs`，对比 `synchronous=FULL` 与 `NORMAL` 的写入
吞吐）在提取出上述数字后已经删除，**没有**保留在仓库里，因为：

1. 它只是为了产出这份文档里的一次性数字，不是长期需要维护的工具；
2. 它对项目 schema 做了简化复制（只建了 `rooms` 表，不含完整迁移逻辑），留在仓库里容易在 schema 演进后过时并误导人；
3. 如果未来需要重新跑一次同类基准（比如迁移 PG 前再验证一次，或者验证优化清单里第 4 项落地后的实际效果），
   照着本文档第 2.2 节的方法论（临时目录建表、`INSERT...ON CONFLICT`、WAL + 对比 `synchronous` 两个值、3000 次
   顺序写入取吞吐）几分钟内可以重新写一个，不需要长期维护这份脚本。

用于估算房间快照真实大小的构造过程（`RoomService.createRoom(owner, 2, "BOT")` + `JSON.stringify`）是通过一个临时
vitest 测试文件跑的，同样已经删除，未保留在仓库里。
