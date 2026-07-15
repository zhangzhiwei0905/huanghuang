# Backend Quality Guidelines

## Required checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pure game modules require positive, negative, and boundary tests. Settlement functions assert zero-sum output. Randomness and time must be injected into the engine.

## Scenario: Authoritative game command boundary

### 1. Scope / Trigger

Any new browser-to-server game action or change to its payload triggers this contract.

### 2. Signatures

```ts
type CommandEnvelope = {
  type: CommandType;
  requestId: string;
  roomId: string;
  roundId: string | null;
  expectedVersion: number;
  payload: Record<string, unknown>;
};
```

The actual runtime schema is `commandEnvelopeSchema` in `packages/protocol/src/commands.ts`.

### 3. Contracts

- Validate untrusted values once with the shared Zod schema.
- The client sends intent, never score, win type, wall order, or draw result.
- Accepted commands advance the room version exactly once.
- Environment baseline: `PORT` defaults to 3000; later storage code owns `DATABASE_PATH`.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Invalid schema | `INVALID_COMMAND` |
| Unknown room/member | `ROOM_NOT_FOUND` or `NOT_A_MEMBER` |
| Stale expected version | `VERSION_CONFLICT` plus current version |
| Repeated request ID | Return the stored first result |
| Illegal phase/tile | `ILLEGAL_ACTION`, state unchanged |

### 5. Good/Base/Bad Cases

- Good: parsed command, current version, legal physical tile ID.
- Base: a health request returns a small object and does not touch game state.
- Bad: client declares `HARD` or sends a multiplier; schema rejects it.

### 6. Tests Required

- Decoder rejects every unknown or malformed required field.
- Duplicate request ID produces one state transition.
- Old expected version cannot mutate state.
- Projection after a command contains no opponent concealed tiles.

### 7. Wrong vs Correct

Wrong: a Socket handler calculates a self-draw payment.

Correct: the handler validates and calls `calculateSelfDrawSettlement` through the authoritative command service.

## Forbidden patterns

- Rule branches in routes or Socket listeners.
- Mutating state before persistence commits.
- `Math.random()` inside replayable domain logic.
- Catching an error and returning success.
