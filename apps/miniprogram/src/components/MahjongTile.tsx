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
  onPress?: (tile: Tile) => void;
};

export function MahjongTile({
  tile,
  selected = false,
  dimmed = false,
  compact = false,
  wildcardKind = null,
  onPress,
}: MahjongTileProps) {
  const wildcard = isWildcardTile(tile, wildcardKind);
  const className = [
    "mj-tile",
    compact ? "mj-tile--compact" : "",
    selected ? "mj-tile--selected" : "",
    dimmed ? "mj-tile--dimmed" : "",
    wildcard ? "mj-tile--wildcard" : "",
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
    </View>
  );
}
