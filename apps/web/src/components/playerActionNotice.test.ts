import type { Meld, PlayerProjection, Seat, Tile } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { createPlayerActionSnapshot, detectPlayerActionNotice } from "./playerActionNotice.js";

function player(
  seat: Seat,
  options?: { melds?: Meld[]; releasedWildcards?: Tile[] },
): PlayerProjection {
  return {
    seat,
    nickname: `玩家${seat + 1}`,
    avatarUrl: null,
    controller: "HUMAN",
    connected: true,
    handCount: 0,
    hand: null,
    melds: options?.melds ?? [],
    discards: [],
    releasedWildcards: options?.releasedWildcards ?? [],
    personalMultiplier: 1,
    score: 0,
  };
}

function players(overrides?: Partial<Record<Seat, PlayerProjection>>): PlayerProjection[] {
  return [0, 1, 2, 3].map((seat) => overrides?.[seat as Seat] ?? player(seat as Seat));
}

function meld(kind: Meld["kind"], count: number): Meld {
  return {
    id: "meld-1",
    kind,
    tileIds: Array.from({ length: count }, (_, index) => `tiao-3-${index}`),
    tileKind: { suit: "TIAO", rank: 3 },
    sourcePlayerId: null,
    sourceDiscardId: null,
    createdAtVersion: 1,
  };
}

describe("player action notice", () => {
  it("shows three matching tiles for a new pong", () => {
    const before = players();
    const after = players({ 2: player(2, { melds: [meld("PONG", 3)] }) });

    expect(detectPlayerActionNotice(createPlayerActionSnapshot(before), after)).toEqual({
      seat: 2,
      action: "PONG",
      tiles: [
        { id: "tiao-3-0", suit: "TIAO", rank: 3 },
        { id: "tiao-3-1", suit: "TIAO", rank: 3 },
        { id: "tiao-3-2", suit: "TIAO", rank: 3 },
      ],
    });
  });

  it("shows four tiles when an existing pong becomes an added kong", () => {
    const before = players({ 1: player(1, { melds: [meld("PONG", 3)] }) });
    const after = players({ 1: player(1, { melds: [meld("ADDED_KONG", 4)] }) });

    const notice = detectPlayerActionNotice(createPlayerActionSnapshot(before), after);

    expect(notice?.action).toBe("ADDED_KONG");
    expect(notice?.tiles).toHaveLength(4);
  });

  it("shows only the newly released wildcard tile", () => {
    const firstWildcard: Tile = { id: "tong-2-0", suit: "TONG", rank: 2 };
    const secondWildcard: Tile = { id: "tong-2-1", suit: "TONG", rank: 2 };
    const before = players({ 3: player(3, { releasedWildcards: [firstWildcard] }) });
    const after = players({
      3: player(3, { releasedWildcards: [firstWildcard, secondWildcard] }),
    });

    expect(detectPlayerActionNotice(createPlayerActionSnapshot(before), after)).toEqual({
      seat: 3,
      action: "RELEASE_WILDCARD",
      tiles: [secondWildcard],
    });
  });
});
