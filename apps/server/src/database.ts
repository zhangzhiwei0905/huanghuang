import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AnonymousSession = {
  id: string;
  nickname: string;
  // Optional so pre-existing call sites constructing a plain
  // nickname-only session (bot rooms, tests, the legacy anonymous
  // /api/session flow) don't all need updating for a field that's only
  // ever populated by the WeChat login path.
  wechatOpenId?: string | null;
  avatarUrl?: string | null;
};

export type CompetitiveAchievementAction =
  | "EXPOSED_KONG"
  | "INDICATOR_PONG_KONG"
  | "ADDED_KONG"
  | "CONCEALED_KONG"
  | "RELEASE_WILDCARD";

export type CompetitiveProfileRow = {
  sessionId: string;
  rankLevel: number;
  highestMajorIndex: number;
  protectionCards: number;
  exposedKongCount: number;
  indicatorPongKongCount: number;
  addedKongCount: number;
  concealedKongCount: number;
  releaseWildcardCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicCompetitiveProfileRow = Pick<
  CompetitiveProfileRow,
  | "sessionId"
  | "rankLevel"
  | "exposedKongCount"
  | "indicatorPongKongCount"
  | "addedKongCount"
  | "concealedKongCount"
  | "releaseWildcardCount"
>;

export type AppVersionRow = {
  version: string;
  lastRevision: string;
  updatedAt: string;
};

export type MatchmakingEntryRow = {
  sessionId: string;
  rankLevelSnapshot: number;
  enqueuedAt: string;
  disconnectedAt: string | null;
  version: number;
  // Experience-phase "allow bots" preference, persisted so it survives a
  // server restart (MatchmakingService keeps an in-memory cache on top of
  // this column to avoid a DB round trip on every scheduler tick).
  allowBots: boolean;
};

export type UpsertMatchmakingEntryInput = {
  sessionId: string;
  rankLevelSnapshot: number;
  enqueuedAt?: string;
  allowBots?: boolean;
};

// SQLite has no boolean type; the raw row shape read straight off the
// connection carries allow_bots as 0/1 before it's normalized to a boolean
// for MatchmakingEntryRow consumers.
type MatchmakingEntryRowRaw = Omit<MatchmakingEntryRow, "allowBots"> & { allowBots: 0 | 1 };

export type CompetitiveMatchStatus = "ACTIVE" | "SETTLED";

export type CompetitiveMatchRow = {
  id: string;
  roomId: string;
  roundId: string;
  ruleVersion: number;
  status: CompetitiveMatchStatus;
  resultJson: string | null;
  createdAt: string;
  settledAt: string | null;
};

export type CompetitiveMatchPlayerRow = {
  matchId: string;
  sessionId: string;
  seat: number;
  preRankLevel: number;
  postRankLevel: number | null;
  rawRankDelta: number | null;
  finalRankDelta: number | null;
  protectionCardsBefore: number | null;
  protectionCardsAfter: number | null;
  protectionCardsConsumed: number | null;
  protectionCardsGranted: number | null;
  multiplier: number | null;
  acknowledgedAt: string | null;
};

export type CompetitiveMatchSettlement = {
  match: CompetitiveMatchRow;
  players: CompetitiveMatchPlayerRow[];
};

export type RoomSnapshotInput = {
  id: string;
  code: string;
  status: string;
  version: number;
};

export type CreateCompetitiveMatchInput = {
  match: {
    id: string;
    roomId: string;
    roundId: string;
    ruleVersion: number;
    createdAt?: string;
  };
  room: RoomSnapshotInput;
  stateJson: string;
  players: readonly { sessionId: string; seat: number; queueVersion: number }[];
};

/**
 * Variant of {@link CreateCompetitiveMatchInput} for an experience-phase bot
 * match: one to three real queued humans plus preset ranked bots filling the
 * remaining seats. Bots never queue, so only the humans carry a `queueVersion`;
 * the match-creation transaction deletes exactly the humans' queue entries.
 */
export type CreateCompetitiveMatchWithBotsInput = {
  match: CreateCompetitiveMatchInput["match"];
  room: RoomSnapshotInput;
  stateJson: string;
  humanPlayers: readonly { sessionId: string; seat: number; queueVersion: number }[];
  botPlayers: readonly { sessionId: string; seat: number }[];
};

export type CompetitiveActionEventInput = {
  eventKey: string;
  matchId: string;
  sessionId: string;
  roundId: string;
  roundVersion: number;
  action: CompetitiveAchievementAction;
  createdAt?: string;
};

export type CompetitivePlayerSettlementInput = {
  sessionId: string;
  postRankLevel: number;
  highestMajorIndex: number;
  rawRankDelta: number;
  finalRankDelta: number;
  protectionCardsBefore: number;
  protectionCardsAfter: number;
  protectionCardsConsumed: number;
  protectionCardsGranted: number;
  multiplier: number | null;
};

export type CompetitiveTerminalSettlementInput = {
  matchId: string;
  resultJson: string;
  players: readonly CompetitivePlayerSettlementInput[];
  settledAt?: string;
};

export type SaveAcceptedTransitionInput = {
  room: RoomSnapshotInput;
  stateJson: string;
  processedRequest?: {
    sessionId: string;
    requestId: string;
    resultJson: string;
  };
  achievementEvent?: CompetitiveActionEventInput;
  terminalSettlement?: CompetitiveTerminalSettlementInput;
};

export type SaveAcceptedTransitionResult = {
  achievementRecorded: boolean;
  settlementApplied: boolean;
};

/**
 * Thrown when a competitive match-creation transaction loses a race — either
 * a targeted session already has an active match, or the optimistic queue
 * row delete didn't consume the expected number of current/online entries
 * (a concurrent enqueue/disconnect/cancel changed the row's version out from
 * under the in-flight match build). Callers that build rooms from the
 * matchmaking queue treat this as "retry next tick" rather than a fatal
 * error; anything else (infrastructure failures, invariant violations)
 * should still surface as a plain `Error` and reach the process boundary.
 */
export class CompetitiveMatchCreationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitiveMatchCreationConflictError";
  }
}

function assertFourUniquePlayers(players: readonly { sessionId: string; seat?: number }[]): void {
  if (players.length !== 4 || new Set(players.map((player) => player.sessionId)).size !== 4) {
    throw new Error("A competitive match requires exactly four unique sessions");
  }
  const seats = players.map((player) => player.seat).filter((seat) => seat !== undefined);
  if (
    seats.length > 0 &&
    (seats.length !== 4 ||
      new Set(seats).size !== 4 ||
      seats.some((seat) => !Number.isInteger(seat) || seat < 0 || seat > 3))
  ) {
    throw new Error("Competitive match seats must be unique integers from 0 through 3");
  }
}

export class GameDatabase {
  readonly connection: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.connection = new Database(path);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS anonymous_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_requests (
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS technical_logs (
        id TEXT PRIMARY KEY,
        room_id TEXT,
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS competitive_profiles (
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

      CREATE TABLE IF NOT EXISTS matchmaking_entries (
        session_id TEXT PRIMARY KEY,
        rank_level_snapshot INTEGER NOT NULL CHECK (rank_level_snapshot >= 0),
        enqueued_at TEXT NOT NULL,
        disconnected_at TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (session_id) REFERENCES anonymous_sessions (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS competitive_matches (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL UNIQUE,
        round_id TEXT NOT NULL,
        rule_version INTEGER NOT NULL CHECK (rule_version >= 1),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SETTLED')),
        result_json TEXT,
        created_at TEXT NOT NULL,
        settled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS competitive_match_players (
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

      CREATE TABLE IF NOT EXISTS competitive_action_events (
        event_key TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        round_version INTEGER NOT NULL CHECK (round_version >= 0),
        action TEXT NOT NULL CHECK (
          action IN (
            'EXPOSED_KONG', 'INDICATOR_PONG_KONG', 'ADDED_KONG', 'CONCEALED_KONG', 'RELEASE_WILDCARD'
          )
        ),
        created_at TEXT NOT NULL,
        UNIQUE (match_id, session_id, round_id, round_version, action),
        FOREIGN KEY (match_id, session_id)
          REFERENCES competitive_match_players (match_id, session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_matchmaking_entries_order
        ON matchmaking_entries (enqueued_at, session_id);
      CREATE INDEX IF NOT EXISTS idx_matchmaking_entries_disconnected
        ON matchmaking_entries (disconnected_at)
        WHERE disconnected_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_competitive_matches_status
        ON competitive_matches (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_competitive_match_players_session
        ON competitive_match_players (session_id, match_id);
      CREATE INDEX IF NOT EXISTS idx_competitive_action_events_match
        ON competitive_action_events (match_id, round_id, round_version);

      CREATE TABLE IF NOT EXISTS app_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version TEXT NOT NULL,
        last_revision TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    // Additive columns for WeChat login — wrapped so re-running on a database
    // that already has them (every startup after the first) doesn't throw.
    for (const statement of [
      "ALTER TABLE anonymous_sessions ADD COLUMN wechat_open_id TEXT",
      "ALTER TABLE anonymous_sessions ADD COLUMN avatar_url TEXT",
      "ALTER TABLE matchmaking_entries ADD COLUMN allow_bots INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE competitive_profiles ADD COLUMN release_wildcard_count INTEGER NOT NULL DEFAULT 0 CHECK (release_wildcard_count >= 0)",
    ]) {
      try {
        this.connection.exec(statement);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column")) throw error;
      }
    }
    // SQLite treats every NULL as distinct under UNIQUE, so pre-existing
    // nickname-only rows (wechat_open_id IS NULL) never collide with each
    // other or with real openids.
    this.connection.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_sessions_open_id ON anonymous_sessions (wechat_open_id)",
    );
    // Unlike the additive columns above, a CHECK constraint baked into
    // competitive_action_events by an earlier CREATE TABLE (run against a
    // pre-existing database file) can't be widened with ALTER TABLE — SQLite
    // has no "ALTER CHECK CONSTRAINT". Detect that case by inspecting the
    // persisted table definition and, if it predates RELEASE_WILDCARD,
    // rebuild the table with the current schema and copy the rows over.
    this.migrateCompetitiveActionEventsCheckConstraint();
  }

  private migrateCompetitiveActionEventsCheckConstraint(): void {
    const existing = this.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'competitive_action_events'")
      .get() as { sql: string } | undefined;
    if (existing === undefined || existing.sql.includes("RELEASE_WILDCARD")) return;
    const rebuild = this.connection.transaction(() => {
      this.connection.exec(`
        ALTER TABLE competitive_action_events RENAME TO competitive_action_events_pre_release_wildcard;
        CREATE TABLE competitive_action_events (
          event_key TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          round_id TEXT NOT NULL,
          round_version INTEGER NOT NULL CHECK (round_version >= 0),
          action TEXT NOT NULL CHECK (
            action IN (
              'EXPOSED_KONG', 'INDICATOR_PONG_KONG', 'ADDED_KONG', 'CONCEALED_KONG', 'RELEASE_WILDCARD'
            )
          ),
          created_at TEXT NOT NULL,
          UNIQUE (match_id, session_id, round_id, round_version, action),
          FOREIGN KEY (match_id, session_id)
            REFERENCES competitive_match_players (match_id, session_id) ON DELETE CASCADE
        );
        INSERT INTO competitive_action_events
          SELECT * FROM competitive_action_events_pre_release_wildcard;
        DROP TABLE competitive_action_events_pre_release_wildcard;
        CREATE INDEX IF NOT EXISTS idx_competitive_action_events_match
          ON competitive_action_events (match_id, round_id, round_version);
      `);
    });
    const foreignKeysWereOn = (this.connection.pragma("foreign_keys", { simple: true }) as number) === 1;
    if (foreignKeysWereOn) this.connection.pragma("foreign_keys = OFF");
    try {
      rebuild();
    } finally {
      if (foreignKeysWereOn) this.connection.pragma("foreign_keys = ON");
    }
  }

  private static readonly SESSION_COLUMNS =
    "id, nickname, wechat_open_id AS wechatOpenId, avatar_url AS avatarUrl";

  private static readonly COMPETITIVE_PROFILE_COLUMNS = `
    session_id AS sessionId,
    rank_level AS rankLevel,
    highest_major_index AS highestMajorIndex,
    protection_cards AS protectionCards,
    exposed_kong_count AS exposedKongCount,
    indicator_pong_kong_count AS indicatorPongKongCount,
    added_kong_count AS addedKongCount,
    concealed_kong_count AS concealedKongCount,
    release_wildcard_count AS releaseWildcardCount,
    created_at AS createdAt,
    updated_at AS updatedAt`;

  private static readonly PUBLIC_COMPETITIVE_PROFILE_COLUMNS = `
    session_id AS sessionId,
    rank_level AS rankLevel,
    exposed_kong_count AS exposedKongCount,
    indicator_pong_kong_count AS indicatorPongKongCount,
    added_kong_count AS addedKongCount,
    concealed_kong_count AS concealedKongCount,
    release_wildcard_count AS releaseWildcardCount`;

  private static readonly MATCHMAKING_ENTRY_COLUMNS = `
    session_id AS sessionId,
    rank_level_snapshot AS rankLevelSnapshot,
    enqueued_at AS enqueuedAt,
    disconnected_at AS disconnectedAt,
    version,
    allow_bots AS allowBots`;

  private static readonly COMPETITIVE_MATCH_COLUMNS = `
    id,
    room_id AS roomId,
    round_id AS roundId,
    rule_version AS ruleVersion,
    status,
    result_json AS resultJson,
    created_at AS createdAt,
    settled_at AS settledAt`;

  private static readonly COMPETITIVE_MATCH_PLAYER_COLUMNS = `
    match_id AS matchId,
    session_id AS sessionId,
    seat,
    pre_rank_level AS preRankLevel,
    post_rank_level AS postRankLevel,
    raw_rank_delta AS rawRankDelta,
    final_rank_delta AS finalRankDelta,
    protection_cards_before AS protectionCardsBefore,
    protection_cards_after AS protectionCardsAfter,
    protection_cards_consumed AS protectionCardsConsumed,
    protection_cards_granted AS protectionCardsGranted,
    multiplier,
    acknowledged_at AS acknowledgedAt`;

  findSessionByTokenHash(tokenHash: string): AnonymousSession | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.SESSION_COLUMNS} FROM anonymous_sessions WHERE token_hash = ?`,
      )
      .get(tokenHash) as AnonymousSession | undefined;
    return row ?? null;
  }

  findSessionByOpenId(openId: string): AnonymousSession | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.SESSION_COLUMNS} FROM anonymous_sessions WHERE wechat_open_id = ?`,
      )
      .get(openId) as AnonymousSession | undefined;
    return row ?? null;
  }

  findSessionsByIds(sessionIds: readonly string[]): AnonymousSession[] {
    const uniqueSessionIds = [...new Set(sessionIds)];
    if (uniqueSessionIds.length === 0) return [];
    const placeholders = uniqueSessionIds.map(() => "?").join(", ");
    const rows = this.connection
      .prepare(
        `SELECT ${GameDatabase.SESSION_COLUMNS}
         FROM anonymous_sessions
         WHERE id IN (${placeholders})`,
      )
      .all(...uniqueSessionIds) as AnonymousSession[];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return uniqueSessionIds.flatMap((sessionId) => {
      const row = rowsById.get(sessionId);
      return row === undefined ? [] : [row];
    });
  }

  createSession(session: AnonymousSession, tokenHash: string): void {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO anonymous_sessions
         (id, token_hash, nickname, wechat_open_id, avatar_url, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        tokenHash,
        session.nickname,
        session.wechatOpenId ?? null,
        session.avatarUrl ?? null,
        now,
        now,
      );
  }

  updateSession(session: AnonymousSession): void {
    this.connection
      .prepare("UPDATE anonymous_sessions SET nickname = ?, last_seen_at = ? WHERE id = ?")
      .run(session.nickname, new Date().toISOString(), session.id);
  }

  /**
   * First login for an openid creates a fresh row; a returning openid gets
   * its existing row's nickname/avatar/token refreshed in place instead of
   * spawning a duplicate anonymous session per login (see
   * `/api/auth/wechat` — previously every call discarded the openid and
   * issued a brand new session, never recognizing a returning player).
   */
  upsertWechatSession(
    params: { openId: string; nickname: string; avatarUrl: string | null },
    tokenHash: string,
  ): AnonymousSession {
    const now = new Date().toISOString();
    const existing = this.findSessionByOpenId(params.openId);
    if (existing !== null) {
      this.connection
        .prepare(
          `UPDATE anonymous_sessions
           SET nickname = ?, avatar_url = ?, token_hash = ?, last_seen_at = ?
           WHERE wechat_open_id = ?`,
        )
        .run(params.nickname, params.avatarUrl, tokenHash, now, params.openId);
      return { ...existing, nickname: params.nickname, avatarUrl: params.avatarUrl };
    }
    const session: AnonymousSession = {
      id: randomUUID(),
      nickname: params.nickname,
      wechatOpenId: params.openId,
      avatarUrl: params.avatarUrl,
    };
    this.createSession(session, tokenHash);
    return session;
  }

  /**
   * Rotate the token for an already-linked WeChat identity without changing
   * its saved profile. A missing openid stays missing — callers use that to
   * route first-time users into explicit avatar/nickname capture.
   */
  resumeWechatSession(openId: string, tokenHash: string): AnonymousSession | null {
    const existing = this.findSessionByOpenId(openId);
    if (existing === null) return null;
    this.connection
      .prepare(
        `UPDATE anonymous_sessions
         SET token_hash = ?, last_seen_at = ?
         WHERE wechat_open_id = ?`,
      )
      .run(tokenHash, new Date().toISOString(), openId);
    return existing;
  }

  ensureCompetitiveProfile(sessionId: string): CompetitiveProfileRow {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO competitive_profiles
         (session_id, created_at, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(sessionId, now, now);
    const profile = this.getCompetitiveProfile(sessionId);
    if (profile === null) throw new Error(`Unable to ensure competitive profile for ${sessionId}`);
    return profile;
  }

  /**
   * Idempotently seed a preset ranked bot account (anonymous session + a
   * competitive profile whose rank starts at the configured level). The rank
   * is only written when the profile is brand new, so a server restart never
   * clobbers a rank the bot earned through real settlement.
   *
   * `highest_major_index` MUST satisfy `>= min(floor(rankLevel/5), 7)` or
   * `competitiveRankStateSchema` rejects the profile and crashes competitive
   * settlement. The original seeding wrote only `rank_level`, leaving
   * `highest_major_index` at its 0 default — for any bot seeded above 黑铁 that
   * violated the invariant and took the server down on the first settlement.
   * The brand-new branch now sets both, and the existing-profile branch
   * self-heals the invariant (raising `highest_major_index` to the minimum
   * valid value, never lowering it, to preserve historical-best semantics).
   */
  ensureRankedBotSession(bot: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
    rankLevel: number;
  }): CompetitiveProfileRow {
    const now = new Date().toISOString();
    // Bots never log in, so they carry no usable token hash; a stable
    // placeholder keeps the NOT NULL column populated without colliding with
    // real session tokens.
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO anonymous_sessions
         (id, token_hash, nickname, wechat_open_id, avatar_url, created_at, last_seen_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(bot.id, `bot:${bot.id}`, bot.nickname, bot.avatarUrl, now, now);
    const inserted = this.connection
      .prepare(
        `INSERT OR IGNORE INTO competitive_profiles
         (session_id, created_at, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(bot.id, now, now);
    if (inserted.changes === 1) {
      this.connection
        .prepare(
          `UPDATE competitive_profiles
           SET rank_level = ?, highest_major_index = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(bot.rankLevel, Math.min(Math.floor(bot.rankLevel / 5), 7), now, bot.id);
    } else {
      const existing = this.getCompetitiveProfile(bot.id);
      if (existing !== null) {
        const minValidHighest = Math.min(Math.floor(existing.rankLevel / 5), 7);
        if (existing.highestMajorIndex < minValidHighest) {
          this.connection
            .prepare(
              `UPDATE competitive_profiles
               SET highest_major_index = ?, updated_at = ?
               WHERE session_id = ?`,
            )
            .run(minValidHighest, now, bot.id);
        }
      }
    }
    const profile = this.getCompetitiveProfile(bot.id);
    if (profile === null) throw new Error(`Unable to ensure ranked bot profile for ${bot.id}`);
    return profile;
  }

  hasActiveCompetitiveMatch(sessionId: string): boolean {
    const row = this.connection
      .prepare(
        `SELECT 1
         FROM competitive_matches
         JOIN competitive_match_players
           ON competitive_match_players.match_id = competitive_matches.id
         WHERE competitive_match_players.session_id = ?
           AND competitive_matches.status = 'ACTIVE'
         LIMIT 1`,
      )
      .get(sessionId);
    return row !== undefined;
  }

  getCompetitiveProfile(sessionId: string): CompetitiveProfileRow | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_PROFILE_COLUMNS}
         FROM competitive_profiles
         WHERE session_id = ?`,
      )
      .get(sessionId) as CompetitiveProfileRow | undefined;
    return row ?? null;
  }

  getPublicCompetitiveProfile(sessionId: string): PublicCompetitiveProfileRow | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.PUBLIC_COMPETITIVE_PROFILE_COLUMNS}
         FROM competitive_profiles
         WHERE session_id = ?`,
      )
      .get(sessionId) as PublicCompetitiveProfileRow | undefined;
    return row ?? null;
  }

  getPublicCompetitiveProfiles(sessionIds: readonly string[]): PublicCompetitiveProfileRow[] {
    const uniqueSessionIds = [...new Set(sessionIds)];
    if (uniqueSessionIds.length === 0) return [];
    const placeholders = uniqueSessionIds.map(() => "?").join(", ");
    const rows = this.connection
      .prepare(
        `SELECT ${GameDatabase.PUBLIC_COMPETITIVE_PROFILE_COLUMNS}
         FROM competitive_profiles
         WHERE session_id IN (${placeholders})`,
      )
      .all(...uniqueSessionIds) as PublicCompetitiveProfileRow[];
    const rowsBySessionId = new Map(rows.map((row) => [row.sessionId, row]));
    return uniqueSessionIds.flatMap((sessionId) => {
      const row = rowsBySessionId.get(sessionId);
      return row === undefined ? [] : [row];
    });
  }

  upsertMatchmakingEntry(input: UpsertMatchmakingEntryInput): MatchmakingEntryRow {
    return this.connection.transaction(() => {
      const activeMatch = this.connection
        .prepare(
          `SELECT 1
           FROM competitive_match_players
           JOIN competitive_matches
             ON competitive_matches.id = competitive_match_players.match_id
           WHERE competitive_match_players.session_id = ?
             AND (
               competitive_matches.status = 'ACTIVE'
               OR competitive_match_players.acknowledged_at IS NULL
             )
           LIMIT 1`,
        )
        .get(input.sessionId);
      if (activeMatch !== undefined) {
        throw new Error(`Session ${input.sessionId} already has an active competitive match`);
      }
      const enqueuedAt = input.enqueuedAt ?? new Date().toISOString();
      const allowBots = input.allowBots === true ? 1 : 0;
      this.connection
        .prepare(
          `INSERT INTO matchmaking_entries
           (session_id, rank_level_snapshot, enqueued_at, disconnected_at, version, allow_bots)
           VALUES (?, ?, ?, NULL, 1, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             rank_level_snapshot = excluded.rank_level_snapshot,
             disconnected_at = NULL,
             allow_bots = excluded.allow_bots,
             version = CASE
               WHEN matchmaking_entries.disconnected_at IS NULL
                 AND matchmaking_entries.rank_level_snapshot = excluded.rank_level_snapshot
                 AND matchmaking_entries.allow_bots = excluded.allow_bots
               THEN matchmaking_entries.version
               ELSE matchmaking_entries.version + 1
             END`,
        )
        .run(input.sessionId, input.rankLevelSnapshot, enqueuedAt, allowBots);
      const entry = this.getMatchmakingEntry(input.sessionId);
      if (entry === null) {
        throw new Error(`Unable to upsert matchmaking entry for ${input.sessionId}`);
      }
      return entry;
    })();
  }

  getMatchmakingEntry(sessionId: string): MatchmakingEntryRow | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.MATCHMAKING_ENTRY_COLUMNS}
         FROM matchmaking_entries
         WHERE session_id = ?`,
      )
      .get(sessionId) as MatchmakingEntryRowRaw | undefined;
    return row === undefined ? null : GameDatabase.toMatchmakingEntryRow(row);
  }

  listMatchmakingEntries(): MatchmakingEntryRow[] {
    return (
      this.connection
        .prepare(
          `SELECT ${GameDatabase.MATCHMAKING_ENTRY_COLUMNS}
           FROM matchmaking_entries
           ORDER BY enqueued_at, session_id`,
        )
        .all() as MatchmakingEntryRowRaw[]
    ).map((row) => GameDatabase.toMatchmakingEntryRow(row));
  }

  private static toMatchmakingEntryRow(row: MatchmakingEntryRowRaw): MatchmakingEntryRow {
    return { ...row, allowBots: row.allowBots === 1 };
  }

  cancelMatchmakingEntry(sessionId: string): boolean {
    return (
      this.connection.prepare("DELETE FROM matchmaking_entries WHERE session_id = ?").run(sessionId)
        .changes === 1
    );
  }

  markAllMatchmakingEntriesDisconnected(disconnectedAt = new Date().toISOString()): number {
    return this.connection
      .prepare(
        `UPDATE matchmaking_entries
         SET disconnected_at = ?, version = version + 1
         WHERE disconnected_at IS NULL`,
      )
      .run(disconnectedAt).changes;
  }

  markMatchmakingEntryConnected(sessionId: string): MatchmakingEntryRow | null {
    this.connection
      .prepare(
        `UPDATE matchmaking_entries
         SET disconnected_at = NULL, version = version + 1
         WHERE session_id = ? AND disconnected_at IS NOT NULL`,
      )
      .run(sessionId);
    return this.getMatchmakingEntry(sessionId);
  }

  markMatchmakingEntryDisconnected(
    sessionId: string,
    disconnectedAt = new Date().toISOString(),
  ): MatchmakingEntryRow | null {
    this.connection
      .prepare(
        `UPDATE matchmaking_entries
         SET disconnected_at = ?, version = version + 1
         WHERE session_id = ? AND disconnected_at IS NULL`,
      )
      .run(disconnectedAt, sessionId);
    return this.getMatchmakingEntry(sessionId);
  }

  expireDisconnectedMatchmakingEntries(disconnectedBefore: string): string[] {
    return this.connection.transaction(() => {
      const rows = this.connection
        .prepare(
          `SELECT session_id AS sessionId
           FROM matchmaking_entries
           WHERE disconnected_at IS NOT NULL AND disconnected_at <= ?
           ORDER BY disconnected_at, session_id`,
        )
        .all(disconnectedBefore) as { sessionId: string }[];
      if (rows.length === 0) return [];
      const placeholders = rows.map(() => "?").join(", ");
      this.connection
        .prepare(`DELETE FROM matchmaking_entries WHERE session_id IN (${placeholders})`)
        .run(...rows.map((row) => row.sessionId));
      return rows.map((row) => row.sessionId);
    })();
  }

  createCompetitiveMatch(input: CreateCompetitiveMatchInput): CompetitiveMatchSettlement {
    assertFourUniquePlayers(input.players);
    if (input.room.id !== input.match.roomId) {
      throw new Error("Competitive match roomId must equal the persisted room id");
    }
    return this.connection.transaction(() => {
      const sessionIds = input.players.map((player) => player.sessionId);
      const placeholders = sessionIds.map(() => "?").join(", ");
      const activeMatch = this.connection
        .prepare(
          `SELECT competitive_match_players.session_id AS sessionId
           FROM competitive_match_players
           JOIN competitive_matches
             ON competitive_matches.id = competitive_match_players.match_id
           WHERE competitive_matches.status = 'ACTIVE'
             AND competitive_match_players.session_id IN (${placeholders})
           LIMIT 1`,
        )
        .get(...sessionIds) as { sessionId: string } | undefined;
      if (activeMatch !== undefined) {
        throw new CompetitiveMatchCreationConflictError(
          `Session ${activeMatch.sessionId} already has an active competitive match`,
        );
      }

      const profiles = new Map(
        sessionIds.map((sessionId) => {
          const profile = this.ensureCompetitiveProfile(sessionId);
          return [sessionId, profile] as const;
        }),
      );
      this.saveRoom(input.room, input.stateJson);
      const createdAt = input.match.createdAt ?? new Date().toISOString();
      this.connection
        .prepare(
          `INSERT INTO competitive_matches
           (id, room_id, round_id, rule_version, status, result_json, created_at, settled_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL)`,
        )
        .run(
          input.match.id,
          input.match.roomId,
          input.match.roundId,
          input.match.ruleVersion,
          createdAt,
        );
      const insertPlayer = this.connection.prepare(
        `INSERT INTO competitive_match_players
         (match_id, session_id, seat, pre_rank_level)
         VALUES (?, ?, ?, ?)`,
      );
      for (const player of input.players) {
        const profile = profiles.get(player.sessionId);
        if (profile === undefined)
          throw new Error("Missing competitive profile during match creation");
        insertPlayer.run(input.match.id, player.sessionId, player.seat, profile.rankLevel);
      }
      const deleteQueuedPlayer = this.connection.prepare(
        `DELETE FROM matchmaking_entries
         WHERE session_id = ? AND version = ? AND disconnected_at IS NULL`,
      );
      const deleted = input.players.reduce(
        (total, player) =>
          total + deleteQueuedPlayer.run(player.sessionId, player.queueVersion).changes,
        0,
      );
      if (deleted !== 4) {
        throw new CompetitiveMatchCreationConflictError(
          `Competitive match creation expected four current online queue entries, deleted ${deleted}`,
        );
      }
      const settlement = this.getCompetitiveMatchSettlement(input.match.id);
      if (settlement === null) throw new Error("Competitive match was not persisted");
      return settlement;
    })();
  }

  /**
   * Create a competitive match between one to three queued humans and preset
   * ranked bots filling the remaining seats. Identical to
   * {@link createCompetitiveMatch} except only the humans' queue entries are
   * deleted (bots never queue), so the optimistic delete count equals the
   * number of humans instead of 4. The active-match guard still covers all
   * four sessions, which is what prevents two simultaneous bot matches from
   * double-booking the shared bot accounts.
   */
  createCompetitiveMatchWithBots(input: CreateCompetitiveMatchWithBotsInput): CompetitiveMatchSettlement {
    const allPlayers = [...input.humanPlayers, ...input.botPlayers];
    assertFourUniquePlayers(allPlayers);
    if (input.room.id !== input.match.roomId) {
      throw new Error("Competitive match roomId must equal the persisted room id");
    }
    if (
      input.humanPlayers.length < 1 ||
      input.humanPlayers.length > 3 ||
      input.botPlayers.length !== 4 - input.humanPlayers.length
    ) {
      throw new Error("A competitive bot match needs 1-3 humans plus bots filling the rest of the table");
    }
    return this.connection.transaction(() => {
      const sessionIds = allPlayers.map((player) => player.sessionId);
      const placeholders = sessionIds.map(() => "?").join(", ");
      const activeMatch = this.connection
        .prepare(
          `SELECT competitive_match_players.session_id AS sessionId
           FROM competitive_match_players
           JOIN competitive_matches
             ON competitive_matches.id = competitive_match_players.match_id
           WHERE competitive_matches.status = 'ACTIVE'
             AND competitive_match_players.session_id IN (${placeholders})
           LIMIT 1`,
        )
        .get(...sessionIds) as { sessionId: string } | undefined;
      if (activeMatch !== undefined) {
        throw new CompetitiveMatchCreationConflictError(
          `Session ${activeMatch.sessionId} already has an active competitive match`,
        );
      }

      const profiles = new Map(
        sessionIds.map((sessionId) => {
          const profile = this.ensureCompetitiveProfile(sessionId);
          return [sessionId, profile] as const;
        }),
      );
      this.saveRoom(input.room, input.stateJson);
      const createdAt = input.match.createdAt ?? new Date().toISOString();
      this.connection
        .prepare(
          `INSERT INTO competitive_matches
           (id, room_id, round_id, rule_version, status, result_json, created_at, settled_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL)`,
        )
        .run(
          input.match.id,
          input.match.roomId,
          input.match.roundId,
          input.match.ruleVersion,
          createdAt,
        );
      const insertPlayer = this.connection.prepare(
        `INSERT INTO competitive_match_players
         (match_id, session_id, seat, pre_rank_level)
         VALUES (?, ?, ?, ?)`,
      );
      for (const player of allPlayers) {
        const profile = profiles.get(player.sessionId);
        if (profile === undefined)
          throw new Error("Missing competitive profile during match creation");
        insertPlayer.run(input.match.id, player.sessionId, player.seat, profile.rankLevel);
      }
      // Bots never queue, so only the humans' queue entries are consumed.
      const deleteQueuedPlayer = this.connection.prepare(
        `DELETE FROM matchmaking_entries
         WHERE session_id = ? AND version = ? AND disconnected_at IS NULL`,
      );
      let deleted = 0;
      for (const human of input.humanPlayers) {
        deleted += deleteQueuedPlayer.run(human.sessionId, human.queueVersion).changes;
      }
      if (deleted !== input.humanPlayers.length) {
        throw new CompetitiveMatchCreationConflictError(
          `Competitive bot match creation expected ${input.humanPlayers.length} current online queue entries, deleted ${deleted}`,
        );
      }
      const settlement = this.getCompetitiveMatchSettlement(input.match.id);
      if (settlement === null) throw new Error("Competitive match was not persisted");
      return settlement;
    })();
  }

  getActiveCompetitiveMatch(sessionId: string): CompetitiveMatchSettlement | null {
    const row = this.connection
      .prepare(
        `SELECT competitive_matches.id
         FROM competitive_matches
         JOIN competitive_match_players
           ON competitive_match_players.match_id = competitive_matches.id
         WHERE competitive_match_players.session_id = ?
           AND competitive_matches.status = 'ACTIVE'
         ORDER BY competitive_matches.created_at DESC, competitive_matches.id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { id: string } | undefined;
    return row === undefined ? null : this.getCompetitiveMatchSettlement(row.id);
  }

  getCurrentCompetitiveMatch(sessionId: string): CompetitiveMatchSettlement | null {
    const row = this.connection
      .prepare(
        `SELECT competitive_matches.id
         FROM competitive_matches
         JOIN competitive_match_players
           ON competitive_match_players.match_id = competitive_matches.id
         WHERE competitive_match_players.session_id = ?
           AND (
             competitive_matches.status = 'ACTIVE'
             OR (
               competitive_matches.status = 'SETTLED'
               AND competitive_match_players.acknowledged_at IS NULL
             )
           )
         ORDER BY (competitive_matches.status = 'ACTIVE') DESC,
           competitive_matches.created_at DESC,
           competitive_matches.id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { id: string } | undefined;
    return row === undefined ? null : this.getCompetitiveMatchSettlement(row.id);
  }

  getRecentCompetitiveOpponentIds(sessionId: string, matchLimit = 5): string[] {
    if (!Number.isInteger(matchLimit) || matchLimit <= 0) return [];
    const rows = this.connection
      .prepare(
        `WITH recent_matches AS (
           SELECT competitive_matches.id, competitive_matches.created_at
           FROM competitive_matches
           JOIN competitive_match_players
             ON competitive_match_players.match_id = competitive_matches.id
           WHERE competitive_match_players.session_id = ?
           ORDER BY competitive_matches.created_at DESC, competitive_matches.id DESC
           LIMIT ?
         )
         SELECT competitive_match_players.session_id AS sessionId
         FROM recent_matches
         JOIN competitive_match_players
           ON competitive_match_players.match_id = recent_matches.id
         WHERE competitive_match_players.session_id <> ?
         ORDER BY recent_matches.created_at DESC, recent_matches.id DESC,
           competitive_match_players.seat`,
      )
      .all(sessionId, matchLimit, sessionId) as { sessionId: string }[];
    return [...new Set(rows.map((row) => row.sessionId))];
  }

  getCompetitiveMatchSettlement(matchId: string): CompetitiveMatchSettlement | null {
    const match = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_MATCH_COLUMNS}
         FROM competitive_matches
         WHERE id = ?`,
      )
      .get(matchId) as CompetitiveMatchRow | undefined;
    if (match === undefined) return null;
    const players = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_MATCH_PLAYER_COLUMNS}
         FROM competitive_match_players
         WHERE match_id = ?
         ORDER BY seat`,
      )
      .all(matchId) as CompetitiveMatchPlayerRow[];
    return { match, players };
  }

  getCompetitiveMatchPlayer(matchId: string, sessionId: string): CompetitiveMatchPlayerRow | null {
    const row = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_MATCH_PLAYER_COLUMNS}
         FROM competitive_match_players
         WHERE match_id = ? AND session_id = ?`,
      )
      .get(matchId, sessionId) as CompetitiveMatchPlayerRow | undefined;
    return row ?? null;
  }

  acknowledgeCompetitiveMatchResult(
    matchId: string,
    sessionId: string,
    acknowledgedAt = new Date().toISOString(),
  ): CompetitiveMatchPlayerRow | null {
    this.connection
      .prepare(
        `UPDATE competitive_match_players
         SET acknowledged_at = ?
         WHERE match_id = ? AND session_id = ? AND acknowledged_at IS NULL
           AND EXISTS (
             SELECT 1 FROM competitive_matches
             WHERE competitive_matches.id = competitive_match_players.match_id
               AND competitive_matches.status = 'SETTLED'
           )`,
      )
      .run(acknowledgedAt, matchId, sessionId);
    const settledPlayer = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_MATCH_PLAYER_COLUMNS}
         FROM competitive_match_players
         WHERE competitive_match_players.match_id = ?
           AND competitive_match_players.session_id = ?
           AND EXISTS (
             SELECT 1 FROM competitive_matches
             WHERE competitive_matches.id = competitive_match_players.match_id
               AND competitive_matches.status = 'SETTLED'
           )`,
      )
      .get(matchId, sessionId) as CompetitiveMatchPlayerRow | undefined;
    return settledPlayer ?? null;
  }

  acknowledgeAllCompetitiveMatchResults(
    matchId: string,
    acknowledgedAt = new Date().toISOString(),
  ): number {
    return this.connection
      .prepare(
        `UPDATE competitive_match_players
         SET acknowledged_at = ?
         WHERE match_id = ? AND acknowledged_at IS NULL
           AND EXISTS (
             SELECT 1 FROM competitive_matches
             WHERE competitive_matches.id = competitive_match_players.match_id
               AND competitive_matches.status = 'SETTLED'
           )`,
      )
      .run(acknowledgedAt, matchId).changes;
  }

  acknowledgeAndEnqueueCompetitiveMatch(
    matchId: string,
    sessionId: string,
    enqueuedAt = new Date().toISOString(),
    allowBots = false,
  ): MatchmakingEntryRow {
    return this.connection.transaction(() => {
      const player = this.acknowledgeCompetitiveMatchResult(matchId, sessionId, enqueuedAt);
      if (player === null) {
        throw new Error("Only a settled match member can continue matchmaking");
      }
      const profile = this.ensureCompetitiveProfile(sessionId);
      return this.upsertMatchmakingEntry({
        sessionId,
        rankLevelSnapshot: profile.rankLevel,
        enqueuedAt,
        allowBots,
      });
    })();
  }

  saveAcceptedTransition(input: SaveAcceptedTransitionInput): SaveAcceptedTransitionResult {
    return this.connection.transaction(() => {
      this.saveRoom(input.room, input.stateJson);
      if (input.processedRequest !== undefined) {
        this.saveProcessedRequest(
          input.processedRequest.sessionId,
          input.processedRequest.requestId,
          input.processedRequest.resultJson,
        );
      }
      const achievementRecorded =
        input.achievementEvent === undefined
          ? false
          : this.recordCompetitiveAchievement(input.room.id, input.achievementEvent);
      const settlementApplied =
        input.terminalSettlement === undefined
          ? false
          : this.applyCompetitiveSettlement(input.room.id, input.terminalSettlement);
      return { achievementRecorded, settlementApplied };
    })();
  }

  private recordCompetitiveAchievement(
    roomId: string,
    event: CompetitiveActionEventInput,
  ): boolean {
    const match = this.connection
      .prepare("SELECT room_id AS roomId, status FROM competitive_matches WHERE id = ?")
      .get(event.matchId) as { roomId: string; status: CompetitiveMatchStatus } | undefined;
    if (match?.roomId !== roomId) {
      throw new Error("Competitive achievement event must belong to the persisted room match");
    }
    const existingEvent = this.connection
      .prepare(
        `SELECT match_id AS matchId, session_id AS sessionId, round_id AS roundId,
           round_version AS roundVersion, action
         FROM competitive_action_events
         WHERE event_key = ?`,
      )
      .get(event.eventKey) as
      | {
          matchId: string;
          sessionId: string;
          roundId: string;
          roundVersion: number;
          action: CompetitiveAchievementAction;
        }
      | undefined;
    if (existingEvent !== undefined) {
      if (
        existingEvent.matchId !== event.matchId ||
        existingEvent.sessionId !== event.sessionId ||
        existingEvent.roundId !== event.roundId ||
        existingEvent.roundVersion !== event.roundVersion ||
        existingEvent.action !== event.action
      ) {
        throw new Error(`Competitive achievement event key ${event.eventKey} was reused`);
      }
      return false;
    }
    if (match.status !== "ACTIVE") {
      throw new Error("Cannot append a competitive achievement after settlement");
    }
    const createdAt = event.createdAt ?? new Date().toISOString();
    const inserted = this.connection
      .prepare(
        `INSERT OR IGNORE INTO competitive_action_events
         (event_key, match_id, session_id, round_id, round_version, action, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventKey,
        event.matchId,
        event.sessionId,
        event.roundId,
        event.roundVersion,
        event.action,
        createdAt,
      ).changes;
    if (inserted === 0) return false;
    const counterColumn: Record<CompetitiveAchievementAction, string> = {
      EXPOSED_KONG: "exposed_kong_count",
      INDICATOR_PONG_KONG: "indicator_pong_kong_count",
      ADDED_KONG: "added_kong_count",
      CONCEALED_KONG: "concealed_kong_count",
      RELEASE_WILDCARD: "release_wildcard_count",
    };
    const updated = this.connection
      .prepare(
        `UPDATE competitive_profiles
         SET ${counterColumn[event.action]} = ${counterColumn[event.action]} + 1, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(createdAt, event.sessionId).changes;
    if (updated !== 1) throw new Error("Competitive achievement profile is missing");
    return true;
  }

  private applyCompetitiveSettlement(
    roomId: string,
    settlement: CompetitiveTerminalSettlementInput,
  ): boolean {
    assertFourUniquePlayers(settlement.players);
    const match = this.connection
      .prepare("SELECT room_id AS roomId, status FROM competitive_matches WHERE id = ?")
      .get(settlement.matchId) as { roomId: string; status: CompetitiveMatchStatus } | undefined;
    if (match?.roomId !== roomId) {
      throw new Error("Competitive settlement must belong to the persisted room match");
    }
    if (match.status === "SETTLED") return false;

    const existingPlayers = this.connection
      .prepare(
        `SELECT ${GameDatabase.COMPETITIVE_MATCH_PLAYER_COLUMNS}
         FROM competitive_match_players
         WHERE match_id = ?
         ORDER BY seat`,
      )
      .all(settlement.matchId) as CompetitiveMatchPlayerRow[];
    const existingSessionIds = new Set(existingPlayers.map((player) => player.sessionId));
    if (
      existingPlayers.length !== 4 ||
      settlement.players.some((player) => !existingSessionIds.has(player.sessionId))
    ) {
      throw new Error("Competitive settlement players do not match the persisted match");
    }

    const settledAt = settlement.settledAt ?? new Date().toISOString();
    const updatePlayer = this.connection.prepare(
      `UPDATE competitive_match_players
       SET post_rank_level = ?, raw_rank_delta = ?, final_rank_delta = ?,
         protection_cards_before = ?, protection_cards_after = ?,
         protection_cards_consumed = ?, protection_cards_granted = ?, multiplier = ?
       WHERE match_id = ? AND session_id = ? AND post_rank_level IS NULL`,
    );
    const updateProfile = this.connection.prepare(
      `UPDATE competitive_profiles
       SET rank_level = ?, highest_major_index = ?, protection_cards = ?, updated_at = ?
       WHERE session_id = ? AND rank_level = ? AND protection_cards = ?`,
    );
    for (const result of settlement.players) {
      const persistedPlayer = existingPlayers.find(
        (player) => player.sessionId === result.sessionId,
      );
      const profile = this.getCompetitiveProfile(result.sessionId);
      if (persistedPlayer === undefined || profile === null) {
        throw new Error("Competitive settlement profile or player is missing");
      }
      if (
        persistedPlayer.preRankLevel !== profile.rankLevel ||
        result.protectionCardsBefore !== profile.protectionCards ||
        result.postRankLevel - profile.rankLevel !== result.finalRankDelta ||
        result.protectionCardsAfter !==
          result.protectionCardsBefore -
            result.protectionCardsConsumed +
            result.protectionCardsGranted ||
        result.highestMajorIndex < profile.highestMajorIndex
      ) {
        throw new Error(`Competitive settlement precondition failed for ${result.sessionId}`);
      }
      const playerChanges = updatePlayer.run(
        result.postRankLevel,
        result.rawRankDelta,
        result.finalRankDelta,
        result.protectionCardsBefore,
        result.protectionCardsAfter,
        result.protectionCardsConsumed,
        result.protectionCardsGranted,
        result.multiplier,
        settlement.matchId,
        result.sessionId,
      ).changes;
      const profileChanges = updateProfile.run(
        result.postRankLevel,
        result.highestMajorIndex,
        result.protectionCardsAfter,
        settledAt,
        result.sessionId,
        profile.rankLevel,
        profile.protectionCards,
      ).changes;
      if (playerChanges !== 1 || profileChanges !== 1) {
        throw new Error(`Competitive settlement could not update ${result.sessionId}`);
      }
    }
    const matchChanges = this.connection
      .prepare(
        `UPDATE competitive_matches
         SET status = 'SETTLED', result_json = ?, settled_at = ?
         WHERE id = ? AND status = 'ACTIVE'`,
      )
      .run(settlement.resultJson, settledAt, settlement.matchId).changes;
    if (matchChanges !== 1) throw new Error("Competitive match was already settled");
    return true;
  }

  saveRoom(room: RoomSnapshotInput, stateJson: string): void {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO rooms (id, code, status, version, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code,
           status = excluded.status,
           version = excluded.version,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run(room.id, room.code, room.status, room.version, stateJson, now, now);
  }

  loadActiveRooms(): string[] {
    const rows = this.connection
      .prepare("SELECT state_json FROM rooms WHERE status = 'ACTIVE'")
      .all() as { state_json: string }[];
    return rows.map((row) => row.state_json);
  }

  deleteRoom(roomId: string): void {
    this.connection.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  }

  deleteClosedRooms(): number {
    return this.connection.prepare("DELETE FROM rooms WHERE status = 'CLOSED'").run().changes;
  }

  getProcessedRequest(sessionId: string, requestId: string): string | null {
    const row = this.connection
      .prepare("SELECT result_json FROM processed_requests WHERE session_id = ? AND request_id = ?")
      .get(sessionId, requestId) as { result_json: string } | undefined;
    return row?.result_json ?? null;
  }

  saveProcessedRequest(sessionId: string, requestId: string, resultJson: string): void {
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO processed_requests
         (session_id, request_id, result_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, requestId, resultJson, new Date().toISOString());
  }

  saveRoomAndProcessedRequest(
    room: { id: string; code: string; status: string; version: number },
    stateJson: string,
    sessionId: string,
    requestId: string,
    resultJson: string,
  ): void {
    this.connection.transaction(() => {
      this.saveRoom(room, stateJson);
      this.saveProcessedRequest(sessionId, requestId, resultJson);
    })();
  }

  getAppVersion(): AppVersionRow | null {
    const row = this.connection
      .prepare("SELECT version, last_revision, updated_at FROM app_version WHERE id = 1")
      .get() as { version: string; last_revision: string; updated_at: string } | undefined;
    if (!row) return null;
    return { version: row.version, lastRevision: row.last_revision, updatedAt: row.updated_at };
  }

  upsertAppVersion(row: AppVersionRow): void {
    this.connection
      .prepare(
        `INSERT INTO app_version (id, version, last_revision, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           last_revision = excluded.last_revision,
           updated_at = excluded.updated_at`,
      )
      .run(row.version, row.lastRevision, row.updatedAt);
  }

  close(): void {
    this.connection.close();
  }
}
