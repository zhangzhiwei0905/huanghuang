import { describe, expect, it } from "vitest";
import { createTileSet, nextWildcardKind, shuffleTiles, tileKindKey } from "./tiles.js";

describe("tile set", () => {
  it("creates 108 unique physical tiles and four copies of each kind", () => {
    const tiles = createTileSet();
    expect(tiles).toHaveLength(108);
    expect(new Set(tiles.map((tile) => tile.id))).toHaveLength(108);
    const counts = new Map<string, number>();
    for (const tile of tiles) {
      const key = tileKindKey(tile);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 27 }, () => 4));
  });

  it("wraps a nine indicator to a rank-one wildcard", () => {
    expect(nextWildcardKind({ suit: "TONG", rank: 9 })).toEqual({ suit: "TONG", rank: 1 });
    expect(nextWildcardKind({ suit: "WAN", rank: 5 })).toEqual({ suit: "WAN", rank: 6 });
  });

  it("shuffles without losing physical tiles", () => {
    const tiles = createTileSet();
    let value = 17;
    const shuffled = shuffleTiles(tiles, (max) => {
      value = (value * 37 + 11) % 997;
      return value % max;
    });
    expect(shuffled.map((tile) => tile.id).sort()).toEqual(tiles.map((tile) => tile.id).sort());
    expect(shuffled.map((tile) => tile.id)).not.toEqual(tiles.map((tile) => tile.id));
  });
});
