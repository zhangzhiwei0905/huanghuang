# Backend Directory Structure

## Current layout

```text
apps/server/src/             # Transport, persistence, scheduling, process entry
packages/protocol/src/       # Runtime schemas and shared boundary types
packages/game-engine/src/    # Pure rules, settlement, actions and win evaluation
```

## Dependency rules

- `apps/server` may import protocol and game engine.
- `game-engine` may import domain types from protocol but no server, database, clock, Socket, or React code.
- Protocol owns decoding; transport handlers consume parsed values.
- Rules are exported from `packages/game-engine/src/index.ts`; consumers do not deep-import internals.

## Current examples

- `packages/game-engine/src/win.ts` is a pure evaluator.
- `packages/game-engine/src/settlement.ts` owns every score formula.
- `apps/server/src/index.ts` owns process startup and health endpoints.

## Naming

- Domain modules use descriptive lower-case file names.
- Tests are colocated as `name.test.ts`.
- Type names use PascalCase; functions and values use camelCase.
