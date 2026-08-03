import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompetitiveMatchCreationConflictError,
  GameDatabase,
  type CompetitivePlayerSettlementInput,
  type CreateCompetitiveMatchInput,
} from "./database.js";
import { competitiveRankStateSchema } from "@huanghuang/protocol";

const PLAYER_IDS = ["player-0", "player-1", "player-2", "player-3"] as const;
const ENQUEUED_AT = "2026-07-28T10:00:00.000Z";

function roomSnapshot(id = "match-room", version = 1) {
  return { id, code: id === "match-room" ? "4001" : "4002", status: "ACTIVE", version };
}

describe("GameDatabase competitive persistence", () => {
  const databases: GameDatabase[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createDatabase(path = ":memory:"): GameDatabase {
    const database = new GameDatabase(path);
    databases.push(database);
    return database;
  }

  function closeDatabase(database: GameDatabase): void {
    database.close();
    databases.splice(databases.indexOf(database), 1);
  }

  function createTempDatabasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "huanghuang-competitive-"));
    temporaryDirectories.push(directory);
    return join(directory, "game.sqlite");
  }

  function createSessions(
    database: GameDatabase,
    sessionIds: readonly string[] = PLAYER_IDS,
  ): void {
    for (const [index, sessionId] of sessionIds.entries()) {
      database.createSession(
        {
          id: sessionId,
          nickname: `玩家${index}`,
          wechatOpenId: `openid-${sessionId}`,
          avatarUrl: `/avatars/${sessionId}.png`,
        },
        `token-${sessionId}`,
      );
    }
  }

  function queueSessions(database: GameDatabase, sessionIds: readonly string[] = PLAYER_IDS): void {
    for (const [index, sessionId] of sessionIds.entries()) {
      database.upsertMatchmakingEntry({
        sessionId,
        rankLevelSnapshot: index,
        enqueuedAt: new Date(Date.parse(ENQUEUED_AT) + index).toISOString(),
      });
    }
  }

  function createMatchInput(
    matchId = "match-1",
    roomId = "match-room",
    sessionIds: readonly string[] = PLAYER_IDS,
  ): CreateCompetitiveMatchInput {
    const room = roomSnapshot(roomId);
    return {
      match: {
        id: matchId,
        roomId,
        roundId: `round-${matchId}`,
        ruleVersion: 1,
        createdAt: ENQUEUED_AT,
      },
      room,
      stateJson: JSON.stringify({ id: roomId, version: room.version }),
      players: sessionIds.map((sessionId, seat) => ({ sessionId, seat, queueVersion: 1 })),
    };
  }

  function createQueuedMatch(
    database: GameDatabase,
    matchId = "match-1",
    roomId = "match-room",
    sessionIds: readonly string[] = PLAYER_IDS,
  ) {
    queueSessions(database, sessionIds);
    return database.createCompetitiveMatch(createMatchInput(matchId, roomId, sessionIds));
  }

  function unchangedSettlement(sessionId: string): CompetitivePlayerSettlementInput {
    return {
      sessionId,
      postRankLevel: 0,
      highestMajorIndex: 0,
      rawRankDelta: -1,
      finalRankDelta: 0,
      protectionCardsBefore: 0,
      protectionCardsAfter: 0,
      protectionCardsConsumed: 0,
      protectionCardsGranted: 0,
      multiplier: 1,
      winDoubleCardUsed: false,
      rankProtectionApplied: false,
    };
  }

  it("adds competitive tables and indexes without replacing legacy data", () => {
    const path = createTempDatabasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO anonymous_sessions
        (id, token_hash, nickname, created_at, last_seen_at)
      VALUES
        ('legacy-player', 'legacy-token', '老玩家', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
    `);
    legacy.close();

    const database = createDatabase(path);
    expect(database.findSessionByTokenHash("legacy-token")).toMatchObject({
      id: "legacy-player",
      nickname: "老玩家",
    });
    expect(database.ensureCompetitiveProfile("legacy-player")).toMatchObject({
      rankLevel: 0,
      highestMajorIndex: 0,
      protectionCards: 0,
    });

    const tables = database.connection
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'competitive_%' OR name = 'matchmaking_entries'
         ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual([
      "competitive_action_events",
      "competitive_match_players",
      "competitive_matches",
      "competitive_profiles",
      "matchmaking_entries",
    ]);
    const indexes = database.connection
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name LIKE 'idx_competitive_%'
         ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(indexes.map((row) => row.name)).toEqual([
      "idx_competitive_action_events_match",
      "idx_competitive_match_players_session",
      "idx_competitive_matches_status",
    ]);
  });

  it("rebuilds the competitive_action_events CHECK constraint for a database predating RELEASE_WILDCARD", () => {
    const path = createTempDatabasePath();
    const legacy = new Database(path);
    legacy.pragma("foreign_keys = ON");
    legacy.exec(`
      CREATE TABLE anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE competitive_profiles (
        session_id TEXT PRIMARY KEY,
        rank_level INTEGER NOT NULL DEFAULT 0 CHECK (rank_level >= 0),
        highest_major_index INTEGER NOT NULL DEFAULT 0 CHECK (highest_major_index >= 0),
        protection_cards INTEGER NOT NULL DEFAULT 0 CHECK (protection_cards >= 0),
        exposed_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (exposed_kong_count >= 0),
        indicator_pong_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (indicator_pong_kong_count >= 0),
        added_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (added_kong_count >= 0),
        concealed_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (concealed_kong_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE CASCADE
      );
      CREATE TABLE competitive_matches (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL UNIQUE,
        round_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SETTLED')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
      CREATE TABLE competitive_match_players (
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
        pre_rank_level INTEGER NOT NULL CHECK (pre_rank_level >= 0),
        post_rank_level INTEGER CHECK (post_rank_level >= 0),
        raw_rank_delta INTEGER,
        final_rank_delta INTEGER,
        protection_cards_before INTEGER CHECK (protection_cards_before >= 0),
        protection_cards_after INTEGER CHECK (protection_cards_after >= 0),
        protection_cards_consumed INTEGER CHECK (protection_cards_consumed >= 0),
        protection_cards_granted INTEGER CHECK (protection_cards_granted >= 0),
        multiplier INTEGER CHECK (multiplier IN (1, 2, 4, 8, 16, 32, 64)),
        acknowledged_at TEXT,
        PRIMARY KEY (match_id, session_id),
        UNIQUE (match_id, seat),
        FOREIGN KEY (match_id) REFERENCES competitive_matches (id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE RESTRICT
      );
      CREATE TABLE competitive_action_events (
        event_key TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        round_version INTEGER NOT NULL CHECK (round_version >= 0),
        action TEXT NOT NULL CHECK (
          action IN ('EXPOSED_KONG', 'INDICATOR_PONG_KONG', 'ADDED_KONG', 'CONCEALED_KONG')
        ),
        created_at TEXT NOT NULL,
        UNIQUE (match_id, session_id, round_id, round_version, action),
        FOREIGN KEY (match_id, session_id)
          REFERENCES competitive_match_players (match_id, session_id) ON DELETE CASCADE
      );
      INSERT INTO anonymous_sessions (id, token_hash, nickname, created_at, last_seen_at)
      VALUES ('legacy-player', 'legacy-token', '老玩家', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
      INSERT INTO competitive_profiles (session_id, created_at, updated_at)
      VALUES ('legacy-player', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
      INSERT INTO competitive_matches (id, room_id, round_id, rule_version, status, created_at)
      VALUES ('legacy-match', 'legacy-room', 'legacy-round', 1, 'ACTIVE', '${ENQUEUED_AT}');
      INSERT INTO competitive_match_players (match_id, session_id, seat, pre_rank_level)
      VALUES ('legacy-match', 'legacy-player', 0, 0);
      INSERT INTO competitive_action_events
        (event_key, match_id, session_id, round_id, round_version, action, created_at)
      VALUES
        ('legacy-event', 'legacy-match', 'legacy-player', 'legacy-round', 1, 'EXPOSED_KONG', '${ENQUEUED_AT}');
    `);
    expect(() =>
      legacy
        .prepare(
          `INSERT INTO competitive_action_events
           (event_key, match_id, session_id, round_id, round_version, action, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-event-blocked",
          "legacy-match",
          "legacy-player",
          "legacy-round",
          2,
          "RELEASE_WILDCARD",
          ENQUEUED_AT,
        ),
    ).toThrow(/CHECK constraint failed/);
    legacy.close();

    const database = createDatabase(path);
    expect(
      database.connection
        .prepare("SELECT action FROM competitive_action_events WHERE event_key = ?")
        .get("legacy-event"),
    ).toEqual({ action: "EXPOSED_KONG" });
    expect(database.getCompetitiveProfile("legacy-player")?.releaseWildcardCount).toBe(0);

    expect(
      database.saveAcceptedTransition({
        room: roomSnapshot("legacy-room", 1),
        stateJson: JSON.stringify({ id: "legacy-room", version: 1 }),
        achievementEvent: {
          eventKey: "legacy-event-release-wildcard",
          matchId: "legacy-match",
          sessionId: "legacy-player",
          roundId: "legacy-round",
          roundVersion: 2,
          action: "RELEASE_WILDCARD",
          createdAt: ENQUEUED_AT,
        },
      }),
    ).toEqual({ achievementRecorded: true, settlementApplied: false });
    expect(database.getCompetitiveProfile("legacy-player")?.releaseWildcardCount).toBe(1);
  });

  it("rebuilds the competitive_action_events CHECK constraint for a database predating HARD_LAIYOU/SOFT_LAIYOU", () => {
    const path = createTempDatabasePath();
    const legacy = new Database(path);
    legacy.pragma("foreign_keys = ON");
    legacy.exec(`
      CREATE TABLE anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE competitive_profiles (
        session_id TEXT PRIMARY KEY,
        rank_level INTEGER NOT NULL DEFAULT 0 CHECK (rank_level >= 0),
        highest_major_index INTEGER NOT NULL DEFAULT 0 CHECK (highest_major_index >= 0),
        protection_cards INTEGER NOT NULL DEFAULT 0 CHECK (protection_cards >= 0),
        exposed_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (exposed_kong_count >= 0),
        indicator_pong_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (indicator_pong_kong_count >= 0),
        added_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (added_kong_count >= 0),
        concealed_kong_count INTEGER NOT NULL DEFAULT 0 CHECK (concealed_kong_count >= 0),
        release_wildcard_count INTEGER NOT NULL DEFAULT 0 CHECK (release_wildcard_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE CASCADE
      );
      CREATE TABLE competitive_matches (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL UNIQUE,
        round_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SETTLED')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
      CREATE TABLE competitive_match_players (
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
        pre_rank_level INTEGER NOT NULL CHECK (pre_rank_level >= 0),
        post_rank_level INTEGER CHECK (post_rank_level >= 0),
        raw_rank_delta INTEGER,
        final_rank_delta INTEGER,
        protection_cards_before INTEGER CHECK (protection_cards_before >= 0),
        protection_cards_after INTEGER CHECK (protection_cards_after >= 0),
        protection_cards_consumed INTEGER CHECK (protection_cards_consumed >= 0),
        protection_cards_granted INTEGER CHECK (protection_cards_granted >= 0),
        multiplier INTEGER CHECK (multiplier IN (1, 2, 4, 8, 16, 32, 64)),
        acknowledged_at TEXT,
        PRIMARY KEY (match_id, session_id),
        UNIQUE (match_id, seat),
        FOREIGN KEY (match_id) REFERENCES competitive_matches (id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE RESTRICT
      );
      CREATE TABLE competitive_action_events (
        event_key TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        round_version INTEGER NOT NULL CHECK (round_version >= 0),
        action TEXT NOT NULL CHECK (
          action IN ('EXPOSED_KONG', 'INDICATOR_PONG_KONG', 'ADDED_KONG', 'CONCEALED_KONG', 'RELEASE_WILDCARD')
        ),
        created_at TEXT NOT NULL,
        UNIQUE (match_id, session_id, round_id, round_version, action),
        FOREIGN KEY (match_id, session_id)
          REFERENCES competitive_match_players (match_id, session_id) ON DELETE CASCADE
      );
      INSERT INTO anonymous_sessions (id, token_hash, nickname, created_at, last_seen_at)
      VALUES ('legacy-player', 'legacy-token', '老玩家', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
      INSERT INTO competitive_profiles (session_id, created_at, updated_at)
      VALUES ('legacy-player', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
      INSERT INTO competitive_matches (id, room_id, round_id, rule_version, status, created_at)
      VALUES ('legacy-match', 'legacy-room', 'legacy-round', 1, 'ACTIVE', '${ENQUEUED_AT}');
      INSERT INTO competitive_match_players (match_id, session_id, seat, pre_rank_level)
      VALUES ('legacy-match', 'legacy-player', 0, 0);
      INSERT INTO competitive_action_events
        (event_key, match_id, session_id, round_id, round_version, action, created_at)
      VALUES
        ('legacy-event', 'legacy-match', 'legacy-player', 'legacy-round', 1, 'RELEASE_WILDCARD', '${ENQUEUED_AT}');
    `);
    expect(() =>
      legacy
        .prepare(
          `INSERT INTO competitive_action_events
           (event_key, match_id, session_id, round_id, round_version, action, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-event-blocked",
          "legacy-match",
          "legacy-player",
          "legacy-round",
          2,
          "HARD_LAIYOU",
          ENQUEUED_AT,
        ),
    ).toThrow(/CHECK constraint failed/);
    legacy.close();

    const database = createDatabase(path);
    expect(
      database.connection
        .prepare("SELECT action FROM competitive_action_events WHERE event_key = ?")
        .get("legacy-event"),
    ).toEqual({ action: "RELEASE_WILDCARD" });
    expect(database.getCompetitiveProfile("legacy-player")).toMatchObject({
      hardLaiyouCount: 0,
      softLaiyouCount: 0,
    });

    expect(
      database.saveAcceptedTransition({
        room: roomSnapshot("legacy-room", 1),
        stateJson: JSON.stringify({ id: "legacy-room", version: 1 }),
        achievementEvent: {
          eventKey: "legacy-event-hard-laiyou",
          matchId: "legacy-match",
          sessionId: "legacy-player",
          roundId: "legacy-round",
          roundVersion: 2,
          action: "HARD_LAIYOU",
          createdAt: ENQUEUED_AT,
        },
      }),
    ).toEqual({ achievementRecorded: true, settlementApplied: false });
    expect(database.getCompetitiveProfile("legacy-player")?.hardLaiyouCount).toBe(1);
  });

  it("creates a black-iron-V profile once and returns safe public batches", () => {
    const database = createDatabase();
    createSessions(database);

    const profile = database.ensureCompetitiveProfile(PLAYER_IDS[0]);
    expect(profile).toMatchObject({
      sessionId: PLAYER_IDS[0],
      rankLevel: 0,
      highestMajorIndex: 0,
      protectionCards: 0,
      exposedKongCount: 0,
      indicatorPongKongCount: 0,
      addedKongCount: 0,
      concealedKongCount: 0,
    });
    expect(database.ensureCompetitiveProfile(PLAYER_IDS[0])).toEqual(profile);
    database.ensureCompetitiveProfile(PLAYER_IDS[1]);

    expect(database.getPublicCompetitiveProfiles([])).toEqual([]);
    expect(
      database.getPublicCompetitiveProfiles([
        PLAYER_IDS[1],
        "missing",
        PLAYER_IDS[0],
        PLAYER_IDS[1],
      ]),
    ).toEqual([
      expect.objectContaining({ sessionId: PLAYER_IDS[1], rankLevel: 0 }),
      expect.objectContaining({ sessionId: PLAYER_IDS[0], rankLevel: 0 }),
    ]);
    expect(database.getPublicCompetitiveProfile(PLAYER_IDS[0])).not.toHaveProperty(
      "protectionCards",
    );
  });

  it("batch-loads sessions with bound, deduplicated, input-ordered ids", () => {
    const database = createDatabase();
    createSessions(database);

    expect(database.findSessionsByIds([])).toEqual([]);
    expect(
      database.findSessionsByIds([
        PLAYER_IDS[2],
        "missing') OR 1=1 --",
        PLAYER_IDS[0],
        PLAYER_IDS[2],
      ]),
    ).toEqual([
      {
        id: PLAYER_IDS[2],
        nickname: "玩家2",
        wechatOpenId: `openid-${PLAYER_IDS[2]}`,
        avatarUrl: `/avatars/${PLAYER_IDS[2]}.png`,
        playerId: null,
      },
      {
        id: PLAYER_IDS[0],
        nickname: "玩家0",
        wechatOpenId: `openid-${PLAYER_IDS[0]}`,
        avatarUrl: `/avatars/${PLAYER_IDS[0]}.png`,
        playerId: null,
      },
    ]);
  });

  it("keeps queue time on idempotent upsert and expires disconnected entries at the boundary", () => {
    const database = createDatabase();
    createSessions(database);

    expect(
      database.upsertMatchmakingEntry({
        sessionId: PLAYER_IDS[0],
        rankLevelSnapshot: 0,
        enqueuedAt: ENQUEUED_AT,
      }),
    ).toMatchObject({ enqueuedAt: ENQUEUED_AT, disconnectedAt: null, version: 1 });
    expect(
      database.upsertMatchmakingEntry({
        sessionId: PLAYER_IDS[0],
        rankLevelSnapshot: 0,
        enqueuedAt: "2026-07-28T10:00:05.000Z",
      }),
    ).toMatchObject({ enqueuedAt: ENQUEUED_AT, version: 1 });

    const disconnectedAt = "2026-07-28T10:00:10.000Z";
    expect(database.markMatchmakingEntryDisconnected(PLAYER_IDS[0], disconnectedAt)).toMatchObject({
      enqueuedAt: ENQUEUED_AT,
      disconnectedAt,
      version: 2,
    });
    expect(
      database.markMatchmakingEntryDisconnected(PLAYER_IDS[0], "2026-07-28T10:00:11.000Z"),
    ).toMatchObject({ disconnectedAt, version: 2 });
    expect(database.markMatchmakingEntryConnected(PLAYER_IDS[0])).toMatchObject({
      enqueuedAt: ENQUEUED_AT,
      disconnectedAt: null,
      version: 3,
    });
    expect(
      database.upsertMatchmakingEntry({ sessionId: PLAYER_IDS[0], rankLevelSnapshot: 1 }),
    ).toMatchObject({ enqueuedAt: ENQUEUED_AT, disconnectedAt: null, version: 4 });

    database.markMatchmakingEntryDisconnected(PLAYER_IDS[0], disconnectedAt);
    database.upsertMatchmakingEntry({
      sessionId: PLAYER_IDS[1],
      rankLevelSnapshot: 0,
      enqueuedAt: "2026-07-28T10:00:01.000Z",
    });
    database.markMatchmakingEntryDisconnected(PLAYER_IDS[1], "2026-07-28T10:00:10.001Z");
    expect(database.expireDisconnectedMatchmakingEntries(disconnectedAt)).toEqual([PLAYER_IDS[0]]);
    expect(database.getMatchmakingEntry(PLAYER_IDS[0])).toBeNull();
    expect(database.getMatchmakingEntry(PLAYER_IDS[1])).not.toBeNull();
    expect(database.cancelMatchmakingEntry(PLAYER_IDS[1])).toBe(true);
    expect(database.cancelMatchmakingEntry(PLAYER_IDS[1])).toBe(false);
  });

  it("enqueues and cancels a party atomically, expiring the whole party with one member", () => {
    const database = createDatabase();
    createSessions(database);

    const entries = database.enqueueMatchmakingParty(
      "team-room-1",
      PLAYER_IDS.slice(0, 3).map((sessionId, rankLevelSnapshot) => ({
        sessionId,
        rankLevelSnapshot,
      })),
      ENQUEUED_AT,
    );
    expect(entries).toHaveLength(3);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partyId: "team-room-1",
          partySize: 3,
          allowBots: false,
        }),
      ]),
    );
    expect(() =>
      database.enqueueMatchmakingParty(
        "team-room-2",
        [PLAYER_IDS[2], PLAYER_IDS[3]].map((sessionId) => ({
          sessionId,
          rankLevelSnapshot: 0,
        })),
        ENQUEUED_AT,
      ),
    ).toThrow("already queued");
    expect(database.listMatchmakingPartyEntries("team-room-2")).toEqual([]);

    database.markMatchmakingEntryDisconnected(PLAYER_IDS[1], ENQUEUED_AT);
    expect(database.expireDisconnectedMatchmakingEntries(ENQUEUED_AT)).toEqual(
      expect.arrayContaining(PLAYER_IDS.slice(0, 3)),
    );
    expect(database.listMatchmakingPartyEntries("team-room-1")).toEqual([]);

    database.enqueueMatchmakingParty(
      "team-room-3",
      PLAYER_IDS.slice(0, 2).map((sessionId) => ({
        sessionId,
        rankLevelSnapshot: 0,
      })),
      ENQUEUED_AT,
    );
    expect(database.cancelMatchmakingParty("team-room-3")).toEqual(
      [...PLAYER_IDS.slice(0, 2)].sort(),
    );
  });

  it("moves every apparently online queue entry into restart grace", () => {
    const database = createDatabase();
    createSessions(database);
    queueSessions(database);

    expect(database.markAllMatchmakingEntriesDisconnected(ENQUEUED_AT)).toBe(4);
    expect(database.listMatchmakingEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ disconnectedAt: ENQUEUED_AT, version: 2 }),
      ]),
    );
    expect(database.markAllMatchmakingEntriesDisconnected(ENQUEUED_AT)).toBe(0);
  });

  it("atomically creates a match, room and players only when all four queue rows exist", () => {
    const database = createDatabase();
    createSessions(database);
    queueSessions(database, PLAYER_IDS.slice(0, 3));

    expect(() => database.createCompetitiveMatch(createMatchInput())).toThrow(
      CompetitiveMatchCreationConflictError,
    );
    expect(() => database.createCompetitiveMatch(createMatchInput())).toThrow(
      "expected four current online queue entries, deleted 3",
    );
    expect(database.getCompetitiveMatchSettlement("match-1")).toBeNull();
    expect(database.loadActiveRooms()).toEqual([]);
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])).toBeNull();
    expect(database.listMatchmakingEntries()).toHaveLength(3);

    database.upsertMatchmakingEntry({
      sessionId: PLAYER_IDS[3],
      rankLevelSnapshot: 3,
      enqueuedAt: "2026-07-28T10:00:00.003Z",
    });
    const created = database.createCompetitiveMatch(createMatchInput());
    expect(created.match).toMatchObject({
      id: "match-1",
      roomId: "match-room",
      status: "ACTIVE",
      resultJson: null,
    });
    expect(
      created.players.map(({ sessionId, seat, preRankLevel }) => ({
        sessionId,
        seat,
        preRankLevel,
      })),
    ).toEqual(PLAYER_IDS.map((sessionId, seat) => ({ sessionId, seat, preRankLevel: 0 })));
    expect(database.listMatchmakingEntries()).toEqual([]);
    expect(database.loadActiveRooms()).toEqual([JSON.stringify({ id: "match-room", version: 1 })]);
    expect(database.getActiveCompetitiveMatch(PLAYER_IDS[2])?.match.id).toBe("match-1");
    expect(() =>
      database.upsertMatchmakingEntry({ sessionId: PLAYER_IDS[2], rankLevelSnapshot: 0 }),
    ).toThrow("already has an active competitive match");
  });

  it("rejects stale or disconnected queue snapshots during atomic match creation", () => {
    const database = createDatabase();
    createSessions(database);
    queueSessions(database);
    database.markMatchmakingEntryDisconnected(PLAYER_IDS[0], ENQUEUED_AT);

    expect(() => database.createCompetitiveMatch(createMatchInput())).toThrow(
      CompetitiveMatchCreationConflictError,
    );
    expect(() => database.createCompetitiveMatch(createMatchInput())).toThrow(
      "expected four current online queue entries",
    );
    expect(database.getCompetitiveMatchSettlement("match-1")).toBeNull();
    expect(database.listMatchmakingEntries()).toHaveLength(4);
  });

  it("identifies an active-match creation conflict by type, not just message text", () => {
    const database = createDatabase();
    createSessions(database);
    queueSessions(database);
    database.createCompetitiveMatch(createMatchInput());

    // Re-running with the very same (now-consumed) queue snapshot collides
    // with the active match this session is already part of.
    let caught: unknown;
    try {
      database.createCompetitiveMatch(createMatchInput("match-2", "match-room-2"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompetitiveMatchCreationConflictError);
    expect((caught as Error).message).toContain("already has an active competitive match");

    // An unrelated Error that merely happens to mention similar words is a
    // different type and must not be confused with a real conflict by any
    // caller that switched from string matching to `instanceof`.
    const impostor = new Error("Session player-9 already has an active competitive match");
    expect(impostor).not.toBeInstanceOf(CompetitiveMatchCreationConflictError);
  });

  it("deduplicates achievement facts before incrementing profile counters", () => {
    const database = createDatabase();
    createSessions(database);
    createQueuedMatch(database);
    const input = {
      room: roomSnapshot("match-room", 2),
      stateJson: JSON.stringify({ id: "match-room", version: 2 }),
      processedRequest: {
        sessionId: PLAYER_IDS[0],
        requestId: "request-1",
        resultJson: JSON.stringify({ accepted: true }),
      },
      achievementEvent: {
        eventKey: "match-1:round-match-1:7:player-0:EXPOSED_KONG",
        matchId: "match-1",
        sessionId: PLAYER_IDS[0],
        roundId: "round-match-1",
        roundVersion: 7,
        action: "EXPOSED_KONG" as const,
        createdAt: "2026-07-28T10:01:00.000Z",
      },
    };

    expect(database.saveAcceptedTransition(input)).toEqual({
      achievementRecorded: true,
      settlementApplied: false,
    });
    expect(database.saveAcceptedTransition(input)).toEqual({
      achievementRecorded: false,
      settlementApplied: false,
    });
    expect(
      database.saveAcceptedTransition({
        ...input,
        achievementEvent: { ...input.achievementEvent, eventKey: "same-fact-new-key" },
      }),
    ).toEqual({ achievementRecorded: false, settlementApplied: false });
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.exposedKongCount).toBe(1);
    expect(database.getProcessedRequest(PLAYER_IDS[0], "request-1")).toBe(
      JSON.stringify({ accepted: true }),
    );
  });

  it("deduplicates RELEASE_WILDCARD achievement facts before incrementing release_wildcard_count", () => {
    const database = createDatabase();
    createSessions(database);
    createQueuedMatch(database);
    const input = {
      room: roomSnapshot("match-room", 2),
      stateJson: JSON.stringify({ id: "match-room", version: 2 }),
      processedRequest: {
        sessionId: PLAYER_IDS[0],
        requestId: "request-release-wildcard",
        resultJson: JSON.stringify({ accepted: true }),
      },
      achievementEvent: {
        eventKey: "match-1:round-match-1:9:player-0:RELEASE_WILDCARD",
        matchId: "match-1",
        sessionId: PLAYER_IDS[0],
        roundId: "round-match-1",
        roundVersion: 9,
        action: "RELEASE_WILDCARD" as const,
        createdAt: "2026-07-28T10:02:00.000Z",
      },
    };

    expect(database.saveAcceptedTransition(input)).toEqual({
      achievementRecorded: true,
      settlementApplied: false,
    });
    expect(database.saveAcceptedTransition(input)).toEqual({
      achievementRecorded: false,
      settlementApplied: false,
    });
    expect(
      database.saveAcceptedTransition({
        ...input,
        achievementEvent: {
          ...input.achievementEvent,
          eventKey: "same-release-wildcard-fact-new-key",
        },
      }),
    ).toEqual({ achievementRecorded: false, settlementApplied: false });
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.releaseWildcardCount).toBe(1);
    expect(database.getProcessedRequest(PLAYER_IDS[0], "request-release-wildcard")).toBe(
      JSON.stringify({ accepted: true }),
    );
  });

  it("rolls back every accepted-transition write when settlement validation fails", () => {
    const database = createDatabase();
    createSessions(database);
    createQueuedMatch(database);
    const invalidPlayers = PLAYER_IDS.map((sessionId) => unchangedSettlement(sessionId));
    invalidPlayers[0] = {
      ...unchangedSettlement(PLAYER_IDS[0]),
      postRankLevel: 3,
      finalRankDelta: 2,
    };

    expect(() =>
      database.saveAcceptedTransition({
        room: roomSnapshot("match-room", 99),
        stateJson: JSON.stringify({ id: "match-room", version: 99 }),
        processedRequest: {
          sessionId: PLAYER_IDS[0],
          requestId: "rolled-back-request",
          resultJson: "{}",
        },
        achievementEvent: {
          eventKey: "rolled-back-event",
          matchId: "match-1",
          sessionId: PLAYER_IDS[0],
          roundId: "round-match-1",
          roundVersion: 20,
          action: "ADDED_KONG",
        },
        terminalSettlement: {
          matchId: "match-1",
          resultJson: "{}",
          players: invalidPlayers,
        },
      }),
    ).toThrow(`Competitive settlement precondition failed for ${PLAYER_IDS[0]}`);

    expect(database.loadActiveRooms()).toEqual([JSON.stringify({ id: "match-room", version: 1 })]);
    expect(database.getProcessedRequest(PLAYER_IDS[0], "rolled-back-request")).toBeNull();
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.addedKongCount).toBe(0);
    expect(database.getCompetitiveMatchSettlement("match-1")?.match.status).toBe("ACTIVE");
  });

  it("settles once, restores unacknowledged results after restart, and preserves acknowledgements", () => {
    const path = createTempDatabasePath();
    let database = createDatabase(path);
    createSessions(database);
    createQueuedMatch(database);
    const settlementPlayers: CompetitivePlayerSettlementInput[] = PLAYER_IDS.map((sessionId) =>
      unchangedSettlement(sessionId),
    );
    settlementPlayers[0] = {
      ...unchangedSettlement(PLAYER_IDS[0]),
      postRankLevel: 2,
      rawRankDelta: 2,
      finalRankDelta: 2,
      multiplier: 2,
    };
    const transition = {
      room: roomSnapshot("match-room", 3),
      stateJson: JSON.stringify({ id: "match-room", version: 3, stage: "ROUND_RESULT" }),
      achievementEvent: {
        eventKey: "terminal-concealed-kong",
        matchId: "match-1",
        sessionId: PLAYER_IDS[1],
        roundId: "round-match-1",
        roundVersion: 12,
        action: "CONCEALED_KONG" as const,
        createdAt: "2026-07-28T10:02:00.000Z",
      },
      terminalSettlement: {
        matchId: "match-1",
        resultJson: JSON.stringify({ kind: "WIN", winnerSessionId: PLAYER_IDS[0] }),
        settledAt: "2026-07-28T10:02:01.000Z",
        players: settlementPlayers,
      },
    };

    expect(database.saveAcceptedTransition(transition)).toEqual({
      achievementRecorded: true,
      settlementApplied: true,
    });
    expect(database.saveAcceptedTransition(transition)).toEqual({
      achievementRecorded: false,
      settlementApplied: false,
    });
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.rankLevel).toBe(2);
    expect(database.getCompetitiveProfile(PLAYER_IDS[1])?.concealedKongCount).toBe(1);
    expect(database.getActiveCompetitiveMatch(PLAYER_IDS[0])).toBeNull();
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[0])?.match.status).toBe("SETTLED");
    expect(database.getRecentCompetitiveOpponentIds(PLAYER_IDS[0])).toEqual([
      PLAYER_IDS[1],
      PLAYER_IDS[2],
      PLAYER_IDS[3],
    ]);
    expect(database.getRecentCompetitiveOpponentIds(PLAYER_IDS[0], 0)).toEqual([]);

    const acknowledgedAt = "2026-07-28T10:03:00.000Z";
    expect(
      database.acknowledgeCompetitiveMatchResult("match-1", PLAYER_IDS[0], acknowledgedAt),
    ).toMatchObject({ acknowledgedAt });
    expect(
      database.acknowledgeCompetitiveMatchResult(
        "match-1",
        PLAYER_IDS[0],
        "2026-07-28T10:04:00.000Z",
      ),
    ).toMatchObject({ acknowledgedAt });
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[0])).toBeNull();
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[1])?.match.id).toBe("match-1");

    closeDatabase(database);
    database = createDatabase(path);
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.rankLevel).toBe(2);
    expect(database.getCompetitiveProfile(PLAYER_IDS[1])?.concealedKongCount).toBe(1);
    expect(database.getCompetitiveMatchSettlement("match-1")).toMatchObject({
      match: {
        status: "SETTLED",
        settledAt: "2026-07-28T10:02:01.000Z",
      },
    });
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[0])).toBeNull();
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[1])?.match.id).toBe("match-1");
  });

  it("atomically acknowledges a settled result and continues matchmaking", () => {
    const database = createDatabase();
    createSessions(database);
    createQueuedMatch(database);
    database.saveAcceptedTransition({
      room: roomSnapshot("match-room", 2),
      stateJson: "{}",
      terminalSettlement: {
        matchId: "match-1",
        resultJson: "{}",
        players: PLAYER_IDS.map((sessionId) => unchangedSettlement(sessionId)),
      },
    });

    expect(() =>
      database.upsertMatchmakingEntry({ sessionId: PLAYER_IDS[0], rankLevelSnapshot: 0 }),
    ).toThrow();
    expect(
      database.acknowledgeAndEnqueueCompetitiveMatch(
        "match-1",
        PLAYER_IDS[0],
        "2026-07-28T10:03:00.000Z",
      ),
    ).toMatchObject({
      sessionId: PLAYER_IDS[0],
      enqueuedAt: "2026-07-28T10:03:00.000Z",
      rankLevelSnapshot: 0,
    });
    expect(database.getCurrentCompetitiveMatch(PLAYER_IDS[0])).toBeNull();
  });

  it("returns distinct opponents from the configured number of recent matches", () => {
    const database = createDatabase();
    const sessionIds = [...PLAYER_IDS, "player-4", "player-5"];
    createSessions(database, sessionIds);
    createQueuedMatch(database);
    database.saveAcceptedTransition({
      room: roomSnapshot("match-room", 2),
      stateJson: "{}",
      terminalSettlement: {
        matchId: "match-1",
        resultJson: "{}",
        settledAt: "2026-07-28T10:01:00.000Z",
        players: PLAYER_IDS.map((sessionId) => unchangedSettlement(sessionId)),
      },
    });

    const secondPlayers = [PLAYER_IDS[0], PLAYER_IDS[1], "player-4", "player-5"];
    database.acknowledgeCompetitiveMatchResult("match-1", PLAYER_IDS[0]);
    database.acknowledgeCompetitiveMatchResult("match-1", PLAYER_IDS[1]);
    queueSessions(database, secondPlayers);
    const secondInput = createMatchInput("match-2", "match-room-2", secondPlayers);
    secondInput.match.createdAt = "2026-07-28T10:05:00.000Z";
    database.createCompetitiveMatch(secondInput);

    expect(database.getRecentCompetitiveOpponentIds(PLAYER_IDS[0], 1)).toEqual([
      PLAYER_IDS[1],
      "player-4",
      "player-5",
    ]);
    expect(database.getRecentCompetitiveOpponentIds(PLAYER_IDS[0], 2)).toEqual([
      PLAYER_IDS[1],
      "player-4",
      "player-5",
      PLAYER_IDS[2],
      PLAYER_IDS[3],
    ]);
  });

  describe("listCompetitiveMatchHistory", () => {
    function matchRoomSnapshot(id: string, code: string, version = 1) {
      return { id, code, status: "ACTIVE", version };
    }

    function createSettledMatch(
      database: GameDatabase,
      options: {
        matchId: string;
        roomId: string;
        code: string;
        settledAt: string;
        players: readonly CompetitivePlayerSettlementInput[];
      },
    ): void {
      queueSessions(database);
      database.createCompetitiveMatch({
        match: {
          id: options.matchId,
          roomId: options.roomId,
          roundId: `round-${options.matchId}`,
          ruleVersion: 1,
          createdAt: options.settledAt,
        },
        room: matchRoomSnapshot(options.roomId, options.code),
        stateJson: JSON.stringify({ id: options.roomId, version: 1 }),
        players: PLAYER_IDS.map((sessionId, seat) => ({ sessionId, seat, queueVersion: 1 })),
      });
      database.saveAcceptedTransition({
        room: matchRoomSnapshot(options.roomId, options.code, 2),
        stateJson: JSON.stringify({ id: options.roomId, version: 2 }),
        terminalSettlement: {
          matchId: options.matchId,
          resultJson: "{}",
          settledAt: options.settledAt,
          players: options.players,
        },
      });
      // upsertMatchmakingEntry() treats an unacknowledged settled match the
      // same as an active one, so the next match's queueSessions() would
      // otherwise reject these sessions as still "in" this match.
      for (const sessionId of PLAYER_IDS) {
        database.acknowledgeCompetitiveMatchResult(options.matchId, sessionId, options.settledAt);
      }
    }

    function seedThreeMatches(database: GameDatabase): void {
      createSettledMatch(database, {
        matchId: "history-win",
        roomId: "history-room-win",
        code: "5001",
        settledAt: "2026-07-28T10:00:00.000Z",
        players: [
          {
            ...unchangedSettlement(PLAYER_IDS[0]),
            postRankLevel: 5,
            finalRankDelta: 5,
            multiplier: 4,
          },
          unchangedSettlement(PLAYER_IDS[1]),
          unchangedSettlement(PLAYER_IDS[2]),
          unchangedSettlement(PLAYER_IDS[3]),
        ],
      });
      createSettledMatch(database, {
        matchId: "history-loss",
        roomId: "history-room-loss",
        code: "5002",
        settledAt: "2026-07-28T11:00:00.000Z",
        players: [
          {
            ...unchangedSettlement(PLAYER_IDS[0]),
            postRankLevel: 2,
            finalRankDelta: -3,
            multiplier: 2,
          },
          unchangedSettlement(PLAYER_IDS[1]),
          unchangedSettlement(PLAYER_IDS[2]),
          unchangedSettlement(PLAYER_IDS[3]),
        ],
      });
      createSettledMatch(database, {
        matchId: "history-draw",
        roomId: "history-room-draw",
        code: "5003",
        settledAt: "2026-07-28T12:00:00.000Z",
        players: [
          { ...unchangedSettlement(PLAYER_IDS[0]), postRankLevel: 2, multiplier: null },
          unchangedSettlement(PLAYER_IDS[1]),
          unchangedSettlement(PLAYER_IDS[2]),
          unchangedSettlement(PLAYER_IDS[3]),
        ],
      });
    }

    it("derives WIN/LOSS/DRAW and returns each session's own multiplier and rank delta, newest first", () => {
      const database = createDatabase();
      createSessions(database);
      seedThreeMatches(database);

      const ownHistory = database.listCompetitiveMatchHistory(PLAYER_IDS[0], { limit: 10 });
      expect(ownHistory.map((entry) => entry.matchId)).toEqual([
        "history-draw",
        "history-loss",
        "history-win",
      ]);
      expect(ownHistory[0]).toMatchObject({ outcome: "DRAW", multiplier: null, finalRankDelta: 0 });
      expect(ownHistory[1]).toMatchObject({ outcome: "LOSS", multiplier: 2, finalRankDelta: -3 });
      expect(ownHistory[2]).toMatchObject({ outcome: "WIN", multiplier: 4, finalRankDelta: 5 });

      // A player who never changed rank across any of the three matches
      // (unchangedSettlement keeps finalRankDelta at 0 with a real
      // multiplier) reads as LOSS every time — matches
      // applyCompetitiveRankTransition's guarantee that only DRAW can pair a
      // zero delta with a null multiplier.
      const otherHistory = database.listCompetitiveMatchHistory(PLAYER_IDS[1], { limit: 10 });
      expect(otherHistory.every((entry) => entry.outcome === "LOSS")).toBe(true);
    });

    it("paginates with a beforeMatchId cursor in settledAt order", () => {
      const database = createDatabase();
      createSessions(database);
      seedThreeMatches(database);

      const firstPage = database.listCompetitiveMatchHistory(PLAYER_IDS[0], { limit: 2 });
      expect(firstPage.map((entry) => entry.matchId)).toEqual(["history-draw", "history-loss"]);

      const secondPageCursor = firstPage[1]?.matchId;
      if (secondPageCursor === undefined) throw new Error("Expected a second-page cursor");
      const secondPage = database.listCompetitiveMatchHistory(PLAYER_IDS[0], {
        limit: 2,
        beforeMatchId: secondPageCursor,
      });
      expect(secondPage.map((entry) => entry.matchId)).toEqual(["history-win"]);
    });

    it("excludes matches that have not yet settled", () => {
      const database = createDatabase();
      createSessions(database);
      queueSessions(database);
      database.createCompetitiveMatch({
        match: {
          id: "history-active",
          roomId: "history-room-active",
          roundId: "round-history-active",
          ruleVersion: 1,
        },
        room: matchRoomSnapshot("history-room-active", "5004"),
        stateJson: JSON.stringify({ id: "history-room-active", version: 1 }),
        players: PLAYER_IDS.map((sessionId, seat) => ({ sessionId, seat, queueVersion: 1 })),
      });

      expect(database.listCompetitiveMatchHistory(PLAYER_IDS[0], { limit: 10 })).toEqual([]);
    });
  });

  it("seeds a ranked bot with a highestMajorIndex that satisfies the rank-state invariant", () => {
    const database = createDatabase();
    // A bot seeded above 黑铁 (rankLevel 17 = 黄金Ⅲ) must not leave
    // highest_major_index at its 0 default — competitiveTerminalSettlement
    // parses the profile through competitiveRankStateSchema, which rejects
    // highestMajorIndex < floor(rankLevel/5) and would crash the server.
    database.ensureRankedBotSession({
      id: "bot-dushen",
      nickname: "赌神",
      avatarUrl: null,
      rankLevel: 17,
    });
    const profile = database.getCompetitiveProfile("bot-dushen");
    expect(profile).not.toBeNull();
    expect(profile?.rankLevel).toBe(17);
    expect(profile?.highestMajorIndex).toBe(3); // floor(17/5)
    // The exact guard competitiveTerminalSettlement runs:
    expect(() => competitiveRankStateSchema.parse(profile)).not.toThrow();

    // Re-seeding an existing bot must not clobber earned rank, but must still
    // self-heal a stale highest_major_index that violates the invariant.
    database.connection
      .prepare("UPDATE competitive_profiles SET highest_major_index = 0 WHERE session_id = ?")
      .run("bot-dushen");
    database.ensureRankedBotSession({
      id: "bot-dushen",
      nickname: "赌神",
      avatarUrl: null,
      rankLevel: 17,
    });
    const healed = database.getCompetitiveProfile("bot-dushen");
    expect(healed?.rankLevel).toBe(17); // earned rank preserved
    expect(healed?.highestMajorIndex).toBe(3); // invariant restored
    expect(() => competitiveRankStateSchema.parse(healed)).not.toThrow();
  });

  it("adds item columns and the check-in table to legacy databases idempotently", () => {
    const path = createTempDatabasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE competitive_profiles (
        session_id TEXT PRIMARY KEY,
        rank_level INTEGER NOT NULL DEFAULT 0 CHECK (rank_level >= 0),
        highest_major_index INTEGER NOT NULL DEFAULT 0 CHECK (highest_major_index >= 0),
        protection_cards INTEGER NOT NULL DEFAULT 0 CHECK (protection_cards >= 0),
        exposed_kong_count INTEGER NOT NULL DEFAULT 0,
        indicator_pong_kong_count INTEGER NOT NULL DEFAULT 0,
        added_kong_count INTEGER NOT NULL DEFAULT 0,
        concealed_kong_count INTEGER NOT NULL DEFAULT 0,
        release_wildcard_count INTEGER NOT NULL DEFAULT 0,
        hard_laiyou_count INTEGER NOT NULL DEFAULT 0,
        soft_laiyou_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE CASCADE
      );
      CREATE TABLE competitive_match_players (
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
        pre_rank_level INTEGER NOT NULL CHECK (pre_rank_level >= 0),
        post_rank_level INTEGER CHECK (post_rank_level >= 0),
        raw_rank_delta INTEGER,
        final_rank_delta INTEGER,
        protection_cards_before INTEGER,
        protection_cards_after INTEGER,
        protection_cards_consumed INTEGER,
        protection_cards_granted INTEGER,
        multiplier INTEGER,
        acknowledged_at TEXT,
        PRIMARY KEY (match_id, session_id),
        UNIQUE (match_id, seat)
      );
      INSERT INTO anonymous_sessions (id, token_hash, nickname, created_at, last_seen_at)
      VALUES ('legacy-player', 'legacy-token', '老玩家', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
      INSERT INTO competitive_profiles (session_id, created_at, updated_at)
      VALUES ('legacy-player', '${ENQUEUED_AT}', '${ENQUEUED_AT}');
    `);
    legacy.close();

    const database = createDatabase(path);
    expect(database.getCompetitiveProfile("legacy-player")).toMatchObject({
      winDoubleCards: 0,
      rankProtectionCards: 0,
      rankProtectionActiveUntil: null,
    });
    const auditColumns = database.connection
      .prepare("SELECT win_double_card_used, rank_protection_applied FROM competitive_match_players")
      .all();
    expect(auditColumns).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'check_in_records'")
        .all(),
    ).toHaveLength(1);
    closeDatabase(database);

    // Re-opening the already-migrated database must not throw on the
    // duplicate ALTER statements.
    const reopened = createDatabase(path);
    expect(reopened.getCompetitiveProfile("legacy-player")?.winDoubleCards).toBe(0);
  });

  it("stores and reads weekly check-in records per session and week", () => {
    const database = createDatabase();
    createSessions(database, [PLAYER_IDS[0]]);

    expect(database.getCheckInRecord(PLAYER_IDS[0], "2026-08-03")).toBeNull();

    database.upsertCheckInRecord({
      sessionId: PLAYER_IDS[0],
      weekStart: "2026-08-03",
      signedDates: ["2026-08-03"],
      updatedAt: "2026-08-03T02:00:00.000Z",
    });
    expect(database.getCheckInRecord(PLAYER_IDS[0], "2026-08-03")).toEqual({
      sessionId: PLAYER_IDS[0],
      weekStart: "2026-08-03",
      signedDates: ["2026-08-03"],
      updatedAt: "2026-08-03T02:00:00.000Z",
    });

    // Upsert replaces the signed list; a different week stays independent.
    database.upsertCheckInRecord({
      sessionId: PLAYER_IDS[0],
      weekStart: "2026-08-03",
      signedDates: ["2026-08-03", "2026-08-04"],
      updatedAt: "2026-08-04T02:00:00.000Z",
    });
    expect(database.getCheckInRecord(PLAYER_IDS[0], "2026-08-03")?.signedDates).toEqual([
      "2026-08-03",
      "2026-08-04",
    ]);
    expect(database.getCheckInRecord(PLAYER_IDS[0], "2026-07-27")).toBeNull();
  });

  it("increments item balances and consumes rank protection cards with a balance guard", () => {
    const database = createDatabase();
    createSessions(database, [PLAYER_IDS[0]]);
    database.ensureCompetitiveProfile(PLAYER_IDS[0]);

    const granted = database.addProfileItems(PLAYER_IDS[0], {
      protectionCards: 3,
      winDoubleCards: 2,
      rankProtectionCards: 1,
    });
    expect(granted).toMatchObject({
      protectionCards: 3,
      winDoubleCards: 2,
      rankProtectionCards: 1,
    });

    const consumed = database.consumeRankProtectionCard(
      PLAYER_IDS[0],
      "2026-08-03T12:00:00.000Z",
    );
    expect(consumed).toMatchObject({
      rankProtectionCards: 0,
      rankProtectionActiveUntil: "2026-08-03T12:00:00.000Z",
    });
    // No card left: the guarded UPDATE touches nothing and reports null.
    expect(
      database.consumeRankProtectionCard(PLAYER_IDS[0], "2026-08-03T14:00:00.000Z"),
    ).toBeNull();
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.rankProtectionActiveUntil).toBe(
      "2026-08-03T12:00:00.000Z",
    );
    expect(() => database.addProfileItems("missing-session", { protectionCards: 1 })).toThrow();
  });

  it("writes double-card and protection audit columns and enforces the card-balance precondition", () => {
    const database = createDatabase();
    createSessions(database);
    createQueuedMatch(database);
    for (const sessionId of PLAYER_IDS) database.ensureCompetitiveProfile(sessionId);
    // Winner holds two 胡牌加倍卡 before settlement.
    database.addProfileItems(PLAYER_IDS[0], { winDoubleCards: 2 });

    const result = database.saveAcceptedTransition({
      room: roomSnapshot(),
      stateJson: JSON.stringify({ id: "match-room", version: 2 }),
      terminalSettlement: {
        matchId: "match-1",
        resultJson: "{}",
        settledAt: "2026-08-03T10:00:00.000Z",
        players: [
          {
            ...unchangedSettlement(PLAYER_IDS[0]),
            postRankLevel: 8,
            highestMajorIndex: 1,
            rawRankDelta: 16,
            finalRankDelta: 8,
            multiplier: 4,
            winDoubleCardUsed: true,
            winDoubleCardsAfter: 1,
          },
          {
            ...unchangedSettlement(PLAYER_IDS[1]),
            rawRankDelta: -4,
            rankProtectionApplied: true,
          },
          unchangedSettlement(PLAYER_IDS[2]),
          unchangedSettlement(PLAYER_IDS[3]),
        ],
      },
    });
    expect(result).toEqual({ achievementRecorded: false, settlementApplied: true });

    expect(database.getCompetitiveProfile(PLAYER_IDS[0])).toMatchObject({
      rankLevel: 8,
      winDoubleCards: 1,
    });
    const auditRows = database.connection
      .prepare(
        `SELECT session_id AS sessionId, win_double_card_used AS winDoubleCardUsed,
           rank_protection_applied AS rankProtectionApplied
         FROM competitive_match_players WHERE match_id = 'match-1' ORDER BY seat`,
      )
      .all();
    expect(auditRows).toEqual([
      { sessionId: PLAYER_IDS[0], winDoubleCardUsed: 1, rankProtectionApplied: 0 },
      { sessionId: PLAYER_IDS[1], winDoubleCardUsed: 0, rankProtectionApplied: 1 },
      { sessionId: PLAYER_IDS[2], winDoubleCardUsed: 0, rankProtectionApplied: 0 },
      { sessionId: PLAYER_IDS[3], winDoubleCardUsed: 0, rankProtectionApplied: 0 },
    ]);

    // A winDoubleCardsAfter that does not match the stored balance minus one
    // must abort the whole settlement.
    for (const sessionId of PLAYER_IDS) {
      database.acknowledgeCompetitiveMatchResult("match-1", sessionId, "2026-08-03T10:00:00.000Z");
    }
    createQueuedMatch(database, "match-2", "match-room-2");
    expect(() =>
      database.saveAcceptedTransition({
        room: roomSnapshot("match-room-2", 1),
        stateJson: JSON.stringify({ id: "match-room-2", version: 1 }),
        terminalSettlement: {
          matchId: "match-2",
          resultJson: "{}",
          players: [
            {
              ...unchangedSettlement(PLAYER_IDS[0]),
              postRankLevel: 8,
              highestMajorIndex: 1,
              winDoubleCardUsed: true,
              winDoubleCardsAfter: 5,
            },
            unchangedSettlement(PLAYER_IDS[1]),
            unchangedSettlement(PLAYER_IDS[2]),
            unchangedSettlement(PLAYER_IDS[3]),
          ],
        },
      }),
    ).toThrow(`Competitive settlement precondition failed for ${PLAYER_IDS[0]}`);
    expect(database.getCompetitiveProfile(PLAYER_IDS[0])?.winDoubleCards).toBe(1);
  });
});
