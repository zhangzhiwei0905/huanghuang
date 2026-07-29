import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompetitiveMatchCreationConflictError,
  GameDatabase,
  type AnonymousSession,
} from "./database.js";
import {
  MATCHMAKING_BOT_FILL_WAIT_MS,
  MATCHMAKING_DISCONNECT_GRACE_MS,
  MATCHMAKING_HEARTBEAT_TIMEOUT_MS,
  MatchmakingService,
} from "./matchmaking-service.js";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");

function player(index: number): AnonymousSession {
  return {
    id: `player-${index}`,
    nickname: `玩家${index}`,
    wechatOpenId: `openid-${index}`,
    avatarUrl: null,
  };
}

describe("MatchmakingService", () => {
  const databases: GameDatabase[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function setup(onlineIds = new Set<string>()) {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const players: [
      AnonymousSession,
      AnonymousSession,
      AnonymousSession,
      AnonymousSession,
      AnonymousSession,
    ] = [player(0), player(1), player(2), player(3), player(4)];
    for (const [index, session] of players.entries()) {
      database.createSession(session, `token-${index}`);
    }
    let matchNumber = 0;
    const service = new MatchmakingService(
      database,
      (sessionId) => onlineIds.has(sessionId),
      (matchedPlayers, now) => {
        matchNumber += 1;
        const matchId = `match-${matchNumber}`;
        const roomId = `room-${matchNumber}`;
        const room = { id: roomId, code: `400${matchNumber}`, status: "ACTIVE", version: 1 };
        database.createCompetitiveMatch({
          match: {
            id: matchId,
            roomId,
            roundId: `round-${matchNumber}`,
            ruleVersion: 1,
            createdAt: new Date(now).toISOString(),
          },
          room,
          stateJson: JSON.stringify(room),
          players: matchedPlayers.map(({ session, entry }, seat) => ({
            sessionId: session.id,
            seat,
            queueVersion: entry.version,
          })),
        });
        return { matchId, roomId };
      },
      NOW,
    );
    return { database, onlineIds, players, service };
  }

  it("requires a linked WeChat identity", () => {
    const { service } = setup();
    expect(() => service.enqueue({ id: "guest", nickname: "游客" }, NOW)).toThrow(
      "WECHAT_LINK_REQUIRED",
    );
  });

  it("starts grace after heartbeat expiry and removes the entry ten seconds later", () => {
    const { database, players, service } = setup();

    expect(service.enqueue(players[0], NOW)).toMatchObject({
      status: "QUEUED",
      disconnectedAt: null,
    });
    const graceStartedAt = NOW + MATCHMAKING_HEARTBEAT_TIMEOUT_MS + 1;
    expect(service.tick(graceStartedAt).changedSessionIds).toEqual([players[0].id]);
    expect(database.getMatchmakingEntry(players[0].id)?.disconnectedAt).toBe(
      new Date(graceStartedAt).toISOString(),
    );
    expect(
      service.tick(graceStartedAt + MATCHMAKING_DISCONNECT_GRACE_MS - 1).changedSessionIds,
    ).toEqual([]);
    expect(
      service.tick(graceStartedAt + MATCHMAKING_DISCONNECT_GRACE_MS).changedSessionIds,
    ).toEqual([players[0].id]);
    expect(database.getMatchmakingEntry(players[0].id)).toBeNull();
  });

  it("restores a queued player on connection without resetting queue time", () => {
    const { database, onlineIds, players, service } = setup();
    service.enqueue(players[0], NOW);
    service.tick(NOW + MATCHMAKING_HEARTBEAT_TIMEOUT_MS + 1);
    onlineIds.add(players[0].id);

    expect(service.setConnected(players[0].id, true, NOW + 5_000)).toMatchObject({
      status: "QUEUED",
      enqueuedAt: new Date(NOW).toISOString(),
      disconnectedAt: null,
    });
    expect(database.getMatchmakingEntry(players[0].id)?.version).toBe(3);
  });

  it("atomically creates a match for four online compatible players", () => {
    const { database, onlineIds, players, service } = setup();
    for (const session of players.slice(0, 4)) {
      onlineIds.add(session.id);
      service.enqueue(session, NOW);
    }

    const result = service.tick(NOW);

    expect(result.matches).toEqual([
      {
        matchId: "match-1",
        roomId: "room-1",
        sessionIds: players.slice(0, 4).map((session) => session.id),
      },
    ]);
    expect(database.listMatchmakingEntries()).toEqual([]);
    expect(service.getState(players[0].id)).toEqual({
      status: "MATCHED",
      matchId: "match-1",
      roomId: "room-1",
    });
  });

  it("propagates infrastructure failures from competitive room creation", () => {
    const { onlineIds, players, service } = setup();
    for (const session of players.slice(0, 4)) {
      onlineIds.add(session.id);
      service.enqueue(session, NOW);
    }
    (
      service as unknown as {
        createCompetitiveRoom: () => never;
      }
    ).createCompetitiveRoom = () => {
      throw new Error("DATABASE_UNAVAILABLE");
    };

    expect(() => service.tick(NOW)).toThrow("DATABASE_UNAVAILABLE");
  });

  it("retries next tick on a genuine match-creation conflict instead of throwing", () => {
    const { onlineIds, players, service } = setup();
    for (const session of players.slice(0, 4)) {
      onlineIds.add(session.id);
      service.enqueue(session, NOW);
    }
    (
      service as unknown as {
        createCompetitiveRoom: () => never;
      }
    ).createCompetitiveRoom = () => {
      throw new CompetitiveMatchCreationConflictError(
        "Competitive match creation expected four current online queue entries, deleted 3",
      );
    };

    expect(service.tick(NOW)).toEqual({ changedSessionIds: [], matches: [] });
  });

  it("does not swallow an unrelated Error that merely resembles a conflict message", () => {
    const { onlineIds, players, service } = setup();
    for (const session of players.slice(0, 4)) {
      onlineIds.add(session.id);
      service.enqueue(session, NOW);
    }
    (
      service as unknown as {
        createCompetitiveRoom: () => never;
      }
    ).createCompetitiveRoom = () => {
      // Same wording a conflict used to carry before this became a typed
      // error — but it's a plain Error, so it must still reach the caller
      // instead of being silently swallowed as a retryable race.
      throw new Error("expected four current online queue entries, deleted 3");
    };

    expect(() => service.tick(NOW)).toThrow(
      "expected four current online queue entries, deleted 3",
    );
  });

  it("cancels only queued state and keeps an active match recoverable", () => {
    const { onlineIds, players, service } = setup();
    for (const session of players.slice(0, 4)) {
      onlineIds.add(session.id);
      service.enqueue(session, NOW);
    }
    service.tick(NOW);

    expect(service.cancel(players[0].id)).toEqual({
      status: "MATCHED",
      matchId: "match-1",
      roomId: "room-1",
    });
  });

  it("groups allowBots players after the wait window and fills the table with bots", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const humans: [AnonymousSession, AnonymousSession] = [player(0), player(1)];
    for (const [index, session] of humans.entries()) {
      database.createSession(session, `token-${index}`);
    }
    const botSessions: AnonymousSession[] = [
      { id: "bot-a", nickname: "赌神", wechatOpenId: null, avatarUrl: null },
      { id: "bot-b", nickname: "赌侠", wechatOpenId: null, avatarUrl: null },
      { id: "bot-c", nickname: "赌圣", wechatOpenId: null, avatarUrl: null },
    ];
    for (const bot of botSessions) {
      database.ensureRankedBotSession({
        id: bot.id,
        nickname: bot.nickname,
        avatarUrl: null,
        rankLevel: 17,
      });
    }
    const onlineIds = new Set<string>(humans.map((human) => human.id));
    let matchNumber = 0;
    const service = new MatchmakingService(
      database,
      (sessionId) => onlineIds.has(sessionId),
      () => {
        throw new Error("human-only path should not run for a bot match");
      },
      NOW,
      {
        enabled: true,
        bots: botSessions,
        createRoom: (matchedHumans, bots, now) => {
          matchNumber += 1;
          const matchId = `bot-match-${matchNumber}`;
          const roomId = `bot-room-${matchNumber}`;
          const room = { id: roomId, code: `500${matchNumber}`, status: "ACTIVE", version: 1 };
          database.createCompetitiveMatchWithBots({
            match: {
              id: matchId,
              roomId,
              roundId: `round-${matchNumber}`,
              ruleVersion: 1,
              createdAt: new Date(now).toISOString(),
            },
            room,
            stateJson: JSON.stringify(room),
            humanPlayers: matchedHumans.map(({ session, entry }, seat) => ({
              sessionId: session.id,
              seat,
              queueVersion: entry.version,
            })),
            botPlayers: bots.map((bot, offset) => ({
              sessionId: bot.id,
              seat: matchedHumans.length + offset,
            })),
          });
          return { matchId, roomId };
        },
      },
    );

    // Two friends queue with allowBots within the same window.
    service.enqueue(humans[0], NOW, true);
    service.enqueue(humans[1], NOW + 1_000, true);

    // Before the wait window expires: no match yet — friends are still gathering.
    expect(service.tick(NOW + 2_000).matches).toEqual([]);

    // After the window: both humans land in the same match, bots fill the rest.
    const result = service.tick(NOW + MATCHMAKING_BOT_FILL_WAIT_MS + 1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.sessionIds).toEqual([humans[0].id, humans[1].id]);
    expect(database.listMatchmakingEntries()).toEqual([]);
    for (const human of humans) {
      expect(service.getState(human.id).status).toBe("MATCHED");
    }
  });

  it("keeps a still-queued allowBots preference after a MatchmakingService restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "huanghuang-matchmaking-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "game.sqlite");

    const human = player(0);
    const botSessions: AnonymousSession[] = [
      { id: "bot-a", nickname: "赌神", wechatOpenId: null, avatarUrl: null },
      { id: "bot-b", nickname: "赌侠", wechatOpenId: null, avatarUrl: null },
      { id: "bot-c", nickname: "赌圣", wechatOpenId: null, avatarUrl: null },
    ];
    const onlineIds = new Set<string>([human.id]);
    let matchNumber = 0;

    function buildService(db: GameDatabase, startupAt: number): MatchmakingService {
      return new MatchmakingService(
        db,
        (sessionId) => onlineIds.has(sessionId),
        () => {
          throw new Error("human-only path should not run for a bot match");
        },
        startupAt,
        {
          enabled: true,
          bots: botSessions,
          createRoom: (matchedHumans, bots, now) => {
            matchNumber += 1;
            const matchId = `bot-match-${matchNumber}`;
            const roomId = `bot-room-${matchNumber}`;
            const room = { id: roomId, code: `600${matchNumber}`, status: "ACTIVE", version: 1 };
            db.createCompetitiveMatchWithBots({
              match: {
                id: matchId,
                roomId,
                roundId: `round-${matchNumber}`,
                ruleVersion: 1,
                createdAt: new Date(now).toISOString(),
              },
              room,
              stateJson: JSON.stringify(room),
              humanPlayers: matchedHumans.map(({ session, entry }, seat) => ({
                sessionId: session.id,
                seat,
                queueVersion: entry.version,
              })),
              botPlayers: bots.map((bot, offset) => ({
                sessionId: bot.id,
                seat: matchedHumans.length + offset,
              })),
            });
            return { matchId, roomId };
          },
        },
      );
    }

    let database = new GameDatabase(path);
    databases.push(database);
    database.createSession(human, "token-0");
    for (const bot of botSessions) {
      database.ensureRankedBotSession({
        id: bot.id,
        nickname: bot.nickname,
        avatarUrl: null,
        rankLevel: 17,
      });
    }

    let service = buildService(database, NOW);
    service.enqueue(human, NOW, true);
    // Preference made it to the DB row, not just the in-memory cache.
    expect(database.getMatchmakingEntry(human.id)?.allowBots).toBe(true);

    // Simulate a process restart shortly after: close and reopen the same
    // on-disk database, then construct a brand-new MatchmakingService
    // (empty heartbeat/allowBots caches) against it.
    database.close();
    databases.splice(databases.indexOf(database), 1);
    database = new GameDatabase(path);
    databases.push(database);
    service = buildService(database, NOW + 1_000);

    // No match yet — the bot-fill wait window hasn't elapsed.
    expect(service.tick(NOW + 2_000).matches).toEqual([]);

    // Once the window elapses, the restarted service still knows this
    // session opted into bot matches (read from the DB row, not the
    // now-empty in-memory cache) and forms a match.
    const result = service.tick(NOW + MATCHMAKING_BOT_FILL_WAIT_MS + 1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.sessionIds).toEqual([human.id]);
    expect(service.getState(human.id).status).toBe("MATCHED");
  });

  it("fills multiple bot tables concurrently from a shared pool and waits once bots run out", () => {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const humans: AnonymousSession[] = [player(0), player(1), player(2), player(3)];
    for (const [index, session] of humans.entries()) {
      database.createSession(session, `token-${index}`);
    }
    // Ten bots (matching the expanded ranked bot roster): enough to fill
    // three 1-human tables (3 bots each) with one spare bot left over.
    const botSessions: AnonymousSession[] = Array.from({ length: 10 }, (_, index) => ({
      id: `bot-${index}`,
      nickname: `机器人${index}`,
      wechatOpenId: null,
      avatarUrl: null,
    }));
    for (const bot of botSessions) {
      database.ensureRankedBotSession({
        id: bot.id,
        nickname: bot.nickname,
        avatarUrl: null,
        rankLevel: 0,
      });
    }
    const onlineIds = new Set<string>(humans.map((human) => human.id));
    let matchNumber = 0;
    const botsByMatch: string[][] = [];
    const service = new MatchmakingService(
      database,
      (sessionId) => onlineIds.has(sessionId),
      () => {
        throw new Error("human-only path should not run for a bot match");
      },
      NOW,
      {
        enabled: true,
        bots: botSessions,
        createRoom: (matchedHumans, bots, now) => {
          matchNumber += 1;
          const matchId = `bot-match-${matchNumber}`;
          const roomId = `bot-room-${matchNumber}`;
          const room = { id: roomId, code: `700${matchNumber}`, status: "ACTIVE", version: 1 };
          botsByMatch.push(bots.map((bot) => bot.id));
          database.createCompetitiveMatchWithBots({
            match: {
              id: matchId,
              roomId,
              roundId: `round-${matchNumber}`,
              ruleVersion: 1,
              createdAt: new Date(now).toISOString(),
            },
            room,
            stateJson: JSON.stringify(room),
            humanPlayers: matchedHumans.map(({ session, entry }, seat) => ({
              sessionId: session.id,
              seat,
              queueVersion: entry.version,
            })),
            botPlayers: bots.map((bot, offset) => ({
              sessionId: bot.id,
              seat: matchedHumans.length + offset,
            })),
          });
          return { matchId, roomId };
        },
      },
    );

    let now = NOW;
    // Three separate single-human allowBots requests, spaced far enough apart
    // that each is resolved (and its bots committed to an active match)
    // before the next one arrives — simulating three tables running at once.
    for (let index = 0; index < 3; index += 1) {
      const human = humans[index];
      if (human === undefined) throw new Error("Expected a human fixture at this index");
      service.enqueue(human, now, true);
      now += MATCHMAKING_BOT_FILL_WAIT_MS + 1;
      const result = service.tick(now);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.sessionIds).toEqual([human.id]);
      now += 1_000;
    }

    expect(botsByMatch).toHaveLength(3);
    // Every table drew a disjoint set of bots from the shared pool — no bot
    // session id was ever handed to two concurrently-active tables.
    const allBotIds = botsByMatch.flat();
    expect(new Set(allBotIds).size).toBe(allBotIds.length);
    expect(allBotIds).toHaveLength(9);

    // Only one bot is left idle (10 - 9), fewer than the three a fourth table
    // needs, so the fourth request waits instead of matching.
    const fourthHuman = humans[3];
    if (fourthHuman === undefined) throw new Error("Expected a fourth human fixture");
    service.enqueue(fourthHuman, now, true);
    now += MATCHMAKING_BOT_FILL_WAIT_MS + 1;
    const fourthResult = service.tick(now);
    expect(fourthResult.matches).toEqual([]);
    expect(service.getState(fourthHuman.id).status).toBe("QUEUED");
  });
});
