import type { Tile, TileKind } from "@huanghuang/protocol";
import { isWildcardTile } from "./actionButtons";

export type TilePressDecision =
  | { kind: "select"; tileId: string }
  | { kind: "discard"; tileId: string }
  | { kind: "keep-selection"; tileId: string }
  | { kind: "ignore" };

export function decideTilePress(input: {
  tile: Tile;
  selectedTileId: string | null;
  wildcardKind: TileKind | null;
  canDiscard: boolean;
  locked: boolean;
}): TilePressDecision {
  if (input.locked) return { kind: "ignore" };
  if (input.selectedTileId !== input.tile.id) {
    return { kind: "select", tileId: input.tile.id };
  }
  if (input.canDiscard && !isWildcardTile(input.tile, input.wildcardKind)) {
    return { kind: "discard", tileId: input.tile.id };
  }
  return { kind: "keep-selection", tileId: input.tile.id };
}
