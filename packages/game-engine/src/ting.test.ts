import type { Meld, Tile, TileKind } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { analyzeDiscardTingOptions } from "./ting.js";

let tileSequence = 0;
const tile = (suit: TileKind["suit"], rank: TileKind["rank"], id?: string): Tile => ({
  id: id ?? `ting-test-${tileSequence++}`,
  suit,
  rank,
});

const triplet = (suit: TileKind["suit"], rank: TileKind["rank"]): Tile[] => [
  tile(suit, rank),
  tile(suit, rank),
  tile(suit, rank),
];

function standardTingHand(extraTile: Tile): Tile[] {
  return [
    tile("WAN", 1),
    tile("WAN", 2),
    tile("WAN", 3),
    tile("WAN", 4),
    tile("WAN", 5),
    tile("WAN", 6),
    tile("TIAO", 2),
    tile("TIAO", 3),
    tile("TIAO", 4),
    tile("TONG", 1, "tong-1-a"),
    tile("TONG", 2),
    tile("TONG", 3),
    tile("TIAO", 9),
    extraTile,
  ];
}

function optionFor(hand: Tile[], discardTileId: string, wildcardKind: TileKind) {
  return analyzeDiscardTingOptions({
    concealedTiles: hand,
    melds: [],
    wildcardKind,
  }).find((option) => option.discardTileId === discardTileId);
}

describe("discard ting analysis", () => {
  it("finds hard and wildcard-assisted soft waits after a physical discard", () => {
    const discarded = tile("TONG", 7, "discard-me");
    const wildcardKind: TileKind = { suit: "WAN", rank: 9 };
    const option = optionFor(standardTingHand(discarded), discarded.id, wildcardKind);

    expect(option?.waits).toContainEqual({
      tileKind: { suit: "TIAO", rank: 9 },
      winType: "HARD",
    });
    expect(option?.waits).toContainEqual({
      tileKind: wildcardKind,
      winType: "SOFT",
    });
  });

  it("projects both natural-pair hard waits and the wildcard soft wait", () => {
    const discard = tile("TONG", 9, "two-pair-discard");
    const wildcardKind: TileKind = { suit: "WAN", rank: 5 };
    const hand = [
      ...triplet("WAN", 1),
      ...triplet("TIAO", 2),
      ...triplet("TONG", 3),
      tile("WAN", 7),
      tile("WAN", 7),
      tile("TIAO", 9),
      tile("TIAO", 9),
      discard,
    ];
    const option = optionFor(hand, discard.id, wildcardKind);

    expect(option?.waits).toContainEqual({
      tileKind: { suit: "WAN", rank: 7 },
      winType: "HARD",
    });
    expect(option?.waits).toContainEqual({
      tileKind: { suit: "TIAO", rank: 9 },
      winType: "HARD",
    });
    expect(option?.waits).toContainEqual({ tileKind: wildcardKind, winType: "SOFT" });
  });

  it("keeps identical physical discard choices addressable by tile id", () => {
    const duplicate = tile("TONG", 1, "tong-1-b");
    const options = analyzeDiscardTingOptions({
      concealedTiles: standardTingHand(duplicate),
      melds: [],
      wildcardKind: { suit: "WAN", rank: 9 },
    });

    expect(
      options.find((option) => option.discardTileId === "tong-1-a")?.waits.length,
    ).toBeGreaterThan(0);
    expect(
      options.find((option) => option.discardTileId === "tong-1-b")?.waits.length,
    ).toBeGreaterThan(0);
  });

  it("does not offer a second wildcard when the post-discard hand already has one", () => {
    const wildcardKind: TileKind = { suit: "WAN", rank: 5 };
    const discarded = tile("TONG", 1, "soft-discard");
    const hand = [
      tile("TONG", 2),
      tile("WAN", 5, "held-wildcard"),
      tile("TONG", 4),
      ...triplet("WAN", 1),
      ...triplet("TIAO", 6),
      tile("TONG", 8),
      tile("TONG", 8),
      tile("WAN", 9),
      tile("WAN", 9),
      discarded,
    ];
    const option = optionFor(hand, discarded.id, wildcardKind);

    expect(option?.waits).toContainEqual({
      tileKind: { suit: "TONG", rank: 8 },
      winType: "SOFT",
    });
    expect(option?.waits.some((wait) => sameKind(wait.tileKind, wildcardKind))).toBe(false);
  });

  it("supports the shorter concealed hand after a pong", () => {
    const discarded = tile("TONG", 7, "post-pong-discard");
    const meld: Meld = {
      id: "pong-1",
      kind: "PONG",
      tileIds: ["pong-a", "pong-b", "pong-c"],
      tileKind: { suit: "TONG", rank: 2 },
      sourcePlayerId: "seat-1",
      sourceDiscardId: "discard-1",
      createdAtVersion: 2,
    };
    const wildcardKind: TileKind = { suit: "TIAO", rank: 9 };
    const hand = [
      tile("WAN", 1),
      tile("WAN", 2),
      tile("WAN", 3),
      tile("WAN", 4),
      tile("WAN", 5),
      tile("WAN", 6),
      tile("WAN", 7),
      tile("WAN", 8),
      tile("WAN", 9),
      tile("TIAO", 5),
      discarded,
    ];
    const option = analyzeDiscardTingOptions({
      concealedTiles: hand,
      melds: [meld],
      wildcardKind,
    }).find((candidate) => candidate.discardTileId === discarded.id);

    expect(option?.waits).toContainEqual({
      tileKind: { suit: "TIAO", rank: 5 },
      winType: "HARD",
    });
    expect(option?.waits).toContainEqual({ tileKind: wildcardKind, winType: "SOFT" });
  });

  it("keeps non-ting discards as empty options and never offers the wildcard as a discard", () => {
    const wildcardKind: TileKind = { suit: "WAN", rank: 9 };
    const wildcard = tile("WAN", 9, "wildcard-discard");
    const hand = standardTingHand(tile("TONG", 7, "known-ting-discard"));
    hand[0] = wildcard;
    const options = analyzeDiscardTingOptions({
      concealedTiles: hand,
      melds: [],
      wildcardKind,
    });

    expect(options.some((option) => option.discardTileId === wildcard.id)).toBe(false);
    expect(options.some((option) => option.waits.length === 0)).toBe(true);
  });
});

function sameKind(left: TileKind, right: TileKind): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}
