# 设计：机器人扩充与多桌并行

## 边界与契约

- `RANKED_BOTS` 常量结构不变（`RankedBot[]`），只是数组长度从 3 到 10
- `MatchmakingService` 对外 tick/queue/status 接口不变

## 数据流

1. `apps/server/src/competitive-bots.ts`：`RANKED_BOTS` 追加 7 项：

```ts
{ id: "bot-dalinwa", nickname: "大力娃", rankLevel: 0, avatarUrl: null },
{ id: "bot-qianliyan", nickname: "千里眼", rankLevel: 0, avatarUrl: null },
{ id: "bot-tiewa", nickname: "铁娃", rankLevel: 0, avatarUrl: null },
{ id: "bot-huowa", nickname: "火娃", rankLevel: 0, avatarUrl: null },
{ id: "bot-shuiwa", nickname: "水娃", rankLevel: 0, avatarUrl: null },
{ id: "bot-yinshenwa", nickname: "隐身娃", rankLevel: 0, avatarUrl: null },
{ id: "bot-huluwa", nickname: "葫芦娃", rankLevel: 0, avatarUrl: null },
```

   原 3 项（赌神 17 / 赌侠 13 / 赌圣 9）保持不变。`ensureRankedBotSession` 已有幂等语义（只在 profile 全新时写入初始 rankLevel），扩容不影响已存在的 bot 数据。

2. **只硬胡**：`room-service.ts` 两处（约 :1256、:1387）`createCompetitiveMatchWithBots` 内构造 bot 座位时写死的 `botDifficulty: "HIGH"` 改为 `"LOW"`。`LOW` 语义已在 `packages/game-engine/src/bot.ts:298` 定义（`view.botDifficulty === "HIGH" || view.winType === "HARD"` 才自动宣胡，`LOW` 时只有 `winType === "HARD"` 才胡）。

3. **多桌并行**：`matchmaking-service.ts:194` 现有逻辑：

```ts
if (this.botOptions.enabled && this.botOptions.bots.length === 3) { ... }
...
!this.botOptions.bots.some((bot) => this.database.hasActiveCompetitiveMatch(bot.id))
```

   改为：
   - 移除 `bots.length === 3` 的硬编码判断（改为 `bots.length >= 3`，只要够组一桌即可）
   - 互斥判断从"任意 bot 忙则整体不可用"改为"筛出当前空闲的 bot 子集"：

```ts
const idleBots = this.botOptions.bots.filter(
  (bot) => !this.database.hasActiveCompetitiveMatch(bot.id),
);
const neededBotCount = 4 - humanCount;
if (idleBots.length >= neededBotCount) {
  const chosenBots = idleBots.slice(0, neededBotCount);
  // ... 建房逻辑不变，chosenBots 替换原来的 this.botOptions.bots.slice(...)
}
```

   - 建房仍然是乐观并发事务（`hasActiveCompetitiveMatch` check + 事务创建），冲突时走现有 catch-and-retry-next-tick 路径，不需要额外加锁——10 个 bot 中并发抢占空闲子集的竞态窗口本来就窄，现有重试机制足够

4. **部署配置**：`deploy/compose.yaml` 的 `environment` 块新增 `MATCHMAKING_BOTS_ENABLED: "true"`

## 容量结论

10 个 bot，每桌消耗 `4 - humanCount` 个（humanCount 最少 1），最坏情况（每桌 1 真人 + 3 bot）可支持 **3 桌并行**，第 10 个 bot 单独用不完整桌，实际按需分配。若某桌 humanCount=2/3，可并行桌数相应增多。

## 权衡

- 不做"bot 段位钉死"：用户明确要求"和正常玩家打排位赛一样"，段位自然漂移是正确解读，避免过度设计
- 不改变 bot 在客户端隐藏段位的现状（`humanSessionIds` 过滤逻辑），保持现有设计意图

## 兼容性

- 纯配置与常量扩充 + 一处并发策略改动，无协议 schema 变更，无数据库结构变更
- 已存在的 3 个 bot 的历史数据不受影响
