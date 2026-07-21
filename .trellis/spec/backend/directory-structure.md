# Backend Directory Structure

## Current layout

```text
apps/server/src/
├── index.ts              # Fastify + Socket.IO process entry, HTTP routes, socket handlers
├── database.ts           # GameDatabase: SQLite ownership, migrations, snapshots, dedupe
├── session-service.ts    # Anonymous cookie sessions (token hash only)
├── room-service.ts       # Authoritative RoomState, commands, timers, bot scheduling
└── room-service.test.ts  # Service-level scenarios (vitest)

packages/protocol/src/
├── game.ts               # Tile/meld/win/score domain types + Zod
├── commands.ts           # Command envelopes, room HTTP schemas, CommandResult
├── projections.ts        # Client-facing RoomProjection / player views
└── index.ts              # Public barrel

packages/game-engine/src/
├── tiles.ts              # Deck, shuffle helpers
├── actions.ts            # Legal action evaluation
├── round.ts              # Round progression
├── win.ts                # Pure win evaluator
├── settlement.ts         # Score formulas (zero-sum invariants)
├── bot.ts                # Restricted-view bot decisions
└── index.ts              # Public barrel only — no deep imports by consumers
```

## Dependency rules

- `apps/server` may import `@huanghuang/protocol` and `@huanghuang/game-engine`.
- `game-engine` may import domain types from protocol but no server, database, clock, Socket, React, or filesystem code.
- Protocol owns decoding and shared DTOs; transport handlers in `index.ts` parse with Zod and call services.
- Rules are exported from `packages/game-engine/src/index.ts`; consumers do not deep-import engine internals.
- SQL stays inside `GameDatabase`. `RoomService` and `SessionService` never touch the raw `connection`.

## Service boundaries

| Module | Owns | Does not own |
|--------|------|--------------|
| `index.ts` | HTTP status mapping, Socket events, static web root, process timers | Game rules, SQL |
| `RoomService` | In-memory rooms, command execution, projections, bot/timeout scheduling | Cookie crypto, raw SQL |
| `SessionService` | Cookie issue/lookup, session rows via `GameDatabase` | Room rules |
| `GameDatabase` | WAL SQLite, snapshots, processed requests | Business decisions |

## Current examples

- `packages/game-engine/src/win.ts` is a pure evaluator.
- `packages/game-engine/src/settlement.ts` owns every score formula.
- `apps/server/src/room-service.ts` `execute()` is the authoritative command path with request dedupe.
- `apps/server/src/index.ts` owns process startup, health endpoints, and Socket `room:command` / `room:chat` acks.

## Naming

- Domain modules use descriptive lower-case file names (`room-service.ts`, `session-service.ts`).
- Tests are colocated as `name.test.ts`.
- Type names use PascalCase; functions and values use camelCase.
- Stable error codes are `SCREAMING_SNAKE` strings shared conceptually with the client (`INVALID_COMMAND`, `ACTION_NOT_AVAILABLE`, `VERSION_CONFLICT`, …).

## Forbidden patterns

- Deep-import `packages/game-engine/src/*` from the server instead of the package barrel.
- Open SQLite from transport or Socket handlers.
- Put rule formulas in `RoomService` when they belong in `game-engine`.
- Duplicate protocol unions or Zod schemas inside the server.
