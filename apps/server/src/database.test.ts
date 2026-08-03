import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase } from "./database.js";

describe("GameDatabase.resumeWechatSession", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.connection.close();
    }
  });

  function createDatabase(): GameDatabase {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    return database;
  }

  it("does not create a placeholder identity for an unknown openid", () => {
    const database = createDatabase();

    expect(database.resumeWechatSession("missing-openid", "new-token-hash")).toBeNull();
    expect(database.findSessionByOpenId("missing-openid")).toBeNull();
    expect(database.findSessionByTokenHash("new-token-hash")).toBeNull();
  });

  it("rotates the token without replacing the saved nickname or avatar", () => {
    const database = createDatabase();
    database.upsertWechatSession(
      {
        openId: "known-openid",
        nickname: "阿岚",
        avatarUrl: "/avatars/alan.png",
      },
      "old-token-hash",
    );

    const resumed = database.resumeWechatSession("known-openid", "new-token-hash");

    expect(resumed).toMatchObject({
      nickname: "阿岚",
      avatarUrl: "/avatars/alan.png",
      wechatOpenId: "known-openid",
    });
    expect(database.findSessionByTokenHash("old-token-hash")).toBeNull();
    expect(database.findSessionByTokenHash("new-token-hash")).toMatchObject({
      nickname: "阿岚",
      avatarUrl: "/avatars/alan.png",
    });
  });
});

describe("GameDatabase app_version", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.connection.close();
    }
  });

  function createDatabase(): GameDatabase {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    return database;
  }

  it("returns null when no row has been written yet", () => {
    const database = createDatabase();

    expect(database.getAppVersion()).toBeNull();
  });

  it("round-trips a written row", () => {
    const database = createDatabase();

    database.upsertAppVersion({
      version: "1.0.0",
      lastRevision: "abc1234",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(database.getAppVersion()).toEqual({
      version: "1.0.0",
      lastRevision: "abc1234",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
  });

  it("upserting twice keeps a single row (id = 1 invariant)", () => {
    const database = createDatabase();

    database.upsertAppVersion({
      version: "1.0.0",
      lastRevision: "abc1234",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    database.upsertAppVersion({
      version: "1.0.1",
      lastRevision: "def5678",
      updatedAt: "2026-07-29T01:00:00.000Z",
    });

    expect(database.getAppVersion()).toEqual({
      version: "1.0.1",
      lastRevision: "def5678",
      updatedAt: "2026-07-29T01:00:00.000Z",
    });
    const rowCount = (
      database.connection.prepare("SELECT COUNT(*) AS count FROM app_version").get() as {
        count: number;
      }
    ).count;
    expect(rowCount).toBe(1);
  });
});

describe("GameDatabase friend matches", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.connection.close();
    }
  });

  function createDatabase(): GameDatabase {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    return database;
  }

  const players = [0, 1, 2, 3].map((seat) => ({ sessionId: `friend-${seat}`, seat }));

  function registerPlayers(database: GameDatabase): void {
    for (const { sessionId } of players) {
      database.createSession({ id: sessionId, nickname: sessionId }, `token-${sessionId}`);
    }
  }

  it("tags friend rows and keeps them out of every ranked-only query", () => {
    const database = createDatabase();
    registerPlayers(database);

    const settlement = database.createFriendMatch({
      id: "friend-match-1",
      roomId: "friend-room-1",
      roundId: "friend-round-1",
      ruleVersion: 1,
      players,
    });

    expect(settlement.match).toMatchObject({
      id: "friend-match-1",
      kind: "FRIEND",
      status: "ACTIVE",
      resultJson: null,
      settledAt: null,
    });
    // Player rows are pre-acknowledged so they can never surface as a
    // pending ranked result, and deltas stay NULL.
    expect(settlement.players).toHaveLength(4);
    expect(settlement.players.every((player) => player.acknowledgedAt !== null)).toBe(true);

    for (const { sessionId } of players) {
      expect(database.getCurrentCompetitiveMatch(sessionId)).toBeNull();
      expect(database.getRecentCompetitiveOpponentIds(sessionId)).toEqual([]);
      expect(database.listCompetitiveMatchHistory(sessionId, { limit: 10 })).toEqual([]);
    }
  });

  it("settles a friend match exactly once without touching ranks", () => {
    const database = createDatabase();
    registerPlayers(database);
    database.createFriendMatch({
      id: "friend-match-2",
      roomId: "friend-room-2",
      roundId: "friend-round-2",
      ruleVersion: 1,
      players,
    });

    expect(database.settleFriendMatch("friend-match-2")).toBe(true);
    const settled = database.getCompetitiveMatchSettlement("friend-match-2");
    expect(settled?.match.status).toBe("SETTLED");
    expect(settled?.match.settledAt).not.toBeNull();
    expect(settled?.players.every((player) => player.finalRankDelta === null)).toBe(true);

    // Idempotent: a second settle finds no ACTIVE friend row.
    expect(database.settleFriendMatch("friend-match-2")).toBe(false);
    // Ranked rows are never touched by settleFriendMatch.
    expect(database.settleFriendMatch("ranked-match-missing")).toBe(false);
  });

  it("defaults legacy match rows to the RANKED kind", () => {
    const database = createDatabase();

    database.connection
      .prepare(
        `INSERT INTO competitive_matches
           (id, room_id, round_id, rule_version, status, created_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
      )
      .run("legacy-match", "legacy-room", "legacy-round", 1, "2026-07-01T00:00:00.000Z");

    expect(database.getCompetitiveMatchSettlement("legacy-match")?.match.kind).toBe("RANKED");
  });
});
