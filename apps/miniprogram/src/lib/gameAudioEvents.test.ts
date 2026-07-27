import type {
  GameEffectCue,
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
  winAudioFileName,
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
  laiyou = false,
): RoundSettlementProjection {
  return {
    roundId: "round-1",
    kind,
    winnerSeat: kind === "WIN" ? 0 : null,
    winType: kind === "WIN" ? winType : null,
    baseScore: 2,
    winBaseMultiplier: kind === "WIN" ? 2 : null,
    winnerMultiplier: kind === "WIN" ? 1 : null,
    laiyou: kind === "WIN" && laiyou,
    laiyouMultiplier: kind === "WIN" ? (laiyou ? 2 : 1) : null,
    nextDealerSeat: 0,
    payments: [],
    finalHands: [],
    scoreChanges: [],
  };
}

function room(overrides: Partial<RoomProjection> = {}): RoomProjection {
  return {
    schemaVersion: 8,
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
    scoreResetPending: false,
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
    effectCue: null,
    legalActions: [],
    tingHints: [],
    players: [player(0), player(1), player(2), player(3)],
    lobbySeats: [],
    spectators: [],
    ...overrides,
  };
}

function cue(
  action: GameEffectCue["action"],
  overrides: Partial<GameEffectCue> = {},
): GameEffectCue {
  return {
    id: `effect-${action}`,
    action,
    actorSeat: 1,
    tileKind: action === "WIN" ? null : { suit: "TIAO", rank: 3 },
    winType: action === "WIN" ? "HARD" : null,
    laiyou: false,
    startedAt: "2026-07-26T00:00:01.000Z",
    endsAt: "2026-07-26T00:00:03.000Z",
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

  it.each([
    ["PONG", "action-pong.mp3"],
    ["EXPOSED_KONG", "action-kong.mp3"],
    ["CONCEALED_KONG", "action-kong.mp3"],
    ["INDICATOR_PONG_KONG", "chaotiangang.mp3"],
    ["ADDED_KONG", "action-added-kong.mp3"],
    ["RELEASE_WILDCARD", "action-release-wildcard.mp3"],
  ] as const)("plays the %s voice when its effect cue starts", (action, fileName) => {
    const before = room();
    const after = room({ version: 2, effectCue: cue(action) });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), after)).toEqual([fileName]);
  });

  it("plays the matching hard/soft voice when a win cue starts", () => {
    const before = room();
    const hard = room({ version: 2, effectCue: cue("WIN", { winType: "HARD" }) });
    const soft = room({ version: 2, effectCue: cue("WIN", { winType: "SOFT" }) });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), hard)).toEqual(["yinghu.mp3"]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), soft)).toEqual(["ruanhu.mp3"]);
  });

  it("routes a laiyou win cue through the laiyou audio mapping", () => {
    const before = room();
    const hardLaiyou = room({
      version: 2,
      effectCue: cue("WIN", { winType: "HARD", laiyou: true }),
    });
    const softLaiyou = room({
      version: 2,
      effectCue: cue("WIN", { winType: "SOFT", laiyou: true }),
    });

    // 来由 currently reuses the plain hard/soft clips; the assertion pins the
    // mapping table, so swapping in dedicated audio updates exactly one place.
    expect(winAudioFileName("HARD", true)).toBe("yinghu.mp3");
    expect(winAudioFileName("SOFT", true)).toBe("ruanhu.mp3");
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), hardLaiyou)).toEqual([
      winAudioFileName("HARD", true),
    ]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), softLaiyou)).toEqual([
      winAudioFileName("SOFT", true),
    ]);
  });

  it("plays one laiyou voice per win through the settlement fallback", () => {
    const before = room();
    const settled = room({ version: 2, roundSettlement: settlement("WIN", "SOFT", true) });
    const snapshot = createGameAudioSnapshot(before);

    expect(detectGameAudioFiles(snapshot, settled)).toEqual([winAudioFileName("SOFT", true)]);
    // The settlement round id is unchanged relative to the new snapshot, so the
    // same win never speaks twice.
    expect(
      detectGameAudioFiles(createGameAudioSnapshot(settled), { ...settled, version: 3 }),
    ).toEqual([]);
  });

  it("does not replay action audio when the cued state transition becomes visible", () => {
    const before = room({ effectCue: cue("PONG") });
    const after = room({
      version: 2,
      effectCue: null,
      players: [player(0), player(1, { melds: [meld("meld-1", "PONG")] }), player(2), player(3)],
    });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), after)).toEqual([]);
  });

  it("does not replay the same cue across connection-only room versions", () => {
    const activeCue = cue("ADDED_KONG");
    const before = room({ effectCue: activeCue });
    const after = room({ version: 2, effectCue: activeCue });

    expect(detectGameAudioFiles(createGameAudioSnapshot(before), after)).toEqual([]);
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
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), wonHard)).toEqual(["yinghu.mp3"]);
    expect(detectGameAudioFiles(createGameAudioSnapshot(before), wonSoft)).toEqual(["ruanhu.mp3"]);
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

  it("does not speak an effect first discovered while disconnected or reconnecting", () => {
    const tracker = createGameAudioTracker();
    const initial = room();
    const activeCue = cue("PONG");

    expect(updateGameAudioTracker(tracker, initial, true)).toEqual([]);
    expect(
      updateGameAudioTracker(tracker, room({ version: 2, effectCue: activeCue }), false),
    ).toEqual([]);
    expect(
      updateGameAudioTracker(tracker, room({ version: 3, effectCue: activeCue }), true),
    ).toEqual([]);
    expect(updateGameAudioTracker(tracker, room({ version: 4, effectCue: null }), true)).toEqual(
      [],
    );
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
