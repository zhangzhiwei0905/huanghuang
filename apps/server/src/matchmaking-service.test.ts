import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase, type AnonymousSession } from "./database.js";
import {
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

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
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
});
