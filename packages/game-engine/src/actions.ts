import type { Tile, TileKind } from "@huanghuang/protocol";
import { sameTileKind, tileKindKey } from "./tiles.js";

export function discardableTileIds(hand: readonly Tile[], wildcardKind: TileKind): string[] {
  return hand.filter((tile) => !sameTileKind(tile, wildcardKind)).map((tile) => tile.id);
}

export function releasableWildcardIds(options: {
  hand: readonly Tile[];
  wildcardKind: TileKind;
  wallRemaining: number;
}): string[] {
  if (options.wallRemaining <= 0) {
    return [];
  }
  return options.hand
    .filter((tile) => sameTileKind(tile, options.wildcardKind))
    .map((tile) => tile.id);
}

export function concealedKongKinds(options: {
  hand: readonly Tile[];
  wildcardKind: TileKind;
  wallRemaining: number;
}): TileKind[] {
  if (options.wallRemaining <= 0) {
    return [];
  }
  const groups = new Map<string, Tile[]>();
  for (const tile of options.hand) {
    if (sameTileKind(tile, options.wildcardKind)) {
      continue;
    }
    const key = tileKindKey(tile);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [tile]);
    } else {
      existing.push(tile);
    }
  }
  return [...groups.values()]
    .filter((tiles) => tiles.length === 4)
    .map((tiles) => {
      const tile = tiles[0];
      if (tile === undefined) {
        throw new Error("A four-tile group cannot be empty");
      }
      return { suit: tile.suit, rank: tile.rank };
    });
}
