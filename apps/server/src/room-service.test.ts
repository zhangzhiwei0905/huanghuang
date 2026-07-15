import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GameDatabase, type AnonymousSession } from "./database.js";
import { RoomService } from "./room-service.js";

const owner: AnonymousSession = { id: "owner", nickname: "房主" };

describe("RoomService", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  function createService(): RoomService {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    return new RoomService(database);
  }

  it("creates an invite room with three bots and a private projection", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);
    const projection = service.project(room, owner.id);

    expect(room.code).toMatch(/^\d{6}$/u);
    expect(projection.baseScore).toBe(2);
    expect(projection.players.filter((player) => player.controller === "BOT")).toHaveLength(3);
    expect(projection.players[0]?.hand).not.toBeNull();
    expect(projection.players.slice(1).every((player) => player.hand === null)).toBe(true);
    expect(projection.actionDeadlineAt).not.toBeNull();
    expect(projection.selfDrawnTileId).toBe(
      room.round.lastDrawSeat === 0 ? room.round.lastDrawnTileId : null,
    );
  });

  it("advances bot turns until the human can act", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);

    for (let step = 1; step <= 30; step += 1) {
      const projection = service.project(room, owner.id);
      if (projection.currentSeat === 0 && projection.legalActions.length > 0) break;
      service.tick(Date.now() + step * 20_000);
    }

    const projection = service.project(room, owner.id);
    expect(projection.currentSeat).toBe(0);
    expect(projection.legalActions).toContain("DISCARD_TILE");
    expect(projection.selfDrawnTileId).toBe(room.round.lastDrawnTileId);
    expect(room.version).toBeGreaterThanOrEqual(0);
  });

  it("exposes the separated drawn tile only to its owning player", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);
    const guest = { id: "waiting-guest", nickname: "旁观等待者" };
    service.joinRoom(guest, room.code);

    room.round.phase = "TURN_DECISION";
    room.round.currentSeat = 0;
    room.round.lastDrawSeat = 0;
    room.round.lastDrawnTileId = room.round.players[0].hand.at(-1)?.id ?? "";

    expect(service.project(room, owner.id).selfDrawnTileId).toBe(room.round.lastDrawnTileId);
    expect(service.project(room, guest.id).selfDrawnTileId).toBeNull();
  });

  it("replaces all bots after four humans have readied and resets the round", () => {
    const service = createService();
    const room = service.createRoom(owner, 5);
    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];

    for (const guest of guests) {
      service.joinRoom(guest, room.code);
      service.setReady(guest.id, room.code);
    }
    service.setReady(owner.id, room.code);

    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(room.waitingHumans).toHaveLength(0);
    expect(room.readySessionIds).toHaveLength(4);
    expect(Object.values(room.round.players).every((player) => player.score === 0)).toBe(true);
  });

  it("hands ownership to another human and replaces a leaving seat with a bot", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);
    const guest = { id: "next-owner", nickname: "接任者" };
    service.joinRoom(guest, room.code);

    service.leaveRoom(owner.id, room.code);

    expect(room.status).toBe("ACTIVE");
    expect(room.ownerSessionId).toBe(guest.id);
    expect(room.seats[0].controller).toBe("BOT");
    expect(room.seats[0].sessionId).toBeNull();
  });

  it("uses trustee control while disconnected and restores human control on reconnect", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);

    service.setConnected(owner.id, false);
    expect(room.seats[0].controller).toBe("TRUSTEE");
    expect(room.seats[0].connected).toBe(false);

    service.setConnected(owner.id, true);
    expect(room.seats[0].controller).toBe("HUMAN");
    expect(room.seats[0].connected).toBe(true);
  });

  it("marks an owner-requested dissolve for the end of the current round", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);

    const result = service.requestDissolve(owner.id, room.code);

    expect(result).toBe(room);
    expect(room.dissolveAfterRound).toBe(true);
    expect(room.status).toBe("ACTIVE");
  });

  it("projects an authoritative round settlement including payments and net score changes", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);
    room.round.startingScores = { 0: 10, 1: -2, 2: -3, 3: -5 };
    room.round.players[0].score = 22;
    room.round.players[1].score = -6;
    room.round.players[2].score = -7;
    room.round.players[3].score = -9;
    room.round.players[0].personalMultiplier = 2;
    room.round.players[1].personalMultiplier = 2;
    room.round.phase = "ROUND_OVER";
    room.round.outcome = {
      kind: "WIN",
      winnerSeat: 0,
      winType: "SOFT",
      nextDealerSeat: 2,
      scoreDeltas: [
        { seat: 0, delta: 12, reason: "SELF_DRAW" },
        { seat: 1, delta: -4, reason: "SELF_DRAW" },
        { seat: 2, delta: -4, reason: "SELF_DRAW" },
        { seat: 3, delta: -4, reason: "SELF_DRAW" },
      ],
    };

    const settlement = service.project(room, owner.id).roundSettlement;

    expect(settlement).toMatchObject({
      roundId: room.round.id,
      kind: "WIN",
      winnerSeat: 0,
      winType: "SOFT",
      baseScore: 2,
      winBaseMultiplier: 1,
      winnerMultiplier: 2,
      nextDealerSeat: 2,
    });
    expect(settlement?.payments).toEqual([
      { payerSeat: 1, payerMultiplier: 2, amount: 4 },
      { payerSeat: 2, payerMultiplier: 1, amount: 4 },
      { payerSeat: 3, payerMultiplier: 1, amount: 4 },
    ]);
    expect(settlement?.scoreChanges).toEqual([
      { seat: 0, roundDelta: 12, totalScore: 22 },
      { seat: 1, roundDelta: -4, totalScore: -6 },
      { seat: 2, roundDelta: -4, totalScore: -7 },
      { seat: 3, roundDelta: -4, totalScore: -9 },
    ]);
  });

  it("deduplicates a repeated command and rejects a stale new request", () => {
    const service = createService();
    const room = service.createRoom(owner, 2);
    for (let step = 1; step <= 30; step += 1) {
      if (room.round.currentSeat === 0 && room.round.phase === "TURN_DECISION") break;
      service.tick(Date.now() + step * 20_000);
    }
    const tile = room.round.players[0].hand.find(
      (candidate) =>
        candidate.suit !== room.round.wildcardKind.suit ||
        candidate.rank !== room.round.wildcardKind.rank,
    );
    if (tile === undefined) throw new Error("Expected a discardable tile");
    const command = {
      type: "DISCARD_TILE" as const,
      requestId: randomUUID(),
      roomId: room.id,
      roundId: room.round.id,
      expectedVersion: room.version,
      payload: { tileId: tile.id },
    };

    const first = service.execute(owner.id, command);
    const versionAfterFirst = room.version;
    const repeated = service.execute(owner.id, command);
    const stale = service.execute(owner.id, { ...command, requestId: randomUUID() });

    expect(first.accepted).toBe(true);
    expect(repeated).toEqual(first);
    expect(room.version).toBe(versionAfterFirst);
    expect(stale.accepted).toBe(false);
    expect(stale.errorCode).toBe("VERSION_CONFLICT");
  });
});
