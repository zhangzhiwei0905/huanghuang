import {
  declareAddedKong,
  declareWin,
  discardTile,
  sameTileKind,
  type RoundState,
} from "@huanghuang/game-engine";
import type { Meld, Tile, TileKind } from "@huanghuang/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RANKED_BOTS, rankedBotSession } from "./competitive-bots.js";
import { GameDatabase, type AnonymousSession } from "./database.js";
import {
  CLOSED_ROOM_EVICTION_MS,
  MATCH_SETTLEMENT_RETENTION_MS,
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

  function createCompetitiveFixture() {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const sessions: AnonymousSession[] = [0, 1, 2, 3].map((index) => ({
      id: `match-player-${index}`,
      nickname: `竞技玩家${index}`,
      avatarUrl: `/avatars/match-player-${index}.png`,
      wechatOpenId: `openid-match-player-${index}`,
    }));
    for (const [index, session] of sessions.entries()) {
      database.createSession(session, `token-match-player-${index}`);
      database.ensureCompetitiveProfile(session.id);
    }
    const entries = sessions.map((session, index) =>
      database.upsertMatchmakingEntry({
        sessionId: session.id,
        rankLevelSnapshot: 0,
        enqueuedAt: new Date(index).toISOString(),
      }),
    );
    const service = new RoomService(database);
    const room = service.createCompetitiveMatch(sessions, entries);
    return { database, entries, room, service, sessions };
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

  it("projects a linked player's permanent rank in ordinary friend rooms", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const linkedOwner: AnonymousSession = {
      id: "linked-friend-owner",
      nickname: "有段位的房主",
      wechatOpenId: "linked-friend-openid",
      avatarUrl: "/avatars/linked-friend-owner.png",
    };
    database.createSession(linkedOwner, "linked-friend-token");
    database.ensureCompetitiveProfile(linkedOwner.id);
    const service = new RoomService(database);
    const room = service.createRoom(linkedOwner, 2, "FRIEND");

    expect(service.project(room, linkedOwner.id).lobbySeats[0]?.competitiveProfile).toMatchObject({
      rankDisplay: { displayName: "黑铁Ⅴ" },
      achievements: {
        exposedKong: 0,
        indicatorPongKong: 0,
        addedKong: 0,
        concealedKong: 0,
        releaseWildcard: 0,
      },
    });
  });

  it("lets the owner queue a 1-4 player ranked party while requiring invited players to prepare", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const sessions: AnonymousSession[] = [0, 1, 2].map((index) => ({
      id: `team-player-${index}`,
      nickname: `组队玩家${index}`,
      wechatOpenId: `team-openid-${index}`,
      avatarUrl: null,
    }));
    for (const [index, session] of sessions.entries()) {
      database.createSession(session, `team-token-${index}`);
      database.ensureCompetitiveProfile(session.id);
    }
    const service = new RoomService(database);
    const first = sessions[0];
    const second = sessions[1];
    const third = sessions[2];
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Missing team fixture");
    }
    const room = service.createRoom(first, 10, "TEAM_MATCH", 30, "HIGH");
    expect(room).toMatchObject({
      mode: "TEAM_MATCH",
      stage: "WAITING",
      baseScore: 2,
      turnTimeoutSeconds: 20,
      botDifficulty: "LOW",
    });
    expect(service.prepareTeamMatch(first.id, room.code)).toMatchObject({
      room,
      sessions: [first],
    });
    expect(service.joinRoom(second, room.code)).toBe(room);
    expect(service.joinRoom(third, room.code)).toBe(room);
    expect(service.prepareTeamMatch(first.id, room.code)).toBe("NOT_ALL_READY");

    for (const session of [second, third]) {
      expect(service.setReady(session.id, room.code, true)).toBe(room);
    }
    expect(room.stage).toBe("WAITING");
    expect(service.prepareTeamMatch(second.id, room.code)).toBe("FORBIDDEN");
    expect(service.prepareTeamMatch(first.id, room.code)).toMatchObject({
      room,
      sessions,
    });

    database.enqueueMatchmakingParty(
      room.id,
      sessions.map((session) => ({ sessionId: session.id, rankLevelSnapshot: 0 })),
      "2026-07-28T10:00:00.000Z",
    );
    service.touchTeamMatch(room.code);
    expect(service.project(room, first.id).teamMatchmaking).toEqual({
      status: "QUEUED",
      enqueuedAt: "2026-07-28T10:00:00.000Z",
      memberCount: 3,
    });
    expect(service.joinRoom({ ...owner, id: "late-player" }, room.code)).toBe(
      "WECHAT_LINK_REQUIRED",
    );
    expect(service.setReady(first.id, room.code, false)).toBe("ACTION_NOT_AVAILABLE");

    database.cancelMatchmakingParty(room.id);
    expect(service.reconcileTeamMatchQueues()).toEqual([room]);
    expect(room.readySessionIds).toEqual([]);
    expect(service.project(room, first.id).teamMatchmaking).toEqual({ status: "IDLE" });
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

    expect(projection.schemaVersion).toBe(10);
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
        endsAt: new Date(effectStartedAt + 1_050).toISOString(),
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
      endsAt: new Date(effectStartedAt + 700).toISOString(),
    });
    expect(room.version).toBe(versionBefore + 1);

    service.tick(effectStartedAt + 699);
    expect(activeRound(room).players[1].melds.at(-1)).toBeUndefined();

    service.tick(effectStartedAt + 700);
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
    ).toBe(700);

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
    ).toBe(650);

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
    ).toBe(700);
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
      { payerSeat: 1, payerMultiplier: 2, payerEffectiveMultiplier: 8, amount: 16 },
      { payerSeat: 2, payerMultiplier: 1, payerEffectiveMultiplier: 4, amount: 8 },
      { payerSeat: 3, payerMultiplier: 1, payerEffectiveMultiplier: 4, amount: 8 },
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
      { payerSeat: 1, payerMultiplier: 2, payerEffectiveMultiplier: 4, amount: 8 },
      { payerSeat: 2, payerMultiplier: 1, payerEffectiveMultiplier: 2, amount: 4 },
      { payerSeat: 3, payerMultiplier: 1, payerEffectiveMultiplier: 2, amount: 4 },
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

  it("projects a pong immediately while committing the transition only on expiry", () => {
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
    const handCountBefore = round.players[0].hand.length;
    const discardCountBefore = round.players[1].discards.length;
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
    const pendingProjection = service.project(room, owner.id);
    expect(pendingProjection).toMatchObject({
      actingSeat: null,
      currentSeat: 0,
      roundPhase: "TURN_DECISION",
      actionDeadlineAt: null,
      legalActions: [],
      effectCue: {
        action: "PONG",
        actorSeat: 0,
        tileKind: kind,
        winType: null,
      },
    });
    expect(pendingProjection.players[0]?.handCount).toBe(handCountBefore - 2);
    expect(pendingProjection.players[0]?.hand).toHaveLength(handCountBefore - 2);
    expect(pendingProjection.players[0]?.melds.at(-1)?.kind).toBe("PONG");
    expect(pendingProjection.players[1]?.discards).toHaveLength(discardCountBefore);
    expect(
      Date.parse(room.pendingEffectTransition?.cue.endsAt ?? "") -
        Date.parse(room.pendingEffectTransition?.cue.startedAt ?? ""),
    ).toBe(450);
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
    expect(restoredService.project(restored, owner.id).players[0]?.melds.at(-1)?.kind).toBe("PONG");

    restoredService.tick(endsAt);
    expect(restored.pendingEffectTransition).toBeNull();
    expect(activeRound(restored).players[0].melds.at(-1)?.kind).toBe("PONG");
    expect(restored.version).toBe(versionBefore + 2);
  });

  it("keeps a wildcard in hand until its release effect completes", () => {
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
    expect(Date.parse(transition.cue.endsAt) - Date.parse(transition.cue.startedAt)).toBe(800);
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
      winnerMultiplier: 8,
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

  it("atomically creates and starts a fixed-config competitive room", () => {
    const { database, entries, room, service, sessions } = createCompetitiveFixture();
    const round = activeRound(room);

    expect(room).toMatchObject({
      baseScore: 2,
      turnTimeoutSeconds: 20,
      botDifficulty: "LOW",
      mode: "MATCH",
      stage: "PLAYING",
      competitiveMatch: { ruleVersion: 1 },
    });
    expect(new Set(Object.values(room.seats).map((seat) => seat.sessionId))).toEqual(
      new Set(sessions.map((session) => session.id)),
    );
    expect(Object.values(room.seats).every((seat) => seat.controller === "HUMAN")).toBe(true);
    expect(database.listMatchmakingEntries()).toEqual([]);
    const persistedMatch = database.getCompetitiveMatchSettlement(
      room.competitiveMatch?.matchId ?? "",
    );
    expect(persistedMatch?.match).toMatchObject({
      roomId: room.id,
      roundId: round.id,
      status: "ACTIVE",
      ruleVersion: 1,
    });
    expect(new Set(persistedMatch?.players.map((player) => player.sessionId))).toEqual(
      new Set(entries.map((entry) => entry.sessionId)),
    );
    expect(service.getRoom(room.code)).toBe(room);
  });

  it("resolves originRoomCode to the still-open team-ranked staging room for its party members only", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const partySessions: AnonymousSession[] = [0, 1].map((index) => ({
      id: `party-player-${index}`,
      nickname: `队员${index}`,
      wechatOpenId: `openid-party-player-${index}`,
    }));
    const soloSessions: AnonymousSession[] = [0, 1].map((index) => ({
      id: `solo-player-${index}`,
      nickname: `单排${index}`,
      wechatOpenId: `openid-solo-player-${index}`,
    }));
    const sessions = [...partySessions, ...soloSessions];
    for (const [index, session] of sessions.entries()) {
      database.createSession(session, `origin-room-token-${index}`);
      database.ensureCompetitiveProfile(session.id);
    }
    const service = new RoomService(database);
    const [partyOwner, partyMember] = partySessions;
    if (partyOwner === undefined || partyMember === undefined) {
      throw new Error("Missing party fixture");
    }
    const stagingRoom = service.createRoom(partyOwner, 10, "TEAM_MATCH", 30, "HIGH");
    expect(service.joinRoom(partyMember, stagingRoom.code)).toBe(stagingRoom);
    expect(service.setReady(partyMember.id, stagingRoom.code, true)).toBe(stagingRoom);
    database.enqueueMatchmakingParty(
      stagingRoom.id,
      partySessions.map((session) => ({ sessionId: session.id, rankLevelSnapshot: 0 })),
      "2026-07-31T00:00:00.000Z",
    );
    for (const session of soloSessions) {
      database.upsertMatchmakingEntry({ sessionId: session.id, rankLevelSnapshot: 0 });
    }
    const entries = sessions.map((session) => {
      const entry = database.getMatchmakingEntry(session.id);
      if (entry === null) throw new Error(`Missing matchmaking entry for ${session.id}`);
      return entry;
    });

    const matchRoom = service.createCompetitiveMatch(sessions, entries);

    const partyOwnerProjection = service.project(matchRoom, partyOwner.id);
    const partyMemberProjection = service.project(matchRoom, partyMember.id);
    const soloProjection = service.project(matchRoom, soloSessions[0]?.id ?? "");
    expect(partyOwnerProjection.competitiveMatch?.originRoomCode).toBe(stagingRoom.code);
    expect(partyMemberProjection.competitiveMatch?.originRoomCode).toBe(stagingRoom.code);
    expect(soloProjection.competitiveMatch?.originRoomCode).toBeNull();

    // Once the staging room is gone (dissolved, evicted, ...), "continue"
    // must fall back gracefully instead of pointing at a dead room.
    (service as unknown as { roomsByCode: Map<string, RoomState> }).roomsByCode.delete(
      stagingRoom.code,
    );
    expect(service.project(matchRoom, partyOwner.id).competitiveMatch?.originRoomCode).toBeNull();
  });

  it("does not register a competitive room when atomic creation rejects a stale queue entry", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const sessions: AnonymousSession[] = [0, 1, 2, 3].map((index) => ({
      id: `stale-player-${index}`,
      nickname: `过期玩家${index}`,
      wechatOpenId: `openid-stale-player-${index}`,
    }));
    for (const [index, session] of sessions.entries()) {
      database.createSession(session, `token-stale-player-${index}`);
    }
    const entries = sessions.map((session) =>
      database.upsertMatchmakingEntry({ sessionId: session.id, rankLevelSnapshot: 0 }),
    );
    database.markMatchmakingEntryDisconnected(sessions[0]?.id ?? "");
    const service = new RoomService(database);

    expect(() => service.createCompetitiveMatch(sessions, entries)).toThrow(
      "expected four current online queue entries",
    );
    expect(database.loadActiveRooms()).toEqual([]);
    expect(database.listMatchmakingEntries()).toHaveLength(4);
    expect((service as unknown as { roomsByCode: Map<string, RoomState> }).roomsByCode.size).toBe(
      0,
    );
  });

  it("restricts competitive lifecycle actions and retains a leaving member as trustee", () => {
    const { room, service, sessions } = createCompetitiveFixture();
    const self = sessions.find((session) => service.project(room, session.id).selfSeat === 0);
    if (self === undefined) throw new Error("Expected the seat-zero competitive player");

    expect(service.joinRoom({ id: "match-outsider", nickname: "旁观者" }, room.code)).toBe(
      "ROOM_NOT_JOINABLE",
    );
    expect(service.joinRoom(self, room.code)).toBe("ROOM_NOT_JOINABLE");
    expect(service.setReady(self.id, room.code, true)).toBe("ACTION_NOT_AVAILABLE");
    expect(service.updateSettings(self.id, room.code, { baseScore: 5 })).toBe(
      "ACTION_NOT_AVAILABLE",
    );
    expect(service.addBot(self.id, room.code)).toBe("ACTION_NOT_AVAILABLE");
    expect(service.removeBot(self.id, room.code, 1)).toBe("ACTION_NOT_AVAILABLE");
    expect(service.createChatMessage(self.id, room.code, "竞技聊天")).toBe("ACTION_NOT_AVAILABLE");
    expect(service.requestDissolve(self.id, room.code)).toBe("FORBIDDEN");
    expect(service.continueBotRound(self.id, room.code)).toBe("ACTION_NOT_AVAILABLE");

    const versionBeforeLeave = room.version;
    expect(service.leaveRoom(self.id, room.code)).toBe(room);
    expect(room.version).toBe(versionBeforeLeave + 1);
    expect(room.seats[0]).toMatchObject({
      sessionId: self.id,
      controller: "TRUSTEE",
      connected: false,
    });
    expect(service.hasMember(self.id, room.code)).toBe(true);
    expect(service.project(room, self.id).legalActions).toEqual([]);
    expect(
      service.execute(self.id, {
        type: "CONTINUE_TURN",
        requestId: randomUUID(),
        roomId: room.id,
        roundId: activeRound(room).id,
        expectedVersion: room.version,
        payload: {},
      }),
    ).toMatchObject({ accepted: false, errorCode: "ACTION_NOT_AVAILABLE" });

    expect(service.setRoomConnected(self.id, room.id, true)).toEqual({
      roomId: room.id,
      version: versionBeforeLeave + 2,
    });
    expect(room.seats[0]).toMatchObject({ controller: "HUMAN", connected: true });
    expect(service.setRoomConnected(self.id, "another-room", false)).toBeNull();

    const round = activeRound(room);
    const discard = round.players[0].hand.find(
      (tile) => tile.suit !== round.wildcardKind.suit || tile.rank !== round.wildcardKind.rank,
    );
    if (discard === undefined) throw new Error("Expected a competitive discard");
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = discard.id;
    expect(
      service.execute(self.id, {
        type: "DISCARD_TILE",
        requestId: randomUUID(),
        roomId: room.id,
        roundId: "another-round",
        expectedVersion: room.version,
        payload: { tileId: discard.id },
      }),
    ).toMatchObject({ accepted: false, errorCode: "WRONG_PHASE" });
    expect(
      service.execute(self.id, {
        type: "DISCARD_TILE",
        requestId: randomUUID(),
        roomId: room.id,
        roundId: null,
        expectedVersion: room.version,
        payload: { tileId: discard.id },
      }),
    ).toMatchObject({ accepted: true });

    room.stage = "ROUND_RESULT";
    const otherSessionIds = Object.values(room.seats)
      .map((seat) => seat.sessionId)
      .filter((sessionId): sessionId is string => sessionId !== null && sessionId !== self.id);
    service.leaveRoom(self.id, room.code);
    expect(room.seats[0].sessionId).toBe(self.id);
    expect(otherSessionIds.every((sessionId) => service.hasMember(sessionId, room.code))).toBe(
      true,
    );
  });

  it("projects v10 competitive profiles, public multipliers, and only the requesting settlement", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    round.players[0].personalMultiplier = 2;
    round.players[1].personalMultiplier = 2;
    round.phase = "ROUND_OVER";
    round.outcome = {
      kind: "WIN",
      winnerSeat: 0,
      winType: "HARD",
      laiyou: true,
      nextDealerSeat: 0,
      scoreDeltas: [
        { seat: 0, delta: 64, reason: "SELF_DRAW" },
        { seat: 1, delta: -32, reason: "SELF_DRAW" },
        { seat: 2, delta: -16, reason: "SELF_DRAW" },
        { seat: 3, delta: -16, reason: "SELF_DRAW" },
      ],
    };
    room.stage = "ROUND_RESULT";
    const terminal = (
      service as unknown as {
        competitiveTerminalSettlement(target: RoomState): {
          settlement: Parameters<GameDatabase["saveAcceptedTransition"]>[0]["terminalSettlement"];
        } | null;
      }
    ).competitiveTerminalSettlement(room);
    if (terminal?.settlement === undefined) throw new Error("Expected competitive settlement");
    database.saveAcceptedTransition({
      room,
      stateJson: JSON.stringify(room),
      terminalSettlement: terminal.settlement,
    });

    const seatZeroSessionId = room.seats[0].sessionId;
    const seatOneSessionId = room.seats[1].sessionId;
    if (seatZeroSessionId === null || seatOneSessionId === null) {
      throw new Error("Expected competitive sessions");
    }
    const winnerProjection = service.project(room, seatZeroSessionId);
    const loserProjection = service.project(room, seatOneSessionId);

    expect(winnerProjection.schemaVersion).toBe(10);
    expect(winnerProjection.competitiveMatch).toEqual({
      ...room.competitiveMatch,
      originRoomCode: null,
    });
    expect(winnerProjection.players.every((player) => player.competitiveProfile !== null)).toBe(
      true,
    );
    expect(winnerProjection.lobbySeats.every((seat) => seat.competitiveProfile !== null)).toBe(
      true,
    );
    expect(winnerProjection.roundSettlement).toMatchObject({
      winnerMultiplier: 8,
      payments: [
        expect.objectContaining({ payerSeat: 1, payerEffectiveMultiplier: 16 }),
        expect.objectContaining({ payerSeat: 2, payerEffectiveMultiplier: 8 }),
        expect.objectContaining({ payerSeat: 3, payerEffectiveMultiplier: 8 }),
      ],
      competitiveSettlement: {
        self: { outcome: { kind: "WIN", multiplier: 8 } },
      },
    });
    expect(loserProjection.roundSettlement?.competitiveSettlement?.self.outcome).toEqual({
      kind: "LOSS",
      multiplier: 16,
    });
    expect(winnerProjection.roundSettlement?.competitiveSettlement?.self).not.toEqual(
      loserProjection.roundSettlement?.competitiveSettlement?.self,
    );
    const practiceProjection = service.project(service.createRoom(owner, 2, "BOT"), owner.id);
    expect(practiceProjection).toMatchObject({
      competitiveMatch: null,
      roundSettlement: null,
    });
    expect(
      practiceProjection.players
        .filter((player) => player.controller === "BOT")
        .every((player) => player.competitiveProfile === null),
    ).toBe(true);
  });

  it("records all five competitive achievements once from accepted authoritative effects", () => {
    const cases = [
      "EXPOSED_KONG",
      "INDICATOR_PONG_KONG",
      "ADDED_KONG",
      "CONCEALED_KONG",
      "RELEASE_WILDCARD",
    ] as const;

    for (const action of cases) {
      const { database, room, service } = createCompetitiveFixture();
      const round = activeRound(room);
      const actorSessionId = room.seats[0].sessionId;
      if (actorSessionId === null) throw new Error("Expected competitive actor");
      let command: Parameters<RoomService["execute"]>[1];
      if (action === "EXPOSED_KONG" || action === "INDICATOR_PONG_KONG") {
        const kind =
          action === "INDICATOR_PONG_KONG"
            ? { suit: round.indicatorTile.suit, rank: round.indicatorTile.rank }
            : ({ suit: "WAN", rank: 3 } as const);
        round.phase = "DISCARD_RESPONSE";
        round.currentSeat = 1;
        round.lastDiscard = {
          id: `${action}-discard`,
          tile: { id: `${action}-discard-tile`, ...kind },
          sourceSeat: 1,
        };
        round.pendingResponse = {
          seat: 0,
          actions: [action === "EXPOSED_KONG" ? "CLAIM_EXPOSED_KONG" : "CLAIM_INDICATOR_PONG_KONG"],
        };
        round.players[0].hand.splice(
          0,
          action === "EXPOSED_KONG" ? 3 : 2,
          ...["a", "b", "c"].slice(0, action === "EXPOSED_KONG" ? 3 : 2).map((suffix) => ({
            id: `${action}-${suffix}`,
            ...kind,
          })),
        );
        command = {
          type: action === "EXPOSED_KONG" ? "CLAIM_EXPOSED_KONG" : "CLAIM_INDICATOR_PONG_KONG",
          requestId: randomUUID(),
          roomId: room.id,
          roundId: round.id,
          expectedVersion: room.version,
          payload: {},
        };
      } else if (action === "ADDED_KONG") {
        const kind = { suit: "TONG" as const, rank: 7 as const };
        round.players[0].melds = [
          {
            id: "competitive-added-pong",
            kind: "PONG",
            tileIds: ["competitive-added-a", "competitive-added-b", "competitive-added-c"],
            tileKind: kind,
            sourcePlayerId: "seat-1",
            sourceDiscardId: "competitive-added-discard",
            createdAtVersion: 1,
          },
        ];
        round.players[0].hand[0] = { id: "competitive-added-tile", ...kind };
        round.phase = "TURN_DECISION";
        round.currentSeat = 0;
        round.lastDrawSeat = 0;
        round.lastDrawnTileId = "competitive-added-tile";
        command = {
          type: "DECLARE_ADDED_KONG",
          requestId: randomUUID(),
          roomId: room.id,
          roundId: round.id,
          expectedVersion: room.version,
          payload: { meldId: "competitive-added-pong", tileId: "competitive-added-tile" },
        };
      } else if (action === "CONCEALED_KONG") {
        const kind = { suit: "WAN" as const, rank: 2 as const };
        round.wildcardKind = { suit: "TONG", rank: 9 };
        const tiles = ["a", "b", "c", "d"].map((suffix) => ({
          id: `competitive-concealed-${suffix}`,
          ...kind,
        }));
        round.players[0].hand.splice(0, 4, ...tiles);
        round.phase = "TURN_DECISION";
        round.currentSeat = 0;
        round.lastDrawSeat = 0;
        round.lastDrawnTileId = tiles[3]?.id ?? "";
        command = {
          type: "DECLARE_CONCEALED_KONG",
          requestId: randomUUID(),
          roomId: room.id,
          roundId: round.id,
          expectedVersion: room.version,
          payload: kind,
        };
      } else {
        const wildcard = { id: "competitive-release-wildcard", ...round.wildcardKind };
        round.players[0].hand[0] = wildcard;
        round.phase = "TURN_DECISION";
        round.currentSeat = 0;
        command = {
          type: "RELEASE_WILDCARD",
          requestId: randomUUID(),
          roomId: room.id,
          roundId: round.id,
          expectedVersion: room.version,
          payload: { tileId: wildcard.id },
        };
      }

      const first = service.execute(actorSessionId, command);
      expect(first.accepted).toBe(true);
      expect(service.execute(actorSessionId, command)).toEqual(first);
      const profile = database.getCompetitiveProfile(actorSessionId);
      expect(
        {
          EXPOSED_KONG: profile?.exposedKongCount,
          INDICATOR_PONG_KONG: profile?.indicatorPongKongCount,
          ADDED_KONG: profile?.addedKongCount,
          CONCEALED_KONG: profile?.concealedKongCount,
          RELEASE_WILDCARD: profile?.releaseWildcardCount,
        }[action],
      ).toBe(1);
    }
  });

  it("records a HARD_LAIYOU achievement when a hard win lands on the wildcard-release draw", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    const winnerSessionId = room.seats[0].sessionId;
    if (winnerSessionId === null) throw new Error("Expected a competitive winner");
    const winningTile = testTile("laiyou-hard-winning-tile", "TIAO", 9);
    round.wildcardKind = { suit: "WAN", rank: 5 };
    round.players[0].hand = [
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-hard-wan-1-${suffix}`, "WAN", 1)),
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-hard-tiao-2-${suffix}`, "TIAO", 2)),
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-hard-tong-3-${suffix}`, "TONG", 3)),
      testTile("laiyou-hard-tiao-9-a", "TIAO", 9),
      testTile("laiyou-hard-tiao-9-b", "TIAO", 9),
      winningTile,
      testTile("laiyou-hard-wan-7-a", "WAN", 7),
      testTile("laiyou-hard-wan-7-b", "WAN", 7),
    ];
    round.currentSeat = 0;
    round.phase = "TURN_DECISION";
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = winningTile.id;
    round.winPassedThisTurn = false;
    // Marks the winning draw as the one right after this seat's most recent
    // wildcard release, exactly what isLaiyouWin() (game-engine/round.ts)
    // checks — this is what "来由" means.
    round.laiyouCandidate = { seat: 0, tileId: winningTile.id };

    const result = service.execute(winnerSessionId, {
      type: "DECLARE_WIN",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: {},
    });
    expect(result.accepted).toBe(true);
    const profile = database.getCompetitiveProfile(winnerSessionId);
    expect(profile?.hardLaiyouCount).toBe(1);
    expect(profile?.softLaiyouCount).toBe(0);
  });

  it("records a SOFT_LAIYOU achievement when a soft win lands on the wildcard-release draw", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    const winnerSessionId = room.seats[0].sessionId;
    if (winnerSessionId === null) throw new Error("Expected a competitive winner");
    const wildcard = testTile("laiyou-soft-wildcard", "WAN", 5);
    round.wildcardKind = { suit: "WAN", rank: 5 };
    round.players[0].hand = [
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-soft-wan-1-${suffix}`, "WAN", 1)),
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-soft-tiao-2-${suffix}`, "TIAO", 2)),
      ...["a", "b", "c"].map((suffix) => testTile(`laiyou-soft-tong-3-${suffix}`, "TONG", 3)),
      testTile("laiyou-soft-wan-7-a", "WAN", 7),
      testTile("laiyou-soft-wan-7-b", "WAN", 7),
      testTile("laiyou-soft-tiao-9-a", "TIAO", 9),
      testTile("laiyou-soft-tiao-9-b", "TIAO", 9),
      wildcard,
    ];
    round.currentSeat = 0;
    round.phase = "TURN_DECISION";
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = wildcard.id;
    round.winPassedThisTurn = false;
    round.laiyouCandidate = { seat: 0, tileId: wildcard.id };

    const result = service.execute(winnerSessionId, {
      type: "DECLARE_WIN",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: {},
    });
    expect(result.accepted).toBe(true);
    const profile = database.getCompetitiveProfile(winnerSessionId);
    expect(profile?.softLaiyouCount).toBe(1);
    expect(profile?.hardLaiyouCount).toBe(0);
  });

  it("attributes an INDICATOR_PONG_KONG claim to the claiming bot's session, not the discarding human's", () => {
    // Reproduces the user report that a human's own achievement counter went
    // up after a BOT claimed the human's discarded indicator-matching tile.
    // Builds a real 1-human + 3-ranked-bot MATCH room, forces a deterministic
    // "human discards an indicator-kind tile, bot has two more of that kind"
    // setup, drives the discard through the normal command path and lets the
    // bot claim automatically via tick(), then inspects the raw
    // competitive_action_events row and profile counters.
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const humanSession: AnonymousSession = {
      id: "match-human",
      nickname: "真人玩家",
      avatarUrl: "/avatars/match-human.png",
      wechatOpenId: "openid-match-human",
    };
    database.createSession(humanSession, "token-match-human");
    database.ensureCompetitiveProfile(humanSession.id);
    const entry = database.upsertMatchmakingEntry({
      sessionId: humanSession.id,
      rankLevelSnapshot: 0,
      enqueuedAt: new Date(0).toISOString(),
    });
    for (const bot of RANKED_BOTS) database.ensureRankedBotSession(bot);
    // Only three bot seats are needed to fill a 1-human table; the roster
    // has grown to ten preset bots, but this test just needs any three.
    const botSessions = RANKED_BOTS.slice(0, 3).map((bot) => rankedBotSession(bot));

    const service = new RoomService(database);
    const room = service.createCompetitiveMatchWithBots([humanSession], [entry], botSessions);
    const round = activeRound(room);

    const seats = [0, 1, 2, 3] as const;
    const humanSeat = seats.find((seat) => room.seats[seat].sessionId === humanSession.id);
    if (humanSeat === undefined) throw new Error("Expected the human to be seated");
    const botSeat = seats.find((seat) => seat !== humanSeat);
    if (botSeat === undefined) throw new Error("Expected a bot seat");
    const botSessionId = room.seats[botSeat].sessionId;
    if (botSessionId === null) throw new Error("Expected the bot seat to carry a session id");
    const initialProjection = service.project(room, humanSession.id);
    expect(initialProjection.players.every((player) => player.competitiveProfile !== null)).toBe(
      true,
    );
    const projectedBotProfile = initialProjection.players[botSeat]?.competitiveProfile;
    expect(typeof projectedBotProfile?.rankDisplay.displayName).toBe("string");
    expect(projectedBotProfile?.achievements).toEqual({
      exposedKong: 0,
      indicatorPongKong: 0,
      addedKong: 0,
      concealedKong: 0,
      releaseWildcard: 0,
      hardLaiyou: 0,
      softLaiyou: 0,
    });

    const indicatorKind = { suit: round.indicatorTile.suit, rank: round.indicatorTile.rank };
    // Strip any incidental copies of the indicator's kind dealt by the random
    // shuffle, then hand the human exactly one matching tile to discard and
    // the bot exactly two, so which seat can (and does) claim is unambiguous.
    for (const seat of seats) {
      round.players[seat].hand = round.players[seat].hand.filter(
        (tile) => !sameTileKind(tile, indicatorKind),
      );
    }
    round.players[humanSeat].hand.push({ id: "human-indicator-match", ...indicatorKind });
    round.players[botSeat].hand.push(
      { id: "bot-indicator-match-a", ...indicatorKind },
      { id: "bot-indicator-match-b", ...indicatorKind },
    );
    round.phase = "TURN_DECISION";
    round.currentSeat = humanSeat;
    round.lastDiscard = null;
    round.pendingResponse = null;

    const discardResult = service.execute(humanSession.id, {
      type: "DISCARD_TILE",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: { tileId: "human-indicator-match" },
    });
    expect(discardResult.accepted).toBe(true);

    const afterDiscard = activeRound(room);
    expect(afterDiscard.phase).toBe("DISCARD_RESPONSE");
    expect(afterDiscard.pendingResponse).toEqual({
      seat: botSeat,
      actions: ["CLAIM_INDICATOR_PONG_KONG"],
    });

    // The bot claims automatically once its response delay elapses.
    service.tick(Date.now() + 60_000);

    const matchId = room.competitiveMatch?.matchId;
    if (matchId === undefined) throw new Error("Expected an active competitive match");
    const events = database.connection
      .prepare(
        `SELECT session_id AS sessionId FROM competitive_action_events
         WHERE match_id = ? AND action = 'INDICATOR_PONG_KONG'`,
      )
      .all(matchId) as { sessionId: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.sessionId).toBe(botSessionId);

    const botProfile = database.getCompetitiveProfile(botSessionId);
    const humanProfile = database.getCompetitiveProfile(humanSession.id);
    expect(botProfile?.indicatorPongKongCount).toBe(1);
    expect(humanProfile?.indicatorPongKongCount).toBe(0);
    expect(
      service.project(room, humanSession.id).players[botSeat]?.competitiveProfile?.achievements
        .indicatorPongKong,
    ).toBe(1);
  });

  it("settles a competitive win only after its effect and remains idempotent across restart", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    const winnerSessionId = room.seats[0].sessionId;
    const loserSessionId = room.seats[1].sessionId;
    if (winnerSessionId === null || loserSessionId === null)
      throw new Error("Expected match players");
    const wildcardKind: TileKind = { suit: "WAN", rank: 5 };
    const triplet = (prefix: string, suit: TileKind["suit"], rank: TileKind["rank"]) =>
      ["a", "b", "c"].map((suffix) => testTile(`${prefix}-${suffix}`, suit, rank));
    const winningTile = testTile("competitive-winning-tile", "TIAO", 9);
    round.wildcardKind = wildcardKind;
    round.players[0].hand = [
      ...triplet("competitive-wan-1", "WAN", 1),
      ...triplet("competitive-tiao-2", "TIAO", 2),
      ...triplet("competitive-tong-3", "TONG", 3),
      testTile("competitive-tiao-9-a", "TIAO", 9),
      testTile("competitive-tiao-9-b", "TIAO", 9),
      winningTile,
      testTile("competitive-wan-7-a", "WAN", 7),
      testTile("competitive-wan-7-b", "WAN", 7),
    ];
    round.currentSeat = 0;
    round.phase = "TURN_DECISION";
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = winningTile.id;
    round.winPassedThisTurn = false;

    const result = service.execute(winnerSessionId, {
      type: "DECLARE_WIN",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: {},
    });
    expect(result.accepted).toBe(true);
    expect(service.project(room, winnerSessionId).roundSettlement).toBeNull();
    expect(
      database.getCompetitiveMatchSettlement(room.competitiveMatch?.matchId ?? "")?.match.status,
    ).toBe("ACTIVE");
    expect(database.getCompetitiveProfile(winnerSessionId)?.rankLevel).toBe(0);

    const restoredService = new RoomService(database);
    const restored = restoredService.getRoom(room.code);
    if (
      restored?.pendingEffectTransition === undefined ||
      restored.pendingEffectTransition === null
    ) {
      throw new Error("Expected a restored competitive win effect");
    }
    const endsAt = Date.parse(restored.pendingEffectTransition.cue.endsAt);
    restoredService.tick(endsAt - 1);
    expect(
      database.getCompetitiveMatchSettlement(restored.competitiveMatch?.matchId ?? "")?.match
        .status,
    ).toBe("ACTIVE");
    restoredService.tick(endsAt);
    expect(restored.stage).toBe("ROUND_RESULT");
    expect(
      database.getCompetitiveMatchSettlement(restored.competitiveMatch?.matchId ?? "")?.match
        .status,
    ).toBe("SETTLED");
    expect(database.getCompetitiveProfile(winnerSessionId)?.rankLevel).toBe(2);
    expect(restoredService.project(restored, winnerSessionId).roundSettlement).toMatchObject({
      competitiveSettlement: { self: { outcome: { kind: "WIN", multiplier: 2 } } },
    });
    expect(restoredService.project(restored, loserSessionId).roundSettlement).toMatchObject({
      competitiveSettlement: { self: { outcome: { kind: "LOSS", multiplier: 2 } } },
    });

    restoredService.tick(endsAt + 60_000);
    const restartedAgain = new RoomService(database);
    restartedAgain.tick(endsAt + 120_000);
    expect(database.getCompetitiveProfile(winnerSessionId)?.rankLevel).toBe(2);
  });

  it("settles an accepted competitive draw atomically with zero rank changes", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    const actorSessionId = room.seats[0].sessionId;
    if (actorSessionId === null) throw new Error("Expected competitive actor");
    const discarded = round.players[0].hand.find(
      (tile) => tile.suit !== round.wildcardKind.suit || tile.rank !== round.wildcardKind.rank,
    );
    if (discarded === undefined) throw new Error("Expected a discardable tile");
    round.phase = "TURN_DECISION";
    round.currentSeat = 0;
    round.lastDrawSeat = 0;
    round.lastDrawnTileId = discarded.id;
    round.wall = [];
    for (const seat of [1, 2, 3] as const) {
      round.players[seat].hand = round.players[seat].hand.map((tile, index) => ({
        ...tile,
        id: `draw-safe-${seat}-${index}`,
        suit: discarded.suit === "WAN" ? "TIAO" : "WAN",
        rank: discarded.rank === 1 ? 2 : 1,
      }));
    }

    const result = service.execute(actorSessionId, {
      type: "DISCARD_TILE",
      requestId: randomUUID(),
      roomId: room.id,
      roundId: round.id,
      expectedVersion: room.version,
      payload: { tileId: discarded.id },
    });

    expect(result.accepted).toBe(true);
    expect(room.pendingEffectTransition).toBeNull();
    expect(room.stage).toBe("ROUND_RESULT");
    expect(
      database.getCompetitiveMatchSettlement(room.competitiveMatch?.matchId ?? "")?.match.status,
    ).toBe("SETTLED");
    for (const seat of [0, 1, 2, 3] as const) {
      const sessionId = room.seats[seat].sessionId;
      if (sessionId === null) throw new Error("Expected competitive session");
      expect(database.getCompetitiveProfile(sessionId)?.rankLevel).toBe(0);
      expect(service.project(room, sessionId).roundSettlement).toMatchObject({
        kind: "DRAW",
        competitiveSettlement: {
          self: { outcome: { kind: "DRAW" }, rawDelta: 0, appliedDelta: 0 },
        },
      });
    }
  });

  it("keeps a settled MATCH recoverable until retention expires, then acknowledges and closes it", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    round.phase = "ROUND_OVER";
    round.outcome = { kind: "DRAW", nextDealerSeat: 0 };
    room.stage = "ROUND_RESULT";
    const settledAt = Date.parse("2026-07-28T10:00:00.000Z");
    const terminal = (
      service as unknown as {
        competitiveTerminalSettlement(target: RoomState): {
          settlement: NonNullable<
            Parameters<GameDatabase["saveAcceptedTransition"]>[0]["terminalSettlement"]
          >;
        } | null;
      }
    ).competitiveTerminalSettlement(room);
    if (terminal === null) throw new Error("Expected competitive settlement");
    database.saveAcceptedTransition({
      room,
      stateJson: JSON.stringify(room),
      terminalSettlement: { ...terminal.settlement, settledAt: new Date(settledAt).toISOString() },
    });

    service.tick(settledAt + MATCH_SETTLEMENT_RETENTION_MS - 1);
    expect(room.status).toBe("ACTIVE");
    service.tick(settledAt + MATCH_SETTLEMENT_RETENTION_MS);
    expect(room).toMatchObject({ status: "CLOSED", closeReason: "MATCH_SETTLED" });
    const settlement = database.getCompetitiveMatchSettlement(room.competitiveMatch?.matchId ?? "");
    expect(settlement?.players.every((player) => player.acknowledgedAt !== null)).toBe(true);
    expect(database.getCurrentCompetitiveMatch(room.seats[0].sessionId ?? "")).toBeNull();
  });

  it("closes a settled MATCH after all four players acknowledge", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    round.phase = "ROUND_OVER";
    round.outcome = { kind: "DRAW", nextDealerSeat: 0 };
    room.stage = "ROUND_RESULT";
    const terminal = (
      service as unknown as {
        competitiveTerminalSettlement(target: RoomState): {
          settlement: NonNullable<
            Parameters<GameDatabase["saveAcceptedTransition"]>[0]["terminalSettlement"]
          >;
        } | null;
      }
    ).competitiveTerminalSettlement(room);
    if (terminal === null || room.competitiveMatch === null) {
      throw new Error("Expected competitive settlement");
    }
    database.saveAcceptedTransition({
      room,
      stateJson: JSON.stringify(room),
      terminalSettlement: terminal.settlement,
    });
    for (const seat of [0, 1, 2, 3] as const) {
      const sessionId = room.seats[seat].sessionId;
      if (sessionId === null) throw new Error("Expected competitive session");
      database.acknowledgeCompetitiveMatchResult(room.competitiveMatch.matchId, sessionId);
    }

    service.tick();
    expect(room).toMatchObject({ status: "CLOSED", closeReason: "MATCH_SETTLED" });
  });

  it("keeps live MATCH state unchanged when an automatic accepted-transition transaction fails", () => {
    const { database, room, service } = createCompetitiveFixture();
    const round = activeRound(room);
    const trusteeSessionId = room.seats[0].sessionId;
    if (trusteeSessionId === null) throw new Error("Expected competitive trustee");
    service.setRoomConnected(trusteeSessionId, room.id, false);
    round.phase = "DISCARD_RESPONSE";
    round.currentSeat = 3;
    round.lastDiscard = {
      id: "competitive-trustee-discard",
      tile: { id: "competitive-trustee-tile", suit: "WAN", rank: 3 },
      sourceSeat: 3,
    };
    round.pendingResponse = { seat: 0, actions: ["CLAIM_PONG"] };
    room.actionDeadlineAt = new Date(0).toISOString();
    const before = JSON.stringify(room);
    const save = vi.spyOn(database, "saveAcceptedTransition").mockImplementation(() => {
      throw new Error("forced transition failure");
    });

    expect(() => service.tick(Date.now())).toThrow("forced transition failure");
    expect(JSON.stringify(room)).toBe(before);

    save.mockRestore();
    service.tick(Date.now());
    expect(activeRound(room).phase).toBe("TURN_DECISION");
    expect(activeRound(room).currentSeat).toBe(0);
  });
});
