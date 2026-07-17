import type { RoundState } from "@huanghuang/game-engine";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GameDatabase, type AnonymousSession } from "./database.js";
import {
  CLOSED_ROOM_EVICTION_MS,
  RoomService,
  WAITING_ROOM_TIMEOUT_MS,
  type RoomState,
} from "./room-service.js";

const owner: AnonymousSession = { id: "owner", nickname: "房主" };

function activeRound(room: RoomState): RoundState {
  if (room.round === null) throw new Error("Expected an active round");
  return room.round;
}

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

  it("creates a friend room in the waiting stage without bots or a round", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const projection = service.project(room, owner.id);

    expect(room.code).toMatch(/^\d{6}$/u);
    expect(projection).toMatchObject({
      mode: "FRIEND",
      stage: "WAITING",
      baseScore: 2,
      selfSeat: 0,
      actionDeadlineAt: null,
      roundId: null,
    });
    expect(Date.parse(projection.waitingExpiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(projection.players).toEqual([]);
    expect(projection.lobbySeats.filter((seat) => seat.occupied)).toHaveLength(1);
    expect(projection.lobbySeats[0]).toMatchObject({
      nickname: "房主",
      isOwner: true,
      isSelf: true,
      ready: false,
    });
  });

  it("creates an isolated bot match with three bots and a private projection", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const projection = service.project(room, owner.id);

    expect(projection.mode).toBe("BOT");
    expect(projection.stage).toBe("PLAYING");
    expect(projection.players.filter((player) => player.controller === "BOT")).toHaveLength(3);
    expect(projection.players[0]?.hand).not.toBeNull();
    expect(projection.players.slice(1).every((player) => player.hand === null)).toBe(true);
    expect(projection.actionDeadlineAt).not.toBeNull();
    expect(projection.selfDrawnTileId).toBe(
      round.lastDrawSeat === 0 ? round.lastDrawnTileId : null,
    );
  });

  it("rejects joining bot matches and full friend rooms", () => {
    const service = createService();
    const botRoom = service.createRoom(owner, 2, "BOT");
    expect(service.joinRoom({ id: "bot-guest", nickname: "误入者" }, botRoom.code)).toBe(
      "ROOM_NOT_JOINABLE",
    );

    const friendRoom = service.createRoom({ id: "friend-owner", nickname: "甲" }, 2, "FRIEND");
    for (let index = 1; index <= 3; index += 1) {
      service.joinRoom({ id: `guest-${index}`, nickname: `玩家${index}` }, friendRoom.code);
    }
    expect(service.joinRoom({ id: "guest-4", nickname: "第五人" }, friendRoom.code)).toBe(
      "ROOM_FULL",
    );
  });

  it("starts one friend round only after four seated humans are ready", () => {
    const service = createService();
    const room = service.createRoom(owner, 5, "FRIEND");
    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];

    for (const guest of guests) service.joinRoom(guest, room.code);
    service.setReady(owner.id, room.code, true);
    const versionAfterReady = room.version;
    service.setReady(owner.id, room.code, true);
    expect(room.version).toBe(versionAfterReady);

    service.setReady(owner.id, room.code, false);
    expect(service.project(room, owner.id).selfReady).toBe(false);
    service.setReady(owner.id, room.code, true);

    service.setReady(guests[0]?.id ?? "", room.code, true);
    service.setReady(guests[1]?.id ?? "", room.code, true);
    expect(room.stage).toBe("WAITING");
    expect(room.round).toBeNull();

    service.setReady(guests[2]?.id ?? "", room.code, true);
    expect(room.stage).toBe("PLAYING");
    expect(room.round).not.toBeNull();
    expect(room.readySessionIds).toEqual([]);
    expect(room.waitingExpiresAt).toBeNull();
    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(Object.values(activeRound(room).players).every((player) => player.score === 0)).toBe(
      true,
    );
  });

  it("returns a completed friend round to waiting and keeps seats and scores", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];
    for (const guest of guests) {
      service.joinRoom(guest, room.code);
      service.setReady(guest.id, room.code, true);
    }
    service.setReady(owner.id, room.code, true);

    const round = activeRound(room);
    round.players[0].score = 12;
    round.players[1].score = -4;
    round.players[2].score = -4;
    round.players[3].score = -4;
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "DRAW",
      nextDealerSeat: 2,
    };
    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();

    service.tick(Date.now());

    expect(room.stage).toBe("WAITING");
    expect(room.round).toBeNull();
    expect(room.scores).toEqual({ 0: 12, 1: -4, 2: -4, 3: -4 });
    expect(room.nextDealerSeat).toBe(2);
    expect(room.readySessionIds).toEqual([]);
    expect(Date.parse(room.waitingExpiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(service.project(room, owner.id).lobbySeats.map((seat) => seat.score)).toEqual([
      12, -4, -4, -4,
    ]);
  });

  it("waits for bot confirmation and keeps cumulative scores when continuing", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const firstRound = activeRound(room);
    firstRound.players[0].score = 6;
    firstRound.players[1].score = -2;
    firstRound.players[2].score = -2;
    firstRound.players[3].score = -2;
    firstRound.phase = "ROUND_OVER";
    firstRound.outcome = {
      kind: "DRAW",
      nextDealerSeat: 1,
    };
    room.stage = "ROUND_RESULT";
    room.actionDeadlineAt = null;
    room.nextRoundAt = null;

    service.tick(Date.now() + 60_000);
    expect(room.stage).toBe("ROUND_RESULT");
    expect(activeRound(room).id).toBe(firstRound.id);

    expect(service.continueBotRound(owner.id, room.code)).toBe(room);
    expect(room.stage).toBe("PLAYING");
    expect(activeRound(room).id).not.toBe(firstRound.id);
    expect(activeRound(room).startingScores).toEqual({ 0: 6, 1: -2, 2: -2, 3: -2 });
    expect(room.nextDealerSeat).toBe(1);
    expect(service.continueBotRound(owner.id, room.code)).toBe("ACTION_NOT_AVAILABLE");
  });

  it("advances bot turns until the human can act", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");

    for (let step = 1; step <= 30; step += 1) {
      const projection = service.project(room, owner.id);
      if (projection.actingSeat === 0 && projection.legalActions.length > 0) break;
      service.tick(Date.now() + step * 20_000);
    }

    const projection = service.project(room, owner.id);
    expect(projection.actingSeat).toBe(0);
    expect(projection.legalActions).toContain("DISCARD_TILE");
    expect(projection.selfDrawnTileId).toBe(activeRound(room).lastDrawnTileId);
  });

  it("exposes the separated drawn tile only to its owning player", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = round.players[0].hand.at(-1)?.id ?? "";

    expect(service.project(room, owner.id).selfDrawnTileId).toBe(round.lastDrawnTileId);
    expect(service.project(room, "outsider").selfDrawnTileId).toBeNull();
  });

  it("projects the responding player as the active seat without changing the discarder", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.phase = "DISCARD_RESPONSE";
    round.currentSeat = 0;
    round.pendingResponse = { seat: 2, actions: ["CLAIM_PONG"] };

    const projection = service.project(room, owner.id);

    expect(projection.currentSeat).toBe(0);
    expect(projection.actingSeat).toBe(2);
  });

  it("hands ownership to another friend and leaves an empty waiting seat", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guest = { id: "next-owner", nickname: "接任者" };
    service.joinRoom(guest, room.code);

    service.leaveRoom(owner.id, room.code);

    expect(room.status).toBe("ACTIVE");
    expect(room.ownerSessionId).toBe(guest.id);
    expect(room.seats[0].controller).toBe("EMPTY");
    expect(room.seats[0].sessionId).toBeNull();
    expect(service.hasMember(owner.id, room.code)).toBe(false);

    service.joinRoom(owner, room.code);
    expect(service.hasMember(owner.id, room.code)).toBe(true);
    expect(service.project(room, owner.id).selfSeat).not.toBeNull();
  });

  it("allows only the current friend-room owner to change the waiting-room base score", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guest = { id: "guest", nickname: "客人" };
    service.joinRoom(guest, room.code);
    service.setReady(owner.id, room.code, true);
    service.setReady(guest.id, room.code, true);

    expect(service.updateBaseScore(guest.id, room.code, 5)).toBe("FORBIDDEN");
    expect(service.updateBaseScore(owner.id, room.code, 10)).toBe(room);
    expect(room.baseScore).toBe(10);
    expect(room.readySessionIds).toEqual([]);

    service.leaveRoom(owner.id, room.code);
    expect(room.ownerSessionId).toBe(guest.id);
    expect(service.updateBaseScore(guest.id, room.code, 5)).toBe(room);
    expect(room.baseScore).toBe(5);
  });

  it("closes a waiting friend room with an owner-dissolved reason", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guest = { id: "guest", nickname: "客人" };
    service.joinRoom(guest, room.code);

    service.requestDissolve(owner.id, room.code);

    expect(room.status).toBe("CLOSED");
    expect(service.project(room, guest.id).closeReason).toBe("OWNER_DISSOLVED");
  });

  it("closes an active friend room immediately when its owner dissolves it", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];
    for (const guest of guests) service.joinRoom(guest, room.code);
    for (const session of [owner, ...guests]) service.setReady(session.id, room.code, true);

    service.requestDissolve(owner.id, room.code);

    expect(room.status).toBe("CLOSED");
    expect(room.closeReason).toBe("OWNER_DISSOLVED");
    expect(room.dissolveAfterRound).toBe(false);
  });

  it("closes and evicts a friend room when waiting reaches three minutes", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const expiresAt = Date.parse(room.waitingExpiresAt ?? "");

    expect(expiresAt).toBeGreaterThan(Date.now() + WAITING_ROOM_TIMEOUT_MS - 1000);
    service.tick(expiresAt - 1);
    expect(room.status).toBe("ACTIVE");

    service.tick(expiresAt);
    expect(room.status).toBe("CLOSED");
    expect(room.closeReason).toBe("WAITING_TIMEOUT");
    expect(service.getRoom(room.code)).toBe(room);

    service.tick(expiresAt + CLOSED_ROOM_EVICTION_MS);
    expect(service.getRoom(room.code)).toBeNull();
  });

  it("physically deletes a closed room snapshot after the notification window", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const service = new RoomService(database);
    const room = service.createRoom(owner, 2, "FRIEND");
    const expiresAt = Date.parse(room.waitingExpiresAt ?? "");
    const persistedCount = () =>
      (
        database.connection
          .prepare("SELECT COUNT(*) AS count FROM rooms WHERE id = ?")
          .get(room.id) as { count: number }
      ).count;

    expect(persistedCount()).toBe(1);
    service.tick(expiresAt);
    expect(persistedCount()).toBe(1);

    service.tick(expiresAt + CLOSED_ROOM_EVICTION_MS);
    expect(persistedCount()).toBe(0);
  });

  it("does not close a friend room that starts before its waiting deadline", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const expiresAt = Date.parse(room.waitingExpiresAt ?? "");
    const guests = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];
    for (const guest of guests) service.joinRoom(guest, room.code);
    for (const session of [owner, ...guests]) service.setReady(session.id, room.code, true);

    service.tick(expiresAt + WAITING_ROOM_TIMEOUT_MS);

    expect(room.status).toBe("ACTIVE");
    expect(room.stage).not.toBe("WAITING");
    expect(room.closeReason).toBeNull();
  });

  it("broadcasts ephemeral chat data only for members in an active friend round", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];

    expect(service.createChatMessage(owner.id, room.code, "还没开局")).toBe("ACTION_NOT_AVAILABLE");
    for (const guest of guests) service.joinRoom(guest, room.code);
    for (const session of [owner, ...guests]) service.setReady(session.id, room.code, true);
    const versionBeforeChat = room.version;

    expect(service.createChatMessage("outsider", room.code, "偷听")).toBe("NOT_A_MEMBER");
    expect(service.createChatMessage(guests[0]?.id ?? "", room.code, "三条有人要吗")).toMatchObject(
      {
        roomId: room.id,
        senderSeat: 1,
        nickname: "甲",
        message: "三条有人要吗",
      },
    );
    expect(room.version).toBe(versionBeforeChat);
  });

  it("uses trustee control while disconnected and restores human control on reconnect", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");

    service.setConnected(owner.id, false);
    expect(room.seats[0].controller).toBe("TRUSTEE");
    expect(room.seats[0].connected).toBe(false);

    service.setConnected(owner.id, true);
    expect(room.seats[0].controller).toBe("HUMAN");
    expect(room.seats[0].connected).toBe(true);
  });

  it("closes an active bot room immediately when the owner dissolves", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");

    const result = service.requestDissolve(owner.id, room.code);

    expect(result).toBe(room);
    expect(room.dissolveAfterRound).toBe(false);
    expect(room.status).toBe("CLOSED");
    expect(room.closeReason).toBe("OWNER_DISSOLVED");
  });

  it("closes a friend room when its only player leaves", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");

    service.leaveRoom(owner.id, room.code);

    expect(room.status).toBe("CLOSED");
    expect(room.closeReason).toBe("EMPTY_ROOM");
  });

  it("projects an authoritative round settlement including payments and net score changes", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.startingScores = { 0: 10, 1: -2, 2: -3, 3: -5 };
    round.players[0].score = 22;
    round.players[1].score = -6;
    round.players[2].score = -7;
    round.players[3].score = -9;
    round.players[0].personalMultiplier = 2;
    round.players[1].personalMultiplier = 2;
    round.phase = "ROUND_OVER";
    round.outcome = {
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
      roundId: round.id,
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
    const room = service.createRoom(owner, 2, "BOT");
    for (let step = 1; step <= 30; step += 1) {
      const round = activeRound(room);
      if (round.currentSeat === 0 && round.phase === "TURN_DECISION") break;
      service.tick(Date.now() + step * 20_000);
    }
    const round = activeRound(room);
    const tile = round.players[0].hand.find(
      (candidate) =>
        candidate.suit !== round.wildcardKind.suit || candidate.rank !== round.wildcardKind.rank,
    );
    if (tile === undefined) throw new Error("Expected a discardable tile");
    const command = {
      type: "DISCARD_TILE" as const,
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
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
