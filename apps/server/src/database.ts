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
    `);
    // Additive columns for WeChat login — wrapped so re-running on a database
    // that already has them (every startup after the first) doesn't throw.
    for (const statement of [
      "ALTER TABLE anonymous_sessions ADD COLUMN wechat_open_id TEXT",
      "ALTER TABLE anonymous_sessions ADD COLUMN avatar_url TEXT",
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
  }

  private static readonly SESSION_COLUMNS =
    "id, nickname, wechat_open_id AS wechatOpenId, avatar_url AS avatarUrl";

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

  saveRoom(
    room: { id: string; code: string; status: string; version: number },
    stateJson: string,
  ): void {
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

  close(): void {
    this.connection.close();
  }
}
