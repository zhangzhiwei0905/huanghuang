import type { Tile, TileKind } from "@huanghuang/protocol";

const SUIT_LABEL = { WAN: "万", TIAO: "条", TONG: "筒" } as const;
const WAN_RANKS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

function sameKind(tile: Tile, kind: TileKind | null): boolean {
  return kind !== null && tile.suit === kind.suit && tile.rank === kind.rank;
}

function TileFace({ tile }: { tile: Tile }) {
  if (tile.suit === "WAN") {
    return (
      <span className="tile-face tile-face-wan" aria-hidden="true">
        <strong>{WAN_RANKS[tile.rank]}</strong>
        <em>萬</em>
      </span>
    );
  }

  return (
    <span className={`tile-face tile-face-${tile.suit.toLowerCase()}`} aria-hidden="true">
      <span className="tile-motif-grid">
        {Array.from({ length: tile.rank }, (_, position) => (
          <i key={`${tile.id}-mark-${position}`} />
        ))}
      </span>
    </span>
  );
}

type MahjongTileProps = {
  tile: Tile;
  wildcardKind?: TileKind | null;
  indicator?: boolean;
  selected?: boolean;
  compact?: boolean;
  disabled?: boolean;
  /** Visual + accessible hint that this tile is a legal pong/kong source. */
  highlighted?: boolean;
  /** Accessible label suffix describing why the tile is highlighted, e.g. "可碰"/"可杠". */
  highlightHint?: string | undefined;
  onSelect?: (tile: Tile) => void;
  onDoubleSelect?: (tile: Tile) => void;
};

export function MahjongTile({
  tile,
  wildcardKind = null,
  indicator = false,
  selected = false,
  compact = false,
  disabled = false,
  highlighted = false,
  highlightHint,
  onSelect,
  onDoubleSelect,
}: MahjongTileProps) {
  const wildcard = sameKind(tile, wildcardKind);
  const label = `${tile.rank}${SUIT_LABEL[tile.suit]}`;
  const highlightSuffix = highlighted && highlightHint !== undefined ? `，${highlightHint}` : "";
  const className = [
    "mahjong-tile",
    `tile-${tile.suit.toLowerCase()}`,
    `tile-rank-${tile.rank}`,
    wildcard ? "is-wildcard" : "",
    indicator ? "is-indicator" : "",
    selected ? "is-selected" : "",
    compact ? "is-compact" : "",
    highlighted ? "is-highlighted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="tile-corner-rank" aria-hidden="true">
        {tile.rank}
      </span>
      <TileFace tile={tile} />
      <span className="tile-corner-suit" aria-hidden="true">
        {SUIT_LABEL[tile.suit]}
      </span>
      {wildcard ? (
        <span className="tile-badge" aria-hidden="true">
          赖
        </span>
      ) : null}
    </>
  );

  if (onSelect === undefined) {
    return (
      <span
        className={className}
        aria-label={`${label}${wildcard ? "，赖子" : ""}${highlightSuffix}`}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`选择${label}${wildcard ? "，赖子" : ""}${onDoubleSelect === undefined ? "" : "，双击打出"}${highlightSuffix}`}
      onClick={() => onSelect(tile)}
      onDoubleClick={() => onDoubleSelect?.(tile)}
    >
      {content}
    </button>
  );
}
