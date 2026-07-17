import type { Tile, TileKind } from "@huanghuang/protocol";

const SUIT_LABEL = { WAN: "万", TIAO: "条", TONG: "筒" } as const;
const TILE_ARTWORK_PREFIX = { WAN: "wan", TIAO: "tiao", TONG: "tong" } as const;
const TILE_ARTWORK = import.meta.glob<string>("../assets/tiles/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

export function tileArtworkFilename(tile: TileKind): string {
  return `${TILE_ARTWORK_PREFIX[tile.suit]}-${tile.rank}.svg`;
}

export function tileArtworkUrl(tile: TileKind): string {
  const assetPath = `../assets/tiles/${tileArtworkFilename(tile)}`;
  const artworkUrl = TILE_ARTWORK[assetPath];
  if (artworkUrl === undefined) throw new Error(`Missing tile artwork: ${assetPath}`);
  return artworkUrl;
}

function sameKind(tile: Tile, kind: TileKind | null): boolean {
  return kind !== null && tile.suit === kind.suit && tile.rank === kind.rank;
}

function TileFace({ tile }: { tile: Tile }) {
  return (
    <img
      className="tile-face-artwork"
      src={tileArtworkUrl(tile)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
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
  motion?: "drawn" | "discarded" | undefined;
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
  motion,
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
    motion === undefined ? "" : `motion-${motion}`,
  ]
    .filter(Boolean)
    .join(" ");
  const motionSuffix =
    motion === "drawn" ? "，本回合新摸" : motion === "discarded" ? "，刚刚打出" : "";
  const content = (
    <>
      <TileFace tile={tile} />
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
        aria-label={`${label}${wildcard ? "，赖子" : ""}${motionSuffix}${highlightSuffix}`}
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
      aria-label={`选择${label}${wildcard ? "，赖子" : ""}${motionSuffix}${onDoubleSelect === undefined ? "" : "，双击打出"}${highlightSuffix}`}
      onClick={() => onSelect(tile)}
      onDoubleClick={() => onDoubleSelect?.(tile)}
    >
      {content}
    </button>
  );
}
