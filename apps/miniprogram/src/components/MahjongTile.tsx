import { Image, Text, View } from "@tarojs/components";
import type { Tile, TileKind } from "@huanghuang/protocol";
import { isWildcardTile, tileArtworkUrl } from "../lib/tileArt";
import "./MahjongTile.scss";

type MahjongTileProps = {
  tile: Tile;
  selected?: boolean;
  dimmed?: boolean;
  compact?: boolean;
  wildcardKind?: TileKind | null;
  /** Marks this tile as a legal pong/kong source given the current room state. */
  highlighted?: boolean;
  /** Marks the most recent discard on the table (drop-in emphasis). */
  recent?: boolean;
  /** Short label shown on a highlighted tile, e.g. "可碰" / "可杠". */
  highlightHint?: string;
  onPress?: (tile: Tile) => void;
};

export function MahjongTile({
  tile,
  selected = false,
  dimmed = false,
  compact = false,
  wildcardKind = null,
  highlighted = false,
  recent = false,
  highlightHint,
  onPress,
}: MahjongTileProps) {
  const wildcard = isWildcardTile(tile, wildcardKind);
  const className = [
    "mj-tile",
    compact ? "mj-tile--compact" : "",
    selected ? "mj-tile--selected" : "",
    dimmed ? "mj-tile--dimmed" : "",
    wildcard ? "mj-tile--wildcard" : "",
    highlighted ? "mj-tile--highlighted" : "",
    recent ? "mj-tile--recent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <View
      className={className}
      onClick={() => {
        onPress?.(tile);
      }}
    >
      <Image className="mj-tile__face" src={tileArtworkUrl(tile)} mode="aspectFit" />
      {wildcard ? <Text className="mj-tile__badge">赖</Text> : null}
      {highlighted && highlightHint !== undefined ? (
        <Text className="mj-tile__hint">{highlightHint}</Text>
      ) : null}
    </View>
  );
}
