import type { Tile, TileKind } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { evaluateWin } from "./win.js";

let tileSequence = 0;
const tile = (suit: TileKind["suit"], rank: TileKind["rank"]): Tile => ({
  id: `test-${tileSequence++}`,
  suit,
  rank,
});

const triplet = (suit: TileKind["suit"], rank: TileKind["rank"]): Tile[] => [
  tile(suit, rank),
  tile(suit, rank),
  tile(suit, rank),
];

describe("win evaluation", () => {
  it("recognizes a hard standard win without a wildcard", () => {
    const hand = [
      tile("WAN", 1),
      tile("WAN", 2),
      tile("WAN", 3),
      tile("WAN", 4),
      tile("WAN", 5),
      tile("WAN", 6),
      tile("TIAO", 2),
      tile("TIAO", 3),
      tile("TIAO", 4),
      ...triplet("TONG", 7),
      tile("TIAO", 9),
      tile("TIAO", 9),
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 9 },
      winningTileId: hand.at(-1)!.id,
    });
    expect(result.canWin).toBe(true);
    expect(result.winType).toBe("HARD");
  });

  it("prioritizes hard win when the wildcard is used as its original face", () => {
    const wildcard = tile("WAN", 5);
    const hand = [
      tile("WAN", 3),
      tile("WAN", 4),
      wildcard,
      ...triplet("WAN", 7),
      ...triplet("TIAO", 2),
      ...triplet("TONG", 8),
      tile("TONG", 1),
      tile("TONG", 1),
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 5 },
      winningTileId: hand.at(-1)!.id,
    });
    expect(result.winType).toBe("HARD");
    expect(result.wildcardUsedAsSubstitute).toBe(false);
  });

  it("recognizes a soft win when one wildcard completes a sequence", () => {
    const wildcard = tile("WAN", 5);
    const winning = tile("TONG", 8);
    const hand = [
      tile("TONG", 2),
      wildcard,
      tile("TONG", 4),
      ...triplet("WAN", 1),
      ...triplet("TIAO", 6),
      ...triplet("TONG", 8).slice(0, 2),
      winning,
      tile("WAN", 9),
      tile("WAN", 9),
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 5 },
      winningTileId: winning.id,
    });
    expect(result.canWin).toBe(true);
    expect(result.winType).toBe("SOFT");
    expect(result.wildcardSubstituteKind).toEqual({ suit: "TONG", rank: 3 });
  });

  it("recognizes two natural pairs plus a drawn wildcard as a soft standard win", () => {
    const wildcard = tile("WAN", 5);
    const hand = [
      ...triplet("WAN", 1),
      ...triplet("TIAO", 2),
      ...triplet("TONG", 3),
      tile("WAN", 7),
      tile("WAN", 7),
      tile("TIAO", 9),
      tile("TIAO", 9),
      wildcard,
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 5 },
      winningTileId: wildcard.id,
    });

    expect(result.canWin).toBe(true);
    expect(result.winType).toBe("SOFT");
    expect(result.wildcardUsedAsSubstitute).toBe(true);
    expect(result.wildcardSubstituteKind).toEqual({ suit: "WAN", rank: 7 });
  });

  it("recognizes drawing either natural pair kind as a hard win", () => {
    for (const completedPair of [
      { suit: "WAN", rank: 7 },
      { suit: "TIAO", rank: 9 },
    ] as const) {
      const winning = tile(completedPair.suit, completedPair.rank);
      const hand = [
        ...triplet("WAN", 1),
        ...triplet("TIAO", 2),
        ...triplet("TONG", 3),
        tile("WAN", 7),
        tile("WAN", 7),
        tile("TIAO", 9),
        tile("TIAO", 9),
        winning,
      ];
      const result = evaluateWin({
        concealedTiles: hand,
        melds: [],
        wildcardKind: { suit: "WAN", rank: 5 },
        winningTileId: winning.id,
      });

      expect(result.canWin).toBe(true);
      expect(result.winType).toBe("HARD");
    }
  });

  it("rejects more than one wildcard", () => {
    const hand = [
      tile("WAN", 5),
      tile("WAN", 5),
      ...triplet("WAN", 1),
      ...triplet("TIAO", 2),
      ...triplet("TONG", 3),
      tile("WAN", 7),
      tile("WAN", 8),
      tile("WAN", 9),
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 5 },
      winningTileId: hand.at(-1)!.id,
    });
    expect(result.canWin).toBe(false);
    expect(result.rejectionCode).toBe("TOO_MANY_WILDCARDS");
  });

  it("rejects the forbidden any-tile pair formed by wildcard and winning tile", () => {
    const wildcard = tile("WAN", 5);
    const winning = tile("TONG", 9);
    const hand = [
      ...triplet("WAN", 1),
      ...triplet("WAN", 2),
      ...triplet("TIAO", 3),
      ...triplet("TONG", 4),
      wildcard,
      winning,
    ];
    const result = evaluateWin({
      concealedTiles: hand,
      melds: [],
      wildcardKind: { suit: "WAN", rank: 5 },
      winningTileId: winning.id,
    });
    expect(result.canWin).toBe(false);
    expect(result.rejectionCode).toBe("NO_STANDARD_WIN");
  });
});
