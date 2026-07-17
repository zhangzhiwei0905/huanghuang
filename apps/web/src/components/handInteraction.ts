import type { Tile, TileKind } from "@huanghuang/protocol";
import { isWildcardTile } from "./actionButtons.js";

export type TilePressDecision =
  | { kind: "select"; tileId: string }
  | { kind: "discard"; tileId: string }
  | { kind: "keep-selection"; tileId: string }
  | { kind: "ignore" };

type TilePressInput = {
  tile: Tile;
  selectedTileId: string | null;
  wildcardKind: TileKind | null;
  canDiscard: boolean;
  locked: boolean;
};

export function decideTilePress({
  tile,
  selectedTileId,
  wildcardKind,
  canDiscard,
  locked,
}: TilePressInput): TilePressDecision {
  if (locked) return { kind: "ignore" };
  if (selectedTileId !== tile.id) return { kind: "select", tileId: tile.id };
  if (canDiscard && !isWildcardTile(tile, wildcardKind)) {
    return { kind: "discard", tileId: tile.id };
  }
  return { kind: "keep-selection", tileId: tile.id };
}
