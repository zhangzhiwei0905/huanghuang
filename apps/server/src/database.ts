import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AnonymousSession = {
  id: string;
  nickname: string;
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
  }

  findSessionByTokenHash(tokenHash: string): AnonymousSession | null {
    const row = this.connection
      .prepare("SELECT id, nickname FROM anonymous_sessions WHERE token_hash = ?")
      .get(tokenHash) as AnonymousSession | undefined;
    return row ?? null;
  }

  createSession(session: AnonymousSession, tokenHash: string): void {
    const now = new Date().toISOString();
    this.connection
      .prepare(
        `INSERT INTO anonymous_sessions
         (id, token_hash, nickname, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(session.id, tokenHash, session.nickname, now, now);
  }

  updateSession(session: AnonymousSession): void {
    this.connection
      .prepare("UPDATE anonymous_sessions SET nickname = ?, last_seen_at = ? WHERE id = ?")
      .run(session.nickname, new Date().toISOString(), session.id);
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
