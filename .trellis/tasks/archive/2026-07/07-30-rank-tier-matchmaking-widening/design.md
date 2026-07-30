# 设计：段位匹配阶梯改为按大段扩容

## 边界

- 改动范围：`apps/server/src/matchmaking-algorithm.ts`（核心算法，纯函数，已有单元测试）+ `apps/miniprogram/src/lib/matchmakingPresentation.ts`（纯展示文案）+ `.trellis/spec/backend/team-matchmaking.md`（契约文档）。
- 不改：`matchmaking-service.ts` 的调度/持久化逻辑、`partyId` 跳过段位校验的规则、`database.ts` 的表结构。
- 新依赖：`apps/server` 引入 `@huanghuang/game-engine` 的 `majorIndexForRankLevel`（如果 `apps/server` 尚未依赖 `@huanghuang/game-engine`，需要在 `apps/server/package.json` 里补上 workspace 依赖；否则直接 import）。

## 数据流 / 契约

```
mutuallyCompatible(left, right, now)
  -> majorLeft  = majorIndexForRankLevel(left.rankLevel)
  -> majorRight = majorIndexForRankLevel(right.rankLevel)
  -> distance   = |majorLeft - majorRight|
  -> distance <= matchmakingMajorTierRange(waitMs(left, now))
     && distance <= matchmakingMajorTierRange(waitMs(right, now))
```

新函数 `matchmakingMajorTierRange(waitMs): number`：

```ts
export function matchmakingMajorTierRange(waitMs: number): number {
  if (waitMs < 10_000) return 0;
  if (waitMs < 20_000) return 1;
  if (waitMs < 40_000) return 2;
  return Number.POSITIVE_INFINITY;
}
```

保留原 `matchmakingRange`（原始 rankLevel 阈值）与否：**不保留**——它只被 `mutuallyCompatible` 和 `selectBotFillGroup` 引用，两处都要切到新口径，旧函数删掉即可，避免出现两套并行阈值互相混淆。搜索确认无其他调用方后再删除。

`selectBotFillGroup`（`matchmaking-algorithm.ts:190-272`）内部对机器人段位的校验，找到其调用 `matchmakingRange`/距离比较的具体行，同步替换为大段口径（同一 `matchmakingMajorTierRange` 函数 + `majorIndexForRankLevel`）。

## 兼容性

- `MatchmakingCandidate` 的 `rankLevel` 字段不变，只是比较方式变了——不涉及数据库 schema 或协议 schema 改动。
- 客户端 `matchmakingPresentation.ts` 的阈值常量（10/20/40 秒）保持不变，只改文案措辞和判断依据（从"差 N 级"改成"大段距离"）；确认它是否直接复用服务端的枚举值还是独立硬编码字符串，按现状风格保持一致（当前是独立硬编码，需要保持两处阈值数字同步，避免像现在这样出现"客户端展示口径与服务端实际口径不一致"的情况——本次顺手把两边的阈值来源关系在代码注释里写清楚，防止下次改动只改一边）。

## 回滚

- 单一 commit 即可回滚（纯函数替换 + 文案 + 测试），无数据迁移，无需灰度。
