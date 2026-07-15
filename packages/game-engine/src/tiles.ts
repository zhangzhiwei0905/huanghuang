import {
  TILE_RANKS,
  TILE_SUITS,
  type Tile,
  type TileKind,
  type TileRank,
  type TileSuit,
} from "@huanghuang/protocol";

export type RandomInt = (maxExclusive: number) => number;

export function tileKindKey(kind: TileKind): string {
  return `${kind.suit}:${kind.rank}`;
}

export function sameTileKind(left: TileKind, right: TileKind): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

export function createTileSet(): Tile[] {
  const tiles: Tile[] = [];
  for (const suit of TILE_SUITS) {
    for (const rank of TILE_RANKS) {
      for (let copy = 0; copy < 4; copy += 1) {
        tiles.push({
          id: `${suit}-${rank}-${copy}`,
          suit,
          rank,
        });
      }
    }
  }
  return tiles;
}

export function nextWildcardKind(indicator: TileKind): TileKind {
  const nextRank = (indicator.rank === 9 ? 1 : indicator.rank + 1) as TileRank;
  return { suit: indicator.suit, rank: nextRank };
}

export function shuffleTiles(tiles: readonly Tile[], randomInt: RandomInt): Tile[] {
  const shuffled = [...tiles];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`Random index ${swapIndex} is outside 0..${index}`);
    }
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current === undefined || replacement === undefined) {
      throw new Error("Tile shuffle reached an impossible index");
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

export function allTileKinds(): TileKind[] {
  const kinds: TileKind[] = [];
  for (const suit of TILE_SUITS) {
    for (const rank of TILE_RANKS) {
      kinds.push({ suit, rank });
    }
  }
  return kinds;
}

export function compareTileKinds(left: TileKind, right: TileKind): number {
  const suitOrder: Record<TileSuit, number> = { WAN: 0, TIAO: 1, TONG: 2 };
  return suitOrder[left.suit] - suitOrder[right.suit] || left.rank - right.rank;
}
