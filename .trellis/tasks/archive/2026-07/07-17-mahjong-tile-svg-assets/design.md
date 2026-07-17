# Design — 上游麻将牌面 SVG 适配

## Source and Boundaries

- 唯一视觉来源为 [`lietxia/mahjong_graphic`](https://github.com/lietxia/mahjong_graphic) 的透明背景 SVG 目录。
- 锁定提交：`3e275804ff58325306710bef3a7406860444bc6a`。
- 源文件映射：`1m..9m → wan-1..9`、`1s..9s → tiao-1..9`、`1p..9p → tong-1..9`。
- 不改变上游路径、圆形或分组数据；仅改变根画布、添加统一变换、映射颜色和重命名文件。
- 不改变服务端、协议、玩法逻辑或 `MahjongTile` 的外部 props；只替换组件内部牌面渲染和中央赖子展示。

## Adaptation Contract

### Canvas

上游统一使用 `viewBox="0 0 19 26"`。目标统一使用 `viewBox="0 0 240 320"`，并将完整上游坐标系包裹在：

```svg
<g transform="translate(16 17.684211) scale(10.947368)">
```

该变换把上游画布映射到 `x=16..224`、`y≈17.68..302.32`，保持原始 19:26 比例并满足约 16px 安全边距。

### Color mapping

| Suit | Upstream | Target |
|---|---|---|
| Wan | `#881c21` | `#9b4038` |
| Wan | `#231815` | `#405d70` |
| Tiao | `#005529`, `#231815` | `#2d6653` |
| Tiao | `#881c21` | `#967335` |
| Tong | `#011833` | `#405d70` |
| Tong | `#881c21` | `#967335` |

## Import Pipeline

- 任务内导入脚本接收上游仓库路径，不自行生成牌面。
- 脚本读取 27 个透明 SVG，验证源 `viewBox`，提取根节点内部内容，执行固定颜色映射后包入目标根节点与变换组。
- 输出文件完全自包含；上游 `<defs><style>`、路径、圆形和分组保留在文件内部。
- 校验脚本同时检查文件集合、禁用元素、外部引用、允许颜色和来源标记。

## Frontend Rendering

- `MahjongTile.tsx` 通过 Vite 的 eager `import.meta.glob` 建立 27 个静态资源 URL 映射，构建时纳入全部 SVG，不产生运行时网络路径拼接。
- 一个纯函数把 `TileKind` 映射为 `wan|tiao|tong-rank.svg` 文件名；资源缺失时立即抛错，避免静默退回旧样式。
- `MahjongTile` 内部只渲染装饰性 `<img alt="">`，外层 `span`／`button`、交互状态和 `aria-label` 保持不变。
- `GameTable` 将 `wildcardKind` 转为仅用于展示的虚拟 `Tile`，交给紧凑型 `MahjongTile`；`indicatorTile` 保持现有 `MahjongTile` 链路。
- CSS 删除旧 `.tile-corner-*`、`.tile-motif-grid` 和文字万字规则，改为一条统一的 `.tile-face-artwork` 填充规则；特殊牌揭示动画同时指向亮牌与赖子处的 `.mahjong-tile`。

## License and Provenance

- 上游 LICENSE 允许使用、复制、修改和分发，包含商业及非商业用途，无担保。
- `research/source.md` 记录仓库 URL、锁定提交、目录、许可链接、映射与适配范围。
- 许可未要求在每个 SVG 内嵌署名；生产文件仅加入简短来源注释，完整信息留在任务记录。

## Trade-offs

- 保留上游复杂路径会增加文件体积，但这是用户明确选择，且能获得成熟一致的麻将图形。
- 颜色映射继续满足项目最初的主题色要求，同时不改变上游造型。
- 使用统一外层变换而非改写每个路径坐标，可证明路径数据未被重新绘制并降低适配错误。

## Validation and Rollback

- 比较源／目标的矢量元素数量与路径 `d` 数据，确认只发生允许的包装和颜色变化。
- 使用 XML、结构、颜色与文件映射校验，并渲染大／小尺寸总览。
- 回滚涉及 27 个目标 SVG、`MahjongTile` 的牌面渲染、中央赖子 JSX 与对应 CSS；不触碰协议和玩法逻辑。
