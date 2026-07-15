# Database Guidelines

## Storage model

The server uses one synchronous `better-sqlite3` connection owned by `GameDatabase` in `apps/server/src/database.ts`. SQLite is the durable source for anonymous sessions, active room snapshots and command request deduplication. In-memory `RoomState` instances are restored from active room snapshots on process start.

The connection must enable these pragmas before serving traffic:

```ts
connection.pragma("journal_mode = WAL");
connection.pragma("foreign_keys = ON");
connection.pragma("busy_timeout = 5000");
```

## Query and transaction conventions

- Keep SQL inside `GameDatabase`; room and transport services must not access `connection` directly.
- Use bound parameters for every value. Never interpolate nicknames, room codes, IDs or JSON into SQL.
- Store a complete authoritative `RoomState` JSON snapshot with its monotonic room version.
- A successful player command must persist the new room snapshot and `(session_id, request_id)` result in one SQLite transaction through `saveRoomAndProcessedRequest`.
- Read a processed request before executing a command. Replays return the stored result without applying rules again.
- Use `INSERT OR IGNORE` only for idempotent request results; room snapshots use `ON CONFLICT(id) DO UPDATE`.

## Schema and naming

- Tables and columns use lowercase `snake_case`; TypeScript domain fields use `camelCase`.
- IDs are UUID strings, room codes are six-character strings and timestamps are UTC ISO-8601 strings.
- Schema creation is currently an idempotent startup migration in `GameDatabase.migrate`. New migrations must remain additive until a versioned migration runner replaces it.
- Closed rooms remain in SQLite but are not restored as active rooms.

## Backups

The production database is mounted at `/data/huanghuang.sqlite`. For the current personal-use deployment, stop the app before copying the file from the `game_data` volume. Restart only after the copy completes. Restore while stopped and remove stale `-wal` and `-shm` siblings.

## Forbidden patterns

- Do not persist private hands in logs or client projections.
- Do not acknowledge a successful command before its room snapshot and deduplication row commit.
- Do not open one SQLite connection per Socket or request.
- Do not copy a live WAL database file without using the documented stop-and-copy procedure or a future SQLite online-backup implementation.
