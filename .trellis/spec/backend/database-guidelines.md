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
- A successful player command must persist the new room snapshot and `(session_id, request_id)` result in one SQLite transaction. `saveAcceptedTransition` is the current unified path and may atomically include a competitive achievement fact and first terminal rank settlement.
- Read a processed request before executing a command. Replays return the stored result without applying rules again.
- Use `INSERT OR IGNORE` only for idempotent request/action facts; room snapshots use `ON CONFLICT(id) DO UPDATE`.
- Competitive match creation must save the room/match/players and delete exactly four current online queue rows with their expected queue versions in one transaction. A stale version, disconnect, cancel, or missing row rolls back the entire match.
- Rank settlement, room score and future wallet balances are distinct domains. Never place a rank level or monetary balance in `rooms.state_json` as its account source of truth.

## Schema and naming

- Tables and columns use lowercase `snake_case`; TypeScript domain fields use `camelCase`.
- IDs are UUID strings and timestamps are UTC ISO-8601 strings. Newly allocated
  room codes are four digits in the inclusive range `1000–9999`; active legacy
  snapshots may retain six-digit codes and must remain addressable until they
  naturally close.
- Schema creation is currently an idempotent startup migration in `GameDatabase.migrate`. New migrations must remain additive until a versioned migration runner replaces it.
- A room closure is persisted long enough to serve the authoritative close projection, then the scheduler deletes the row after the bounded notification window. Startup also deletes stale `CLOSED` rows before restoring active rooms.

## Room retirement

- `RoomService.closeRoom` makes a room non-joinable immediately and schedules a 30-second notification window.
- During that window, existing members can still resolve the snapshot and read `closeReason`; no command, join or chat may treat it as active.
- After the window, remove the room from `roomsByCode` and call `GameDatabase.deleteRoom(room.id)`. This bounded retention prevents both the in-memory map and the `rooms` table from accumulating abandoned rooms.
- Legacy active snapshots with `dissolveAfterRound = true` are deleted during restore rather than revived under obsolete delayed-dissolve semantics.

## Backups

The production database is mounted at `/data/huanghuang.sqlite`. For the current personal-use deployment, stop the app before copying the file from the `game_data` volume. Restart only after the copy completes. Restore while stopped and remove stale `-wal` and `-shm` siblings.

## Matchmaking preference persistence

- `matchmaking_entries.allow_bots` is the durable source of truth for a
  queued player's "allow bots" preference, added via the standard incremental
  `ALTER TABLE ... ADD COLUMN` try/catch pattern. `MatchmakingService` keeps an
  in-memory `Map<sessionId, boolean>` purely as a request-scoped cache — every
  write path (`enqueue()`, `continueMatchmaking()`) writes through to both the
  DB row and the cache in the same call, and `allowBotsFor(entry)` reads the
  cache first but falls back to (and backfills from) the DB row already
  fetched by the current `tick()`. This means a server restart self-heals the
  preference from the DB on the next tick instead of silently reverting every
  still-queued player to "no bots." Do not reintroduce an in-memory-only
  preference for anything that must survive a restart while its queue entry
  does.
- Match-creation concurrency conflicts (a benign race where another tick's
  transaction already consumed the four expected queue rows, or a targeted
  bot is already in an active match) throw `CompetitiveMatchCreationConflictError`
  (`database.ts`), not a plain `Error` with a matching message string. Callers
  that need to distinguish "safe to retry next tick" from "genuine bug" must
  use `instanceof CompetitiveMatchCreationConflictError`, never
  `error.message.includes(...)` — a message rewording must not silently turn
  a benign race into an unhandled crash (or the reverse: silently swallow a
  real bug because its message happened to match).

## Forbidden patterns

- Do not persist private hands in logs or client projections.
- Do not acknowledge a successful command before its room snapshot and deduplication row commit.
- Do not open one SQLite connection per Socket or request.
- Do not delete a room before its close update can be read by subscribed clients; also do not retain closed room snapshots indefinitely.
- Do not copy a live WAL database file without using the documented stop-and-copy procedure or a future SQLite online-backup implementation.
