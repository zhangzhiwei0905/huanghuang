import {
  declareAddedKong,
  declareWin,
  discardTile,
  sameTileKind,
  type RoundState,
} from "@huanghuang/game-engine";
import type { Meld, Tile, TileKind } from "@huanghuang/protocol";
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

function testTile(id: string, suit: TileKind["suit"], rank: TileKind["rank"]): Tile {
  return { id, suit, rank };
}

function activeRound(room: RoomState): RoundState {
  if (room.round === null) throw new Error("Expected an active round");
  return room.round;
}

function finishPendingEffect(service: RoomService, room: RoomState): void {
  const transition = room.pendingEffectTransition;
  if (transition === null) throw new Error("Expected a pending effect transition");
  service.tick(Date.parse(transition.cue.endsAt));
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

    expect(room.code).toMatch(/^[1-9]\d{3}$/u);
    expect(projection).toMatchObject({
      mode: "FRIEND",
      stage: "WAITING",
      baseScore: 2,
      turnTimeoutSeconds: 20,
      botDifficulty: "HIGH",
      selfRole: "PLAYER",
      selfSeat: 0,
      actionDeadlineAt: null,
      roundId: null,
    });
    expect(Date.parse(projection.waitingExpiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(projection.players).toEqual([]);
    expect(projection.tingHints).toEqual([]);
    expect(projection.lobbySeats.filter((seat) => seat.occupied)).toHaveLength(1);
    expect(projection.lobbySeats[0]).toMatchObject({
      nickname: "房主",
      isOwner: true,
      isSelf: true,
      ready: false,
    });
  });

  it("scans the complete four-digit code space for collisions and reports exhaustion", () => {
    const service = createService();
    const seedRoom = service.createRoom(owner, 2, "FRIEND");
    const activeRooms = (
      service as unknown as {
        roomsByCode: Map<string, RoomState>;
      }
    ).roomsByCode;
    activeRooms.clear();
    for (let code = 1000; code <= 9999; code += 1) {
      if (code !== 4321) activeRooms.set(String(code), seedRoom);
    }

    expect(
      service.createRoom({ id: "collision-owner", nickname: "碰撞测试" }, 2, "FRIEND").code,
    ).toBe("4321");
    expect(() =>
      service.createRoom({ id: "exhausted-owner", nickname: "耗尽测试" }, 2, "FRIEND"),
    ).toThrow("All four-digit room codes are currently in use");
  });

  it("restores an active legacy six-digit snapshot with new field defaults", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const firstService = new RoomService(database);
    const room = firstService.createRoom(owner, 2, "FRIEND");
    const legacySnapshot = JSON.parse(JSON.stringify(room)) as Record<string, unknown>;
    legacySnapshot.code = "123456";
    delete legacySnapshot.botDifficulty;
    delete legacySnapshot.spectators;
    database.saveRoom(
      { id: room.id, code: "123456", status: room.status, version: room.version },
      JSON.stringify(legacySnapshot),
    );

    const restoredService = new RoomService(database);
    const restored = restoredService.getRoom("123456");

    expect(restored).not.toBeNull();
    if (restored === null) throw new Error("Expected the legacy room to restore");
    expect(restoredService.project(restored, owner.id)).toMatchObject({
      roomCode: "123456",
      botDifficulty: "HIGH",
      spectators: [],
    });
  });

  it("lets the friend-room owner manage bots and starts when all humans are ready", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND", 20, "LOW");
    const guest = { id: "guest", nickname: "玩家" };

    expect(service.addBot(guest.id, room.code)).toBe("FORBIDDEN");
    expect(service.addBot(owner.id, room.code)).toBe(room);
    expect(service.addBot(owner.id, room.code)).toBe(room);
    expect(service.addBot(owner.id, room.code)).toBe(room);
    expect(service.addBot(owner.id, room.code)).toBe("ACTION_NOT_AVAILABLE");

    let projection = service.project(room, owner.id);
    expect(projection.botDifficulty).toBe("LOW");
    expect(projection.lobbySeats.filter((seat) => seat.controller === "BOT")).toHaveLength(3);
    expect(projection.lobbySeats.filter((seat) => seat.ready)).toHaveLength(3);

    expect(service.removeBot(owner.id, room.code, 2)).toBe(room);
    projection = service.project(room, owner.id);
    expect(projection.lobbySeats[2]).toMatchObject({
      controller: null,
      occupied: false,
      ready: false,
    });
    expect(service.addBot(owner.id, room.code)).toBe(room);
    expect(service.setReady(owner.id, room.code, true)).toBe(room);
    expect(room.stage).toBe("PLAYING");
  });

  it("gives a waiting human priority over an existing bot seat", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);

    const guest = { id: "guest", nickname: "真人玩家" };
    expect(service.joinRoom(guest, room.code)).toBe(room);
    expect(service.project(room, guest.id)).toMatchObject({
      selfRole: "PLAYER",
      selfReady: false,
    });
    expect(service.project(room, owner.id).lobbySeats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nickname: "真人玩家", controller: "HUMAN" }),
      ]),
    );
    expect(
      service.project(room, owner.id).lobbySeats.filter((seat) => seat.controller === "BOT"),
    ).toHaveLength(2);
  });

  it("queues in-round humans as private-hand-safe spectators then seats them after the round", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);
    service.setReady(owner.id, room.code, true);

    const spectator = { id: "spectator", nickname: "候补玩家" };
    expect(service.joinRoom(spectator, room.code)).toBe(room);
    const spectatorProjection = service.project(room, spectator.id);
    expect(spectatorProjection.selfRole).toBe("SPECTATOR");
    expect(spectatorProjection.selfSeat).toBeNull();
    expect(spectatorProjection.legalActions).toEqual([]);
    expect(spectatorProjection.players.every((player) => player.hand === null)).toBe(true);
    expect(spectatorProjection.spectators).toEqual([
      expect.objectContaining({ nickname: "候补玩家", isSelf: true }),
    ]);
    expect(service.hasMember(spectator.id, room.code)).toBe(true);

    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();
    service.tick(Date.now());

    const waitingProjection = service.project(room, spectator.id);
    expect(waitingProjection.stage).toBe("WAITING");
    expect(waitingProjection.selfRole).toBe("PLAYER");
    expect(waitingProjection.selfReady).toBe(false);
    expect(waitingProjection.spectators).toEqual([]);
    expect(waitingProjection.lobbySeats.filter((seat) => seat.controller === "BOT")).toHaveLength(
      2,
    );
  });

  it("caps active-round membership at four humans and seats spectators in join order", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);
    service.addBot(owner.id, room.code);
    service.setReady(owner.id, room.code, true);

    const spectators: AnonymousSession[] = [
      { id: "spectator-1", nickname: "候补甲" },
      { id: "spectator-2", nickname: "候补乙" },
      { id: "spectator-3", nickname: "候补丙" },
    ];
    for (const spectator of spectators) {
      expect(service.joinRoom(spectator, room.code)).toBe(room);
    }
    expect(service.joinRoom({ id: "spectator-4", nickname: "候补丁" }, room.code)).toBe(
      "ROOM_FULL",
    );
    expect(
      service.project(room, owner.id).spectators.map((spectator) => spectator.nickname),
    ).toEqual(["候补甲", "候补乙", "候补丙"]);

    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();
    service.tick(Date.now());

    const lobby = service.project(room, owner.id).lobbySeats;
    expect(lobby.map((seat) => seat.nickname)).toEqual(["房主", "候补甲", "候补乙", "候补丙"]);
    expect(lobby.every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(lobby.every((seat) => !seat.ready)).toBe(true);
    expect(room.spectators).toEqual([]);
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
    const room = service.createRoom(owner, 5, "FRIEND", 30);
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

    const beforeRoundStart = Date.now();
    service.setReady(guests[2]?.id ?? "", room.code, true);
    expect(room.stage).toBe("PLAYING");
    expect(room.round).not.toBeNull();
    expect(room.readySessionIds).toEqual([]);
    expect(room.waitingExpiresAt).toBeNull();
    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(Object.values(activeRound(room).players).every((player) => player.score === 0)).toBe(
      true,
    );
    expect(room.turnTimeoutSeconds).toBe(30);
    expect(service.project(room, owner.id).turnTimeoutSeconds).toBe(30);
    expect(Date.parse(room.actionDeadlineAt ?? "") - beforeRoundStart).toBeGreaterThanOrEqual(
      29_000,
    );
    expect(Date.parse(room.actionDeadlineAt ?? "") - beforeRoundStart).toBeLessThanOrEqual(31_000);
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

  it("waits for bot confirmation and keeps cumulative scores and difficulty when continuing", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT", 20, "LOW");
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
    expect(room.botDifficulty).toBe("LOW");
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
    expect(projection.legalActions.length).toBeGreaterThan(0);
    if (projection.roundPhase === "TURN_DECISION") {
      expect(projection.legalActions).toContain("DISCARD_TILE");
      expect(projection.selfDrawnTileId).toBe(activeRound(room).lastDrawnTileId);
    } else {
      expect(projection.roundPhase).toBe("DISCARD_RESPONSE");
      expect(projection.legalActions).toContain("PASS_RESPONSE");
      expect(projection.selfDrawnTileId).toBeNull();
    }
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

  it("projects per-discard ting guidance from public information only", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const discarded = testTile("ting-discard", "TIAO", 7);
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = discarded.id;
    round.indicatorTile = testTile("ting-indicator", "TIAO", 8);
    round.wildcardKind = { suit: "TIAO", rank: 9 };
    round.players[0].personalMultiplier = 2;
    round.players[0].hand = [
      testTile("wan-1", "WAN", 1),
      testTile("wan-2", "WAN", 2),
      testTile("wan-3", "WAN", 3),
      testTile("wan-4", "WAN", 4),
      testTile("wan-5", "WAN", 5),
      testTile("wan-6", "WAN", 6),
      testTile("wan-7", "WAN", 7),
      testTile("wan-8", "WAN", 8),
      testTile("wan-9", "WAN", 9),
      testTile("tiao-5-a", "TIAO", 5),
      testTile("tiao-5-b", "TIAO", 5),
      testTile("tong-2", "TONG", 2),
      testTile("tong-3", "TONG", 3),
      discarded,
    ];
    round.players[1].melds = [
      {
        id: "public-tong-1",
        kind: "PONG",
        tileIds: ["tong-1-a", "tong-1-b", "tong-1-c"],
        tileKind: { suit: "TONG", rank: 1 },
        sourcePlayerId: "seat-2",
        sourceDiscardId: "discard-tong-1-a",
        createdAtVersion: 1,
      },
      {
        id: "public-tong-4",
        kind: "PONG",
        tileIds: ["tong-4-a", "tong-4-b", "tong-4-c"],
        tileKind: { suit: "TONG", rank: 4 },
        sourcePlayerId: "seat-2",
        sourceDiscardId: "discard-tong-4-a",
        createdAtVersion: 1,
      },
    ];
    round.players[2].discards = [
      testTile("tong-1-a", "TONG", 1),
      testTile("tong-1-d", "TONG", 1),
      testTile("tong-4-a", "TONG", 4),
    ];
    round.players[3].releasedWildcards = [testTile("released-wildcard", "TIAO", 9)];

    const projection = service.project(room, owner.id);
    const hints = projection.tingHints.find((hint) => hint.discardTileId === discarded.id);

    expect(projection.schemaVersion).toBe(8);
    expect(hints?.waits).toContainEqual({
      tileKind: { suit: "TONG", rank: 1 },
      winType: "HARD",
      multiplier: 4,
      remainingCount: 0,
    });
    expect(hints?.waits).toContainEqual({
      tileKind: { suit: "TONG", rank: 4 },
      winType: "HARD",
      multiplier: 4,
      remainingCount: 1,
    });
    expect(hints?.waits).toContainEqual({
      tileKind: round.wildcardKind,
      winType: "SOFT",
      multiplier: 2,
      remainingCount: 3,
    });
    expect(service.project(room, "outsider").tingHints).toEqual([]);

    const beforeHiddenMutation = structuredClone(projection.tingHints);
    round.wall.reverse();
    round.players[3].hand = round.players[3].hand.map((tile) => ({
      ...tile,
      suit: "WAN",
      rank: 8,
    }));
    expect(service.project(room, owner.id).tingHints).toEqual(beforeHiddenMutation);
  });

  it("projects ting guidance after a pong when there is no drawn tile", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const discarded = testTile("post-pong-discard", "TONG", 7);
    const pong: Meld = {
      id: "self-pong",
      kind: "PONG",
      tileIds: ["pong-a", "pong-b", "pong-c"],
      tileKind: { suit: "TONG", rank: 2 },
      sourcePlayerId: "seat-1",
      sourceDiscardId: "pong-source",
      createdAtVersion: 1,
    };
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.lastDrawSeat = 1;
    round.lastDrawnTileId = "";
    round.indicatorTile = testTile("post-pong-indicator", "TIAO", 8);
    round.wildcardKind = { suit: "TIAO", rank: 9 };
    round.players[0].melds = [pong];
    round.players[0].hand = [
      testTile("post-wan-1", "WAN", 1),
      testTile("post-wan-2", "WAN", 2),
      testTile("post-wan-3", "WAN", 3),
      testTile("post-wan-4", "WAN", 4),
      testTile("post-wan-5", "WAN", 5),
      testTile("post-wan-6", "WAN", 6),
      testTile("post-wan-7", "WAN", 7),
      testTile("post-wan-8", "WAN", 8),
      testTile("post-wan-9", "WAN", 9),
      testTile("post-tiao-5", "TIAO", 5),
      discarded,
    ];

    const projection = service.project(room, owner.id);

    expect(projection.selfDrawnTileId).toBeNull();
    expect(
      projection.tingHints
        .find((hint) => hint.discardTileId === discarded.id)
        ?.waits.some(
          (wait) =>
            wait.tileKind.suit === "TIAO" && wait.tileKind.rank === 5 && wait.winType === "HARD",
        ),
    ).toBe(true);
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

  it("uses conservative trustee control while disconnected and restores human control", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");

    service.setConnected(owner.id, false);
    expect(room.seats[0].controller).toBe("TRUSTEE");
    expect(room.seats[0].connected).toBe(false);

    const round = activeRound(room);
    const meldCount = round.players[0].melds.length;
    round.phase = "DISCARD_RESPONSE";
    round.currentSeat = 3;
    round.lastDiscard = {
      id: "trustee-response-discard",
      tile: { id: "trustee-response-tile", suit: "WAN", rank: 3 },
      sourceSeat: 3,
    };
    round.pendingResponse = { seat: 0, actions: ["CLAIM_PONG"] };
    room.actionDeadlineAt = new Date(0).toISOString();

    service.tick(Date.now());

    expect(activeRound(room).players[0].melds).toHaveLength(meldCount);
    expect(activeRound(room).phase).toBe("TURN_DECISION");
    expect(activeRound(room).currentSeat).toBe(0);

    service.setConnected(owner.id, true);
    expect(room.seats[0].controller).toBe("HUMAN");
    expect(room.seats[0].connected).toBe(true);
  });

  it("lets a trustee accept a soft win even when room bots use low difficulty", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT", 20, "LOW");
    const round = activeRound(room);
    const wildcardKind: TileKind = { suit: "WAN", rank: 5 };
    const triplet = (prefix: string, suit: TileKind["suit"], rank: TileKind["rank"]) =>
      ["a", "b", "c"].map((suffix) => testTile(`${prefix}-${suffix}`, suit, rank));
    const wildcard = testTile("trustee-soft-wildcard", wildcardKind.suit, wildcardKind.rank);
    round.wildcardKind = wildcardKind;
    round.players[0].hand = [
      ...triplet("trustee-wan-1", "WAN", 1),
      ...triplet("trustee-tiao-2", "TIAO", 2),
      ...triplet("trustee-tong-3", "TONG", 3),
      testTile("trustee-wan-7-a", "WAN", 7),
      testTile("trustee-wan-7-b", "WAN", 7),
      testTile("trustee-tiao-9-a", "TIAO", 9),
      testTile("trustee-tiao-9-b", "TIAO", 9),
      wildcard,
    ];
    round.currentSeat = 0;
    round.phase = "TURN_DECISION";
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = wildcard.id;
    round.winPassedThisTurn = false;
    room.seats[0].controller = "TRUSTEE";
    room.actionDeadlineAt = new Date(0).toISOString();

    const effectStartedAt = Date.now();
    service.tick(effectStartedAt);

    expect(room.stage).toBe("PLAYING");
    expect(activeRound(room).outcome).toBeNull();
    expect(service.project(room, owner.id)).toMatchObject({
      actingSeat: null,
      actionDeadlineAt: null,
      legalActions: [],
      effectCue: {
        action: "WIN",
        actorSeat: 0,
        tileKind: null,
        winType: "SOFT",
        startedAt: new Date(effectStartedAt).toISOString(),
        endsAt: new Date(effectStartedAt + 2_800).toISOString(),
      },
      roundSettlement: null,
    });
    finishPendingEffect(service, room);

    expect(room.stage).toBe("ROUND_RESULT");
    expect(activeRound(room).outcome).toMatchObject({
      kind: "WIN",
      winnerSeat: 0,
      winType: "SOFT",
    });
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

  it("routes a bot response through the balanced claim strategy", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const kind = { suit: "TONG" as const, rank: 6 as const };
    round.phase = "DISCARD_RESPONSE";
    round.currentSeat = 0;
    round.lastDiscard = {
      id: "bot-kong-discard",
      tile: { id: "bot-kong-tile", ...kind },
      sourceSeat: 0,
    };
    round.pendingResponse = { seat: 1, actions: ["CLAIM_EXPOSED_KONG", "CLAIM_PONG"] };
    round.players[1].hand.splice(
      0,
      3,
      { id: "bot-kong-a", ...kind },
      { id: "bot-kong-b", ...kind },
      { id: "bot-kong-c", ...kind },
    );
    room.actionDeadlineAt = new Date(0).toISOString();
    const versionBefore = room.version;
    const handCountBefore = round.players[1].hand.length;

    const effectStartedAt = Date.now();
    service.tick(effectStartedAt);

    expect(activeRound(room).players[1].melds.at(-1)).toBeUndefined();
    expect(service.project(room, owner.id).effectCue).toMatchObject({
      action: "EXPOSED_KONG",
      actorSeat: 1,
      tileKind: kind,
      winType: null,
      startedAt: new Date(effectStartedAt).toISOString(),
      endsAt: new Date(effectStartedAt + 2_200).toISOString(),
    });
    expect(room.version).toBe(versionBefore + 1);

    service.tick(effectStartedAt + 2_199);
    expect(activeRound(room).players[1].melds.at(-1)).toBeUndefined();

    service.tick(effectStartedAt + 2_200);
    expect(activeRound(room).players[1].melds.at(-1)?.kind).toBe("EXPOSED_KONG");
    expect(activeRound(room).players[1].hand).toHaveLength(handCountBefore - 2);
    expect(activeRound(room).currentSeat).toBe(1);
    expect(activeRound(room).lastDrawSeat).toBe(1);
    expect(activeRound(room).players[1].score).toBe(6);
    expect(activeRound(room).players[0].score).toBe(-6);
    expect(room.version).toBe(versionBefore + 2);
  });

  it("maps concealed, added and indicator kongs to their authoritative cue kinds", () => {
    const concealedService = createService();
    const concealedRoom = concealedService.createRoom(owner, 2, "BOT");
    const concealedRound = activeRound(concealedRoom);
    const concealedKind = { suit: "WAN" as const, rank: 2 as const };
    concealedRound.wildcardKind = { suit: "TONG", rank: 9 };
    const concealedTiles = ["a", "b", "c", "d"].map((suffix) => ({
      id: `concealed-effect-${suffix}`,
      ...concealedKind,
    }));
    concealedRound.players[0].hand.splice(0, 4, ...concealedTiles);
    concealedRound.phase = "TURN_DECISION";
    concealedRound.currentSeat = 0;
    concealedRound.lastDrawSeat = 0;
    concealedRound.lastDrawnTileId = concealedTiles[3]?.id ?? "";
    const concealedResult = concealedService.execute(owner.id, {
      type: "DECLARE_CONCEALED_KONG",
      requestId: randomUUID(),
      roomId: concealedRoom.id,
      roundId: concealedRound.id,
      expectedVersion: concealedRoom.version,
      payload: concealedKind,
    });
    expect(concealedResult.accepted).toBe(true);
    expect(concealedRoom.pendingEffectTransition?.cue).toMatchObject({
      action: "CONCEALED_KONG",
      actorSeat: 0,
      tileKind: concealedKind,
    });
    expect(
      Date.parse(concealedRoom.pendingEffectTransition?.cue.endsAt ?? "") -
        Date.parse(concealedRoom.pendingEffectTransition?.cue.startedAt ?? ""),
    ).toBe(2_200);

    const addedService = createService();
    const addedRoom = addedService.createRoom(owner, 2, "BOT");
    const addedRound = activeRound(addedRoom);
    const addedKind = { suit: "TONG" as const, rank: 7 as const };
    addedRound.wildcardKind = { suit: "WAN", rank: 9 };
    const addedTile = { id: "added-effect-tile", ...addedKind };
    addedRound.players[0].melds = [
      {
        id: "added-effect-pong",
        kind: "PONG",
        tileIds: ["added-effect-a", "added-effect-b", "added-effect-c"],
        tileKind: addedKind,
        sourcePlayerId: "seat-1",
        sourceDiscardId: "added-effect-discard",
        createdAtVersion: 1,
      },
    ];
    addedRound.players[0].hand[0] = addedTile;
    addedRound.phase = "TURN_DECISION";
    addedRound.currentSeat = 0;
    addedRound.lastDrawSeat = 0;
    addedRound.lastDrawnTileId = addedTile.id;
    const addedResult = addedService.execute(owner.id, {
      type: "DECLARE_ADDED_KONG",
      requestId: randomUUID(),
      roomId: addedRoom.id,
      roundId: addedRound.id,
      expectedVersion: addedRoom.version,
      payload: { meldId: "added-effect-pong", tileId: addedTile.id },
    });
    expect(addedResult.accepted).toBe(true);
    expect(addedRoom.pendingEffectTransition?.cue).toMatchObject({
      action: "ADDED_KONG",
      actorSeat: 0,
      tileKind: addedKind,
    });
    expect(
      Date.parse(addedRoom.pendingEffectTransition?.cue.endsAt ?? "") -
        Date.parse(addedRoom.pendingEffectTransition?.cue.startedAt ?? ""),
    ).toBe(2_300);

    const indicatorService = createService();
    const indicatorRoom = indicatorService.createRoom(owner, 2, "BOT");
    const indicatorRound = activeRound(indicatorRoom);
    const indicatorKind = {
      suit: indicatorRound.indicatorTile.suit,
      rank: indicatorRound.indicatorTile.rank,
    };
    indicatorRound.phase = "DISCARD_RESPONSE";
    indicatorRound.currentSeat = 1;
    indicatorRound.lastDiscard = {
      id: "indicator-effect-discard",
      tile: { id: "indicator-effect-discard-tile", ...indicatorKind },
      sourceSeat: 1,
    };
    indicatorRound.pendingResponse = {
      seat: 0,
      actions: ["CLAIM_INDICATOR_PONG_KONG"],
    };
    indicatorRound.players[0].hand.splice(
      0,
      2,
      { id: "indicator-effect-a", ...indicatorKind },
      { id: "indicator-effect-b", ...indicatorKind },
    );
    const indicatorResult = indicatorService.execute(owner.id, {
      type: "CLAIM_INDICATOR_PONG_KONG",
      requestId: randomUUID(),
      roomId: indicatorRoom.id,
      roundId: indicatorRound.id,
      expectedVersion: indicatorRoom.version,
      payload: {},
    });
    expect(indicatorResult.accepted).toBe(true);
    expect(indicatorRoom.pendingEffectTransition?.cue).toMatchObject({
      action: "INDICATOR_PONG_KONG",
      actorSeat: 0,
      tileKind: indicatorKind,
    });
    expect(
      Date.parse(indicatorRoom.pendingEffectTransition?.cue.endsAt ?? "") -
        Date.parse(indicatorRoom.pendingEffectTransition?.cue.startedAt ?? ""),
    ).toBe(2_200);
  });

  it("projects reducer-driven kong and self-draw transfers as one round delta", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const kongKind = { suit: "TONG" as const, rank: 9 as const };
    round.startingScores = { 0: 0, 1: 0, 2: 0, 3: 0 };
    round.players[0].score = 0;
    round.players[1].score = 0;
    round.players[2].score = 0;
    round.players[3].score = 0;
    round.players[0].personalMultiplier = 2;
    round.players[1].personalMultiplier = 2;
    round.wildcardKind = { suit: "TIAO", rank: 9 };
    round.players[0].melds = [
      {
        id: "win-pong",
        kind: "PONG",
        tileIds: ["win-pong-a", "win-pong-b", "win-pong-c"],
        tileKind: kongKind,
        sourcePlayerId: "seat-1",
        sourceDiscardId: "win-pong-discard",
        createdAtVersion: 1,
      },
    ];
    round.players[0].hand = [
      { id: "wan-1", suit: "WAN", rank: 1 },
      { id: "wan-2", suit: "WAN", rank: 2 },
      { id: "wan-3", suit: "WAN", rank: 3 },
      { id: "wan-4", suit: "WAN", rank: 4 },
      { id: "wan-5", suit: "WAN", rank: 5 },
      { id: "wan-6", suit: "WAN", rank: 6 },
      { id: "tiao-2", suit: "TIAO", rank: 2 },
      { id: "tiao-3", suit: "TIAO", rank: 3 },
      { id: "tiao-4", suit: "TIAO", rank: 4 },
      { id: "tong-7-a", suit: "TONG", rank: 7 },
      { id: "added-kong", ...kongKind },
    ];
    round.wall = [{ id: "winning-tong-7", suit: "TONG", rank: 7 }];
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = "added-kong";

    const kong = declareAddedKong(round, 0, "win-pong", "added-kong");
    expect(kong.ok).toBe(true);
    if (!kong.ok) return;
    expect(kong.state.players[0].score).toBe(6);
    expect(kong.state.players[1].score).toBe(-2);

    const win = declareWin(kong.state, 0);
    expect(win.ok).toBe(true);
    if (!win.ok) return;
    room.round = win.state;
    room.stage = "ROUND_RESULT";

    const settlement = service.project(room, owner.id).roundSettlement;

    expect(settlement?.payments).toEqual([
      { payerSeat: 1, payerMultiplier: 2, amount: 16 },
      { payerSeat: 2, payerMultiplier: 1, amount: 8 },
      { payerSeat: 3, payerMultiplier: 1, amount: 8 },
    ]);
    expect(settlement?.scoreChanges).toEqual([
      { seat: 0, roundDelta: 38, totalScore: 38 },
      { seat: 1, roundDelta: -18, totalScore: -18 },
      { seat: 2, roundDelta: -10, totalScore: -10 },
      { seat: 3, roundDelta: -10, totalScore: -10 },
    ]);
  });

  it("projects self-draw payments separately from earlier kong score changes", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.startingScores = { 0: 10, 1: -2, 2: -3, 3: -5 };
    round.players[0].score = 32;
    round.players[1].score = -12;
    round.players[2].score = -9;
    round.players[3].score = -11;
    round.players[0].personalMultiplier = 2;
    round.players[1].personalMultiplier = 2;
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "WIN",
      winnerSeat: 0,
      winType: "SOFT",
      laiyou: false,
      nextDealerSeat: 2,
      scoreDeltas: [
        { seat: 0, delta: 16, reason: "SELF_DRAW" },
        { seat: 1, delta: -8, reason: "SELF_DRAW" },
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
      { payerSeat: 1, payerMultiplier: 2, amount: 8 },
      { payerSeat: 2, payerMultiplier: 1, amount: 4 },
      { payerSeat: 3, payerMultiplier: 1, amount: 4 },
    ]);
    expect(settlement?.finalHands).toEqual(
      ([0, 1, 2, 3] as const).map((seat) => ({
        seat,
        tiles: round.players[seat].hand,
        personalMultiplier: round.players[seat].personalMultiplier,
      })),
    );
    expect(settlement?.scoreChanges).toEqual([
      { seat: 0, roundDelta: 22, totalScore: 32 },
      { seat: 1, roundDelta: -10, totalScore: -12 },
      { seat: 2, roundDelta: -6, totalScore: -9 },
      { seat: 3, roundDelta: -6, totalScore: -11 },
    ]);
    expect(
      service
        .project(room, owner.id)
        .players.slice(1)
        .every((player) => player.hand === null),
    ).toBe(true);
  });

  it("preserves reducer-driven kong transfers when the round ends in a draw", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const kongKind = { suit: "TONG" as const, rank: 9 as const };
    const finalDraw = { id: "wall-final-draw", suit: "TIAO" as const, rank: 9 as const };
    round.startingScores = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const seat of [0, 1, 2, 3] as const) round.players[seat].score = 0;
    round.wildcardKind = { suit: "WAN", rank: 8 };
    round.players[0].melds = [
      {
        id: "draw-pong",
        kind: "PONG",
        tileIds: ["draw-pong-a", "draw-pong-b", "draw-pong-c"],
        tileKind: kongKind,
        sourcePlayerId: "seat-1",
        sourceDiscardId: "draw-pong-discard",
        createdAtVersion: 1,
      },
    ];
    round.players[0].hand[0] = { id: "draw-added-kong", ...kongKind };
    for (const seat of [1, 2, 3] as const) {
      round.players[seat].hand = round.players[seat].hand.map((tile, index) =>
        sameTileKind(tile, finalDraw)
          ? { id: `safe-${seat}-${index}`, suit: "WAN", rank: 1 }
          : tile,
      );
    }
    round.wall = [finalDraw];
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = "draw-added-kong";

    const kong = declareAddedKong(round, 0, "draw-pong", "draw-added-kong");
    expect(kong.ok).toBe(true);
    if (!kong.ok) return;
    expect(kong.state.players[0].score).toBe(6);
    expect(kong.state.players[1].score).toBe(-2);

    const discarded = discardTile(kong.state, 0, finalDraw.id);
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.outcome).toEqual({ kind: "DRAW", nextDealerSeat: 0 });
    room.round = discarded.state;
    room.stage = "ROUND_RESULT";

    const settlement = service.project(room, owner.id).roundSettlement;

    expect(settlement).toMatchObject({
      kind: "DRAW",
      winnerSeat: null,
      winType: null,
      winnerMultiplier: null,
      payments: [],
    });
    expect(settlement?.scoreChanges).toEqual([
      { seat: 0, roundDelta: 6, totalScore: 6 },
      { seat: 1, roundDelta: -2, totalScore: -2 },
      { seat: 2, roundDelta: -2, totalScore: -2 },
      { seat: 3, roundDelta: -2, totalScore: -2 },
    ]);
    expect(settlement?.finalHands.map((hand) => hand.personalMultiplier)).toEqual([1, 1, 1, 1]);
  });

  it("persists a pong cue across restart and applies the accepted transition only on expiry", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const service = new RoomService(database);
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const kind = { suit: "WAN" as const, rank: 4 as const };
    const discardTile = { id: "persisted-pong-discard-tile", ...kind };
    round.phase = "DISCARD_RESPONSE";
    round.currentSeat = 1;
    round.lastDiscard = {
      id: "persisted-pong-discard",
      tile: discardTile,
      sourceSeat: 1,
    };
    round.pendingResponse = { seat: 0, actions: ["CLAIM_PONG"] };
    round.players[1].discards.push(discardTile);
    round.players[0].hand.splice(
      0,
      2,
      { id: "persisted-pong-a", ...kind },
      { id: "persisted-pong-b", ...kind },
    );
    const versionBefore = room.version;
    const command = {
      type: "CLAIM_PONG",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: versionBefore,
      payload: {},
    } as const;
    const result = service.execute(owner.id, command);

    expect(result.accepted).toBe(true);
    expect(activeRound(room).players[0].melds.at(-1)).toBeUndefined();
    expect(room.version).toBe(versionBefore + 1);
    expect(service.project(room, owner.id)).toMatchObject({
      actingSeat: null,
      actionDeadlineAt: null,
      legalActions: [],
      effectCue: {
        action: "PONG",
        actorSeat: 0,
        tileKind: kind,
        winType: null,
      },
    });
    expect(
      Date.parse(room.pendingEffectTransition?.cue.endsAt ?? "") -
        Date.parse(room.pendingEffectTransition?.cue.startedAt ?? ""),
    ).toBe(2_000);
    expect(service.execute(owner.id, command)).toEqual(result);
    expect(room.version).toBe(versionBefore + 1);
    const blocked = service.execute(owner.id, {
      type: "PASS_RESPONSE",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: {},
    });
    expect(blocked).toMatchObject({ accepted: false, errorCode: "ACTION_NOT_AVAILABLE" });

    const restoredService = new RoomService(database);
    const restored = restoredService.getRoom(room.code);
    if (restored === null) throw new Error("Expected the room with its pending cue to restore");
    const endsAt = Date.parse(restored.pendingEffectTransition?.cue.endsAt ?? "");
    restoredService.tick(endsAt - 1);
    expect(activeRound(restored).players[0].melds.at(-1)).toBeUndefined();

    restoredService.tick(endsAt);
    expect(restored.pendingEffectTransition).toBeNull();
    expect(activeRound(restored).players[0].melds.at(-1)?.kind).toBe("PONG");
    expect(restored.version).toBe(versionBefore + 2);
  });

  it("keeps a wildcard in hand until its 2.5-second release effect completes", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    const wildcard = { id: "release-effect-wildcard", ...round.wildcardKind };
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.players[0].hand[0] = wildcard;
    const releasedBefore = round.players[0].releasedWildcards.length;
    const result = service.execute(owner.id, {
      type: "RELEASE_WILDCARD",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: { tileId: wildcard.id },
    });

    expect(result.accepted).toBe(true);
    const transition = room.pendingEffectTransition;
    if (transition === null) throw new Error("Expected a release effect transition");
    expect(transition.cue.action).toBe("RELEASE_WILDCARD");
    expect(Date.parse(transition.cue.endsAt) - Date.parse(transition.cue.startedAt)).toBe(2_500);
    expect(activeRound(room).players[0].releasedWildcards).toHaveLength(releasedBefore);
    expect(activeRound(room).players[0].hand.some((tile) => tile.id === wildcard.id)).toBe(true);

    finishPendingEffect(service, room);
    expect(activeRound(room).players[0].releasedWildcards).toHaveLength(releasedBefore + 1);
    expect(activeRound(room).players[0].releasedWildcards.at(-1)?.id).toBe(wildcard.id);
    expect(activeRound(room).players[0].hand).toHaveLength(round.players[0].hand.length);
    expect(activeRound(room).lastDrawSeat).toBe(0);
    expect(activeRound(room).lastDrawnTileId).not.toBe(wildcard.id);
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

  it("projects laiyou and its multiplier contribution for a hard laiyou win", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.players[0].personalMultiplier = 2;
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "WIN",
      winnerSeat: 0,
      winType: "HARD",
      laiyou: true,
      nextDealerSeat: 2,
      scoreDeltas: [
        { seat: 0, delta: 48, reason: "SELF_DRAW" },
        { seat: 1, delta: -16, reason: "SELF_DRAW" },
        { seat: 2, delta: -16, reason: "SELF_DRAW" },
        { seat: 3, delta: -16, reason: "SELF_DRAW" },
      ],
    };

    const projection = service.project(room, owner.id);

    expect(projection.roundSettlement).toMatchObject({
      kind: "WIN",
      winType: "HARD",
      winBaseMultiplier: 2,
      winnerMultiplier: 2,
      laiyou: true,
      laiyouMultiplier: 2,
    });
    expect(projection.roundOutcome).toMatchObject({ kind: "WIN", laiyou: true });
  });

  it("projects a non-laiyou win with a neutral laiyou multiplier", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "WIN",
      winnerSeat: 1,
      winType: "SOFT",
      laiyou: false,
      nextDealerSeat: 3,
      scoreDeltas: [
        { seat: 1, delta: 6, reason: "SELF_DRAW" },
        { seat: 0, delta: -2, reason: "SELF_DRAW" },
        { seat: 2, delta: -2, reason: "SELF_DRAW" },
        { seat: 3, delta: -2, reason: "SELF_DRAW" },
      ],
    };

    expect(service.project(room, owner.id).roundSettlement).toMatchObject({
      laiyou: false,
      laiyouMultiplier: 1,
    });
  });

  it("defaults laiyou fields when restoring a round snapshot that predates them", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const service = new RoomService(database);
    const room = service.createRoom(owner, 2, "BOT");
    const round = activeRound(room);
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "WIN",
      winnerSeat: 0,
      winType: "HARD",
      laiyou: false,
      nextDealerSeat: 2,
      scoreDeltas: [
        { seat: 0, delta: 6, reason: "SELF_DRAW" },
        { seat: 1, delta: -2, reason: "SELF_DRAW" },
        { seat: 2, delta: -2, reason: "SELF_DRAW" },
        { seat: 3, delta: -2, reason: "SELF_DRAW" },
      ],
    };
    room.stage = "ROUND_RESULT";

    const legacySnapshot = JSON.parse(JSON.stringify(room)) as {
      code: string;
      round: { laiyouCandidate?: unknown; outcome: { laiyou?: unknown } };
    };
    legacySnapshot.code = "100003";
    delete legacySnapshot.round.laiyouCandidate;
    delete legacySnapshot.round.outcome.laiyou;
    database.saveRoom(
      { id: room.id, code: "100003", status: room.status, version: room.version },
      JSON.stringify(legacySnapshot),
    );

    const restoredService = new RoomService(database);
    const restored = restoredService.getRoom("100003");
    if (restored === null) throw new Error("Expected the legacy round to restore");

    expect(restored.round?.laiyouCandidate).toBeNull();
    expect(restoredService.project(restored, owner.id).roundSettlement).toMatchObject({
      laiyou: false,
      laiyouMultiplier: 1,
    });
  });

  it("resets cumulative scores once four humans replace every bot and get ready", () => {
    const service = createService();
    const room = service.createRoom(owner, 2, "FRIEND");
    for (let index = 0; index < 3; index += 1) service.addBot(owner.id, room.code);
    service.setReady(owner.id, room.code, true);

    expect(room.stage).toBe("PLAYING");
    expect(room.fullTableScoreResetDone).toBe(false);

    const guests: AnonymousSession[] = [
      { id: "guest-1", nickname: "甲" },
      { id: "guest-2", nickname: "乙" },
      { id: "guest-3", nickname: "丙" },
    ];
    for (const guest of guests) service.joinRoom(guest, room.code);
    expect(room.spectators).toHaveLength(3);

    const botRound = activeRound(room);
    botRound.players[0].score = 12;
    botRound.players[1].score = -4;
    botRound.players[2].score = -4;
    botRound.players[3].score = -4;
    botRound.phase = "ROUND_OVER";
    botRound.outcome = { kind: "DRAW", nextDealerSeat: 0 };
    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();
    service.tick(Date.now());

    expect(room.stage).toBe("WAITING");
    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(room.scores).toEqual({ 0: 12, 1: -4, 2: -4, 3: -4 });
    expect(service.project(room, owner.id).scoreResetPending).toBe(true);

    for (const guest of guests) service.setReady(guest.id, room.code, true);
    service.setReady(owner.id, room.code, true);

    expect(room.stage).toBe("PLAYING");
    expect(room.scores).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
    expect(activeRound(room).startingScores).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
    expect(room.fullTableScoreResetDone).toBe(true);
    expect(service.project(room, owner.id).scoreResetPending).toBe(false);
  });

  it("never resets again after a disconnect, bot substitution and reconnect", () => {
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
    expect(room.fullTableScoreResetDone).toBe(true);

    // A seated human leaves mid-round, so a bot takes the seat for the next round.
    const leaver = guests[2] ?? { id: "", nickname: "" };
    service.leaveRoom(leaver.id, room.code);
    expect(room.seats[3].controller).toBe("BOT");

    const botRound = activeRound(room);
    botRound.players[0].score = 20;
    botRound.players[1].score = -6;
    botRound.players[2].score = -7;
    botRound.players[3].score = -7;
    botRound.phase = "ROUND_OVER";
    botRound.outcome = { kind: "DRAW", nextDealerSeat: 0 };
    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();
    service.tick(Date.now());
    expect(room.stage).toBe("WAITING");

    // The player reconnects into the bot seat and the table is all-human again.
    expect(service.joinRoom(leaver, room.code)).toBe(room);
    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(service.project(room, owner.id).scoreResetPending).toBe(false);

    for (const guest of guests) service.setReady(guest.id, room.code, true);
    service.setReady(owner.id, room.code, true);

    expect(room.stage).toBe("PLAYING");
    expect(activeRound(room).startingScores).toEqual({ 0: 20, 1: -6, 2: -7, 3: -7 });
  });

  it("keeps cumulative scores across consecutive all-human friend rounds", () => {
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
    // The one-shot reset is spent on this first all-human round, where the
    // ledger is already zero.
    expect(room.fullTableScoreResetDone).toBe(true);

    const firstRound = activeRound(room);
    firstRound.players[0].score = 9;
    firstRound.players[1].score = -3;
    firstRound.players[2].score = -3;
    firstRound.players[3].score = -3;
    firstRound.phase = "ROUND_OVER";
    firstRound.outcome = { kind: "DRAW", nextDealerSeat: 1 };
    room.stage = "ROUND_RESULT";
    room.nextRoundAt = new Date(0).toISOString();
    service.tick(Date.now());

    expect(service.project(room, owner.id).scoreResetPending).toBe(false);

    for (const guest of guests) service.setReady(guest.id, room.code, true);
    service.setReady(owner.id, room.code, true);

    expect(activeRound(room).startingScores).toEqual({ 0: 9, 1: -3, 2: -3, 3: -3 });
  });

  it("infers whether legacy snapshots still owe their full-table reset", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const service = new RoomService(database);

    const botRoom = service.createRoom(owner, 2, "FRIEND");
    service.addBot(owner.id, botRoom.code);
    const botSnapshot = JSON.parse(JSON.stringify(botRoom)) as Record<string, unknown>;
    botSnapshot.code = "100001";
    botSnapshot.scores = { 0: 7, 1: -7, 2: 0, 3: 0 };
    delete botSnapshot.fullTableScoreResetDone;
    database.saveRoom(
      { id: botRoom.id, code: "100001", status: botRoom.status, version: botRoom.version },
      JSON.stringify(botSnapshot),
    );

    const humanRoom = service.createRoom({ id: "owner-2", nickname: "房主二" }, 2, "FRIEND");
    for (const guest of [
      { id: "guest-a", nickname: "甲" },
      { id: "guest-b", nickname: "乙" },
      { id: "guest-c", nickname: "丙" },
    ]) {
      service.joinRoom(guest, humanRoom.code);
    }
    const humanSnapshot = JSON.parse(JSON.stringify(humanRoom)) as Record<string, unknown>;
    humanSnapshot.code = "100002";
    humanSnapshot.scores = { 0: 5, 1: -5, 2: 0, 3: 0 };
    delete humanSnapshot.fullTableScoreResetDone;
    database.saveRoom(
      { id: humanRoom.id, code: "100002", status: humanRoom.status, version: humanRoom.version },
      JSON.stringify(humanSnapshot),
    );

    const restoredService = new RoomService(database);
    const restoredBotRoom = restoredService.getRoom("100001");
    const restoredHumanRoom = restoredService.getRoom("100002");
    if (restoredBotRoom === null || restoredHumanRoom === null) {
      throw new Error("Expected both legacy rooms to restore");
    }

    expect(restoredBotRoom.fullTableScoreResetDone).toBe(false);
    expect(restoredBotRoom.scores).toEqual({ 0: 7, 1: -7, 2: 0, 3: 0 });
    expect(restoredHumanRoom.fullTableScoreResetDone).toBe(true);
    expect(restoredHumanRoom.scores).toEqual({ 0: 5, 1: -5, 2: 0, 3: 0 });
    expect(restoredService.project(restoredHumanRoom, owner.id).scoreResetPending).toBe(false);
  });
});
