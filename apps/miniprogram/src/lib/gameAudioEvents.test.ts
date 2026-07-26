import type {
  Meld,
  PlayerProjection,
  RoomProjection,
  RoundSettlementProjection,
  Seat,
  Tile,
} from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  createGameAudioSnapshot,
  createGameAudioTracker,
  detectGameAudioFiles,
  tileAudioFileName,
  updateGameAudioTracker,
  voiceMessageAudioFileName,
} from "./gameAudioEvents.js";

function player(seat: Seat, overrides: Partial<PlayerProjection> = {}): PlayerProjection {
  return {
    seat,
    nickname: `玩家${seat + 1}`,
    avatarUrl: null,
    controller: "HUMAN",
    connected: true,
    handCount: 13,
    hand: null,
    melds: [],
    discards: [],
    releasedWildcards: [],
    personalMultiplier: 1,
    score: 0,
    ...overrides,
  };
}

function settlement(
  kind: "WIN" | "DRAW",
  winType: "HARD" | "SOFT" = "HARD",
): RoundSettlementProjection {
  return {
    roundId: "round-1",
    kind,
    winnerSeat: kind === "WIN" ? 0 : null,
    winType: kind === "WIN" ? winType : null,
    baseScore: 2,
    winBaseMultiplier: kind === "WIN" ? 2 : null,
    winnerMultiplier: kind === "WIN" ? 1 : null,
    nextDealerSeat: 0,
    payments: [],
    finalHands: [],
    scoreChanges: [],
  };
}

function room(overrides: Partial<RoomProjection> = {}): RoomProjection {
  return {
    schemaVersion: 5,
    roomId: "room-1",
    roomCode: "1234",
    version: 1,
    baseScore: 2,
    turnTimeoutSeconds: 20,
    botDifficulty: "HIGH",
    mode: "FRIEND",
    stage: "PLAYING",
    roundId: "round-1",
    roundStartedAt: "2026-07-26T00:00:00.000Z",
    waitingExpiresAt: null,
    isOwner: true,
    selfRole: "PLAYER",
    selfReady: false,
    selfSeat: 0,
    selfDrawnTileId: null,
    status: "ACTIVE",
    closeReason: null,
    dissolveAfterRound: false,
    indicatorTile: null,
    wildcardKind: null,
    wallRemaining: 55,
    actingSeat: 0,
    currentSeat: 0,
    roundPhase: "TURN_DECISION",
    actionDeadlineAt: null,
    roundOutcome: null,
    roundSettlement: null,
    legalActions: [],
    tingHints: [],
    players: [player(0), player(1), player(2), player(3)],
    lobbySeats: [],
    spectators: [],
    ...overrides,
  };
}

function tile(id: string, suit: Tile["suit"], rank: Tile["rank"]): Tile {
  return { id, suit, rank };
}

function meld(id: string, kind: Meld["kind"]): Meld {
  return {
    id,
    kind,
    tileIds: ["a", "b", "c"],
    tileKind: { suit: "TIAO", rank: 3 },
    sourcePlayerId: null,
    sourceDiscardId: null,
    createdAtVersion: 2,
  };
}

describe("game audio projection events", () => {
  it("maps every suit to its matching tile file", () => {
    expect(tileAudioFileName(tile("a", "WAN", 1))).toBe("tile-wan-1.mp3");
    expect(tileAudioFileName(tile("b", "TIAO", 5))).toBe("tile-tiao-5.mp3");
    expect(tileAudioFileName(tile("c", "TONG", 9))).toBe("tile-tong-9.mp3");
  });

  it("detects a new discard even when the pile length stays unchanged", () => {
    const before = room({
      players: [player(0, { discards: [tile("old", "WAN", 1)] }), player(1), player(2), player(3)],
    });
    const after = room({
      version: 2,
      players: [player(0, { discards: [tile("new", "TONG", 8)] }), player(1), player(2), player(3)],
    });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), after)).toEqual([
      "tile-tong-8.mp3",
    ]);
  });

  it.each([
    ["PONG", "action-pong.mp3"],
    ["EXPOSED_KONG", "action-kong.mp3"],
    ["CONCEALED_KONG", "action-kong.mp3"],
    ["INDICATOR_PONG_KONG", "chaotiangang.mp3"],
    ["ADDED_KONG", "action-added-kong.mp3"],
  ] as const)("maps %s to %s", (kind, fileName) => {
    const before = room();
    const after = room({
      version: 2,
      players: [player(0), player(1, { melds: [meld("meld-1", kind)] }), player(2), player(3)],
    });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), after)).toEqual([fileName]);
  });

  it("detects wildcard release and a new win but keeps a draw silent", () => {
    const before = room();
    const released = room({
      version: 2,
      players: [
        player(0),
        player(1),
        player(2, { releasedWildcards: [tile("wild", "WAN", 2)] }),
        player(3),
      ],
    });
    const wonHard = room({ version: 2, roundSettlement: settlement("WIN", "HARD") });
    const wonSoft = room({ version: 2, roundSettlement: settlement("WIN", "SOFT") });
    const drawn = room({ version: 2, roundSettlement: settlement("DRAW") });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), released)).toEqual([
      "action-release-wildcard.mp3",
    ]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), wonHard)).toEqual([
      "yinghu.mp3",
    ]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), wonSoft)).toEqual([
      "ruanhu.mp3",
    ]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), drawn)).toEqual([]);
  });

  it("maps quick voice-message text to its matching audio file", () => {
    expect(voiceMessageAudioFileName("搞快点搞快点")).toBe("gaokuaidian.mp3");
    expect(voiceMessageAudioFileName("我已经听牌啦")).toBe("woyijingtingle.mp3");
    expect(voiceMessageAudioFileName("随便聊两句")).toBeNull();
  });

  it("stays silent on initial load and the first projection after reconnect", () => {
    const tracker = createGameAudioTracker();
    const initial = room();
    const disconnectedUpdate = room({
      version: 2,
      players: [
        player(0, { discards: [tile("first", "WAN", 3)] }),
        player(1),
        player(2),
        player(3),
      ],
    });
    const reconnectedUpdate = room({
      version: 3,
      players: [
        player(0, {
          discards: [tile("first", "WAN", 3), tile("second", "TIAO", 6)],
        }),
        player(1),
        player(2),
        player(3),
      ],
    });
    const liveUpdate = room({
      version: 4,
      players: [
        player(0, {
          discards: [tile("first", "WAN", 3), tile("second", "TIAO", 6), tile("third", "TONG", 7)],
        }),
        player(1),
        player(2),
        player(3),
      ],
    });

    expect(updateGameAudioTracker(tracker, initial, true)).toEqual([]);
    expect(updateGameAudioTracker(tracker, disconnectedUpdate, false)).toEqual([]);
    expect(updateGameAudioTracker(tracker, reconnectedUpdate, true)).toEqual([]);
    expect(updateGameAudioTracker(tracker, liveUpdate, true)).toEqual(["tile-tong-7.mp3"]);
  });

  it("stays silent when a full snapshot skips room versions", () => {
    const before = room({ version: 4 });
    const recovered = room({
      version: 7,
      players: [
        player(0),
        player(1, { discards: [tile("historical", "WAN", 9)] }),
        player(2),
        player(3),
      ],
    });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), recovered)).toEqual([]);
  });
});
