# 优化结算赖子展示与听牌提示 — 技术设计

## 1. 设计目标

在不复制胡牌规则、不泄露隐藏牌和不改变现有出牌行为的前提下：

1. 用结算弹窗局部样式消除赖子外轮廓与负边距叠放产生的深色竖线。
2. 由游戏引擎计算“每张可打物理牌 → 打出后可胡牌”。
3. 由服务端把当前出牌者专属的听牌结果和公开剩余数量加入房间投影。
4. 由小程序为所有可听出牌显示小“听”标识，并为当前选牌展示对应候选卡片。

## 2. 边界与依赖方向

```text
packages/game-engine
  纯规则：打出物理牌后，逐牌种调用 evaluateWin
            │
            ▼
apps/server RoomService.project
  当前成员专属投影 + 公开牌去重计数 + 合并倍率
            │
            ▼
packages/protocol RoomProjection
  tingHints: discardTileId -> waits[]
            │
            ▼
apps/miniprogram
  只渲染投影；不计算胡型、倍率或隐藏牌
```

- `apps/miniprogram` 继续只依赖 `@huanghuang/protocol`，不引入 `@huanghuang/game-engine`。
- 游戏引擎不依赖服务端、投影或 UI。
- 服务端只在当前成员确实拥有 `DISCARD_TILE` 合法动作时投影提示；其他成员得到空数组。
- Web 端不新增 UI，但会同步协议类型/测试夹具以保持 monorepo 类型检查通过。

## 3. 游戏引擎：打后听牌分析

新增纯规则模块（建议 `packages/game-engine/src/ting.ts`），通过包根导出：

```ts
type DiscardTingOption = {
  discardTileId: string;
  waits: {
    tileKind: TileKind;
    winType: WinType;
  }[];
};

analyzeDiscardTingOptions(input: {
  concealedTiles: Tile[];
  melds: Meld[];
  wildcardKind: TileKind;
}): DiscardTingOption[];
```

算法：

1. 只枚举非赖子的物理手牌 ID 作为可打候选。
2. 对每个候选，从暗手中移除该物理牌。
3. 枚举 `allTileKinds()` 的 27 种牌，创建唯一的模拟摸牌 ID，加入打出后的手牌。
4. 调用现有 `evaluateWin`，仅保留 `canWin === true` 且 `winType !== null` 的牌种。
5. 保持万、条、筒和点数的既有排序。
6. 若打出后的手牌已含赖子，不展示赖子候选；现有 `evaluateWin` 的“最多一张赖子”约束也会拒绝第二张赖子，但仍用显式测试锁定产品规则。
7. 打出后的手牌没有赖子时，赖子牌种与其他牌种一样通过权威规则评估，并用“模拟摸到的赖子就是 winningTileId”保留现有赖子将牌语义。

该 helper 不计算剩余数量或倍率，避免把投影/可见性概念放进规则层。

## 4. 协议投影

在 `packages/protocol/src/projections.ts` 增加：

```ts
type TingWaitProjection = {
  tileKind: TileKind;
  winType: WinType;
  multiplier: number;
  remainingCount: number;
};

type DiscardTingProjection = {
  discardTileId: string;
  waits: TingWaitProjection[];
};
```

`RoomProjection` 新增 `tingHints: DiscardTingProjection[]`，并将 `schemaVersion` 从 4 提升到 5。

- `discardTileId` 使用物理牌 ID，和现有选择/二次点击出牌模型一致。
- `multiplier` 是 `winType` 基础倍率（硬 2、软 1）乘当前玩家 `personalMultiplier`，范围当前为 1–32，但协议用 `number` 避免复制可变乘积联合类型。
- `remainingCount` 是 0–4 的公开推导值；0 仍保留。
- 投影只携带 UI 所需结果，不携带模拟分解或替代牌细节。

## 5. 服务端投影与公开剩余数量

在 `RoomService.project` 中：

1. 复用本次投影已经计算出的 `legalActions`。
2. 仅当房间处于 `PLAYING`、回合为 `TURN_DECISION`、当前成员是出牌者且 `legalActions` 含 `DISCARD_TILE` 时调用引擎 helper。
3. 为公开牌建立按物理 ID 去重的集合，再按牌种计数：
   - 当前玩家自己的完整手牌；
   - 所有玩家牌河；
   - 所有玩家已放赖；
   - 所有公开碰杠牌组（从 `meld.tileIds` + `meld.tileKind` 还原）；
   - 亮牌。
4. 同一物理牌可能同时残留在来源牌河并出现在碰杠牌组中；必须先按 ID 去重，不能直接按各数组长度相加。
5. 不读取 `round.wall`，也不读取其他玩家 `hand`，从而保证结果只代表公开可推导的最多剩余张数。
6. `remainingCount = max(0, 4 - visibleCountForKind)`。
7. `multiplier = (winType === "HARD" ? 2 : 1) * currentPlayer.personalMultiplier`。

空场景统一投影 `tingHints: []`，避免客户端保留旧回合提示。

## 6. 小程序展示与交互

### 6.1 数据映射

在房间页用 `useMemo` 把 `room.tingHints` 转为按 `discardTileId` 查询的 Map：

- 有非空 `waits` 的物理牌显示“听”标识。
- 当前 `selectedTileId` 命中 Map 时显示候选卡片。
- 选中普通非听牌时卡片消失。
- 权威投影进入新回合/新阶段后 `tingHints` 为空；同时沿用/补充 selection 清理，防止旧提示残留。

### 6.2 手牌槽

给普通手牌和摸牌槽复用一个轻量包装层：

- `MahjongTile` 继续负责牌面、选中态、赖子与碰杠高亮。
- 包装层在牌顶外部渲染小“听”标识，避免修改 `.mj-tile` 的 `overflow: hidden`。
- 所有现有 `onPress` 行为不变：第一次选择，第二次点同一普通牌仍直接出牌。

### 6.3 候选卡片

- 卡片位于手牌上方的专用紧凑横向轨道，并通过小箭头/水平锚点指向当前选中的物理牌。
- 根据选牌在手牌中的相对位置使用左/中/右对齐，避免首尾牌的卡片溢出安全区；候选过多时卡片内部横向滚动。
- 每项复用 SVG 牌面，文字显示例如：
  - `硬胡 4×`
  - `剩 2 张`
  - 0 张时显示 `已绝张`，并保留 `剩 0 张` 的可读含义。
- 候选牌种若为赖子，继续显示现有“赖”角标。
- 卡片出现时用它替代普通的“再点一次选中的牌即可打出”提示，避免重复占用纵向空间；普通选牌仍显示原提示。

## 7. 结算赖子样式修复

仅在 `RoundSettlementModal.scss` 的结算手牌作用域覆盖赖子样式：

- 移除结算小牌的外侧 `outline`；
- 保留右上角“赖”徽标作为明确身份；
- 保持普通牌边框、负边距扇形和所有游戏内其他赖子样式不变。

局部覆盖比修改全局 `.mj-tile--wildcard` 风险更低，也直接消除外轮廓伸入相邻牌造成的竖线。

## 8. 兼容性与回滚

- 协议变更为加字段并同步 schema version；旧持久化房间状态不变，因为 `tingHints` 只在投影时生成。
- 不新增命令、数据库字段、Socket 事件或可持久状态。
- 规则 helper 是只读分析，不修改 `RoundState`。
- 回滚时可独立删除 `tingHints` 投影和小程序 UI；结算 CSS 修复也可单独回滚。

## 9. 风险与控制

| 风险 | 控制 |
|---|---|
| 听牌结果与实际胡牌不一致 | 所有候选逐一调用现有 `evaluateWin`，并做正/负/赖子/碰后场景测试 |
| 泄露暗牌或牌墙 | 公开计数 helper 不接收 wall/opponent hand；服务测试构造不同隐藏状态并断言结果相同 |
| 碰牌来源弃牌重复计数 | 按物理 tile ID 去重后再统计 |
| 频繁投影计算开销 | 只为当前合法出牌者计算；最大约 14×27 次纯评估 |
| 横屏卡片遮挡或裁切 | 紧凑横向轨道、边缘对齐和内部滚动；微信开发者工具真机尺寸截图验证 |
| 与现有候场页 SCSS 修改冲突 | 只修改结算组件样式与实战手牌后段样式，提交前逐块检查现有未提交 diff |
