import type { Tile, TileKind } from "@huanghuang/protocol";

const SUIT_LABEL = { WAN: "万", TIAO: "条", TONG: "筒" } as const;

export function tileLabel(tile: Pick<Tile, "suit" | "rank"> | TileKind): string {
  return `${tile.rank}${SUIT_LABEL[tile.suit]}`;
}

export function sortHand(tiles: Tile[]): Tile[] {
  const suitOrder = { WAN: 0, TIAO: 1, TONG: 2 } as const;
  return [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.id.localeCompare(b.id);
  });
}
