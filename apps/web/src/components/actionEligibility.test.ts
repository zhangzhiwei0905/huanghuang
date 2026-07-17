import type {
  Meld,
  PlayerProjection,
  RoomProjection,
  Seat,
  Tile,
  TileKind,
} from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  concealedKongGroups,
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
  handHighlightGroups,
  pendingResponseTile,
} from "./actionEligibility.js";

function player(seat: Seat, overrides?: Partial<PlayerProjection>): PlayerProjection {
  return {
    seat,
    nickname: `玩家${seat + 1}`,
    controller: "HUMAN",
    connected: true,
    handCount: overrides?.hand?.length ?? 0,
    hand: [],
    melds: [],
    discards: [],
    releasedWildcards: [],
    personalMultiplier: 1,
    score: 0,
    ...overrides,
  };
}

function players(overrides?: Partial<Record<Seat, PlayerProjection>>): PlayerProjection[] {
  return [0, 1, 2, 3].map((seat) => overrides?.[seat as Seat] ?? player(seat as Seat));
}

function room(overrides?: Partial<RoomProjection>): RoomProjection {
  return {
    schemaVersion: 4,
    roomId: "room-1",
    roomCode: "123456",
    version: 1,
    baseScore: 2,
    mode: "FRIEND",
    stage: "PLAYING",
    roundId: "round-1",
    roundStartedAt: null,
    waitingExpiresAt: null,
    isOwner: false,
    selfReady: true,
    selfSeat: 0,
    selfDrawnTileId: null,
    status: "ACTIVE",
    closeReason: null,
    dissolveAfterRound: false,
    indicatorTile: null,
    wildcardKind: null,
    wallRemaining: 40,
    actingSeat: 0,
    currentSeat: 0,
    roundPhase: "TURN_DECISION",
    actionDeadlineAt: null,
    roundOutcome: null,
    roundSettlement: null,
    legalActions: [],
    players: players(),
    lobbySeats: [],
    ...overrides,
  };
}

function tile(suit: Tile["suit"], rank: Tile["rank"], id: string): Tile {
  return { id, suit, rank };
}

function meld(kind: Meld["kind"], tileKind: TileKind, id = "meld-1"): Meld {
  return {
    id,
    kind,
    tileIds: [`${tileKind.suit}-${tileKind.rank}-a`, `${tileKind.suit}-${tileKind.rank}-b`],
    tileKind,
    sourcePlayerId: null,
    sourceDiscardId: null,
    createdAtVersion: 1,
  };
}

describe("pendingResponseTile", () => {
  it("returns null outside DISCARD_RESPONSE", () => {
    const projection = room({ roundPhase: "TURN_DECISION" });
    expect(pendingResponseTile(projection)).toBeNull();
  });

  it("returns the discarder's last discard during DISCARD_RESPONSE", () => {
    const discardTile = tile("WAN", 5, "wan-5-0");
    const projection = room({
      roundPhase: "DISCARD_RESPONSE",
      currentSeat: 1,
      players: players({
        1: player(1, { discards: [tile("TIAO", 2, "tiao-2-0"), discardTile] }),
      }),
    });
    expect(pendingResponseTile(projection)).toEqual(discardTile);
  });
});

describe("concealedKongGroups", () => {
  it("excludes wildcard tiles from the group even when four are present", () => {
    const hand = [
      tile("TONG", 4, "tong-4-0"),
      tile("TONG", 4, "tong-4-1"),
      tile("TONG", 4, "tong-4-2"),
      tile("TONG", 4, "tong-4-3"),
    ];
    expect(concealedKongGroups(hand, { suit: "TONG", rank: 4 })).toEqual([]);
  });

  it("returns two groups when the hand contains two completed quads", () => {
    const hand = [
      tile("WAN", 3, "wan-3-0"),
      tile("WAN", 3, "wan-3-1"),
      tile("WAN", 3, "wan-3-2"),
      tile("WAN", 3, "wan-3-3"),
      tile("TIAO", 5, "tiao-5-0"),
      tile("TIAO", 5, "tiao-5-1"),
      tile("TIAO", 5, "tiao-5-2"),
      tile("TIAO", 5, "tiao-5-3"),
    ];
    const groups = concealedKongGroups(hand, null);
    expect(groups).toHaveLength(2);
    expect(groups.flat()).toHaveLength(8);
  });
});

describe("handHighlightGroups", () => {
  it("highlights nothing when not in DISCARD_RESPONSE and no kong/pong action is legal", () => {
    const self = player(0, { hand: [tile("WAN", 3, "wan-3-0")] });
    const projection = room({ roundPhase: "TURN_DECISION", legalActions: ["DISCARD_TILE"] });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.pongTileIds.size).toBe(0);
    expect(highlight.kongTileIds.size).toBe(0);
  });

  it("highlights the two matching tiles when a pong is legal", () => {
    const pendingTile = tile("TIAO", 6, "tiao-6-discard");
    const self = player(0, {
      hand: [tile("TIAO", 6, "tiao-6-0"), tile("TIAO", 6, "tiao-6-1"), tile("WAN", 1, "wan-1-0")],
    });
    const projection = room({
      roundPhase: "DISCARD_RESPONSE",
      currentSeat: 1,
      legalActions: ["CLAIM_PONG", "PASS_RESPONSE"],
      players: players({ 0: self, 1: player(1, { discards: [pendingTile] }) }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.pongTileIds).toEqual(new Set(["tiao-6-0", "tiao-6-1"]));
    expect(highlight.kongTileIds.size).toBe(0);
  });

  it("highlights the three matching tiles when an exposed kong is legal", () => {
    const pendingTile = tile("TIAO", 6, "tiao-6-discard");
    const self = player(0, {
      hand: [
        tile("TIAO", 6, "tiao-6-0"),
        tile("TIAO", 6, "tiao-6-1"),
        tile("TIAO", 6, "tiao-6-2"),
        tile("WAN", 1, "wan-1-0"),
      ],
    });
    const projection = room({
      roundPhase: "DISCARD_RESPONSE",
      currentSeat: 1,
      legalActions: ["CLAIM_EXPOSED_KONG", "CLAIM_PONG", "PASS_RESPONSE"],
      players: players({ 0: self, 1: player(1, { discards: [pendingTile] }) }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.kongTileIds).toEqual(new Set(["tiao-6-0", "tiao-6-1", "tiao-6-2"]));
  });

  it("highlights the two matching tiles when an indicator pong-kong is legal", () => {
    const pendingTile = tile("TIAO", 6, "tiao-6-discard");
    const self = player(0, {
      hand: [tile("TIAO", 6, "tiao-6-0"), tile("TIAO", 6, "tiao-6-1"), tile("WAN", 1, "wan-1-0")],
    });
    const projection = room({
      roundPhase: "DISCARD_RESPONSE",
      currentSeat: 1,
      legalActions: ["CLAIM_INDICATOR_PONG_KONG", "PASS_RESPONSE"],
      players: players({ 0: self, 1: player(1, { discards: [pendingTile] }) }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.pongTileIds).toEqual(new Set(["tiao-6-0", "tiao-6-1"]));
    expect(highlight.kongTileIds.size).toBe(0);
  });

  it("highlights both simultaneous concealed-kong groups", () => {
    const self = player(0, {
      hand: [
        tile("WAN", 3, "wan-3-0"),
        tile("WAN", 3, "wan-3-1"),
        tile("WAN", 3, "wan-3-2"),
        tile("WAN", 3, "wan-3-3"),
        tile("TIAO", 5, "tiao-5-0"),
        tile("TIAO", 5, "tiao-5-1"),
        tile("TIAO", 5, "tiao-5-2"),
        tile("TIAO", 5, "tiao-5-3"),
      ],
    });
    const projection = room({
      roundPhase: "TURN_DECISION",
      legalActions: ["DECLARE_CONCEALED_KONG"],
      players: players({ 0: self }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.kongTileIds.size).toBe(8);
  });

  it("does not highlight wildcard tiles as concealed-kong sources", () => {
    const self = player(0, {
      hand: [
        tile("TONG", 4, "tong-4-0"),
        tile("TONG", 4, "tong-4-1"),
        tile("TONG", 4, "tong-4-2"),
        tile("TONG", 4, "tong-4-3"),
      ],
    });
    const projection = room({
      roundPhase: "TURN_DECISION",
      legalActions: ["DECLARE_CONCEALED_KONG"],
      wildcardKind: { suit: "TONG", rank: 4 },
      players: players({ 0: self }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.kongTileIds.size).toBe(0);
  });

  it("highlights the added-kong source tile matching an existing PONG meld", () => {
    const self = player(0, {
      hand: [tile("TONG", 7, "tong-7-extra")],
      melds: [meld("PONG", { suit: "TONG", rank: 7 }, "meld-pong-7")],
    });
    const projection = room({
      roundPhase: "TURN_DECISION",
      legalActions: ["DECLARE_ADDED_KONG"],
      players: players({ 0: self }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.kongTileIds).toEqual(new Set(["tong-7-extra"]));
  });

  it("returns empty sets when the relevant action is not in legalActions", () => {
    const self = player(0, {
      hand: [tile("TONG", 7, "tong-7-extra")],
      melds: [meld("PONG", { suit: "TONG", rank: 7 }, "meld-pong-7")],
    });
    const projection = room({
      roundPhase: "TURN_DECISION",
      legalActions: ["DISCARD_TILE"],
      players: players({ 0: self }),
    });
    const highlight = handHighlightGroups(projection, self);
    expect(highlight.pongTileIds.size).toBe(0);
    expect(highlight.kongTileIds.size).toBe(0);
  });
});

describe("deriveConcealedKongPayload", () => {
  it("prefers the manually selected tile when it belongs to an eligible group", () => {
    const hand = [
      tile("WAN", 3, "wan-3-0"),
      tile("WAN", 3, "wan-3-1"),
      tile("WAN", 3, "wan-3-2"),
      tile("WAN", 3, "wan-3-3"),
      tile("TIAO", 5, "tiao-5-0"),
      tile("TIAO", 5, "tiao-5-1"),
      tile("TIAO", 5, "tiao-5-2"),
      tile("TIAO", 5, "tiao-5-3"),
    ];
    expect(deriveConcealedKongPayload(hand, null, "tiao-5-2")).toEqual({ suit: "TIAO", rank: 5 });
  });

  it("falls back to the first eligible group when nothing is selected", () => {
    const hand = [
      tile("WAN", 3, "wan-3-0"),
      tile("WAN", 3, "wan-3-1"),
      tile("WAN", 3, "wan-3-2"),
      tile("WAN", 3, "wan-3-3"),
    ];
    expect(deriveConcealedKongPayload(hand, null, null)).toEqual({ suit: "WAN", rank: 3 });
  });

  it("returns null when no group is eligible", () => {
    expect(deriveConcealedKongPayload([], null, null)).toBeNull();
  });
});

describe("deriveAddedKongPayload", () => {
  it("resolves the correct meldId for the source tile", () => {
    const hand = [tile("TONG", 7, "tong-7-extra")];
    const melds = [meld("PONG", { suit: "TONG", rank: 7 }, "meld-pong-7")];
    expect(deriveAddedKongPayload(hand, melds, null, null)).toEqual({
      meldId: "meld-pong-7",
      tileId: "tong-7-extra",
    });
  });

  it("prefers the manually selected tile when it is an eligible source", () => {
    const hand = [tile("TONG", 7, "tong-7-a"), tile("WAN", 2, "wan-2-a")];
    const melds = [
      meld("PONG", { suit: "TONG", rank: 7 }, "meld-pong-7"),
      meld("PONG", { suit: "WAN", rank: 2 }, "meld-pong-2"),
    ];
    expect(deriveAddedKongPayload(hand, melds, null, "wan-2-a")).toEqual({
      meldId: "meld-pong-2",
      tileId: "wan-2-a",
    });
  });

  it("excludes wildcard tiles from the candidate source tiles", () => {
    const hand = [tile("TONG", 7, "tong-7-extra")];
    const melds = [meld("PONG", { suit: "TONG", rank: 7 }, "meld-pong-7")];
    expect(deriveAddedKongPayload(hand, melds, { suit: "TONG", rank: 7 }, null)).toBeNull();
  });

  it("returns null when there is no matching PONG meld", () => {
    expect(deriveAddedKongPayload([], [], null, null)).toBeNull();
  });
});
