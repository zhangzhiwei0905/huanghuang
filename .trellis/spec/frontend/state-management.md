# Frontend State Management

## State categories

| Category | Owner | Examples |
|---|---|---|
| Authoritative room state | Typed external store fed by server projections | hand, scores, legal actions, deadline |
| Local UI state | React component state | selected tile, open dialog |
| URL state | Router/search params | invitation room code |
| Preference state | localStorage | theme, mute |

## Contract

The server projection replaces authoritative state by monotonically increasing `version`. Components derive display values from that projection.

```ts
if (update.version === current.version + 1) {
  store.replace(update.projection);
} else if (update.version > current.version + 1) {
  requestFullSnapshot();
}
```

## Wrong vs correct

Wrong: remove a tile immediately after the user clicks discard.

Correct: disable duplicate submission, wait for the command acknowledgement and render the next server projection.

## Tests required

- Older projections never overwrite newer state.
- Missing versions trigger snapshot recovery.
- Theme changes do not reset room state or Socket subscriptions.

## Scenario: Room lifecycle projection

### 1. Scope / Trigger

Any change to room creation, seating, readiness, round continuation, or the UI's active-player indicator must update the shared projection contract instead of inferring lifecycle from nullable game fields.

### 2. Signatures

```ts
type RoomMode = "FRIEND" | "BOT";
type RoomStage = "WAITING" | "PLAYING" | "ROUND_RESULT";

type RoomProjection = {
  mode: RoomMode;
  stage: RoomStage;
  roundId: string | null;
  currentSeat: Seat | null;
  actingSeat: Seat | null;
  lobbySeats: LobbySeatProjection[];
};

POST /api/rooms                 { nickname, baseScore, mode }
POST /api/rooms/:code/ready    {}
POST /api/rooms/:code/continue {}
```

### 3. Contracts

- `FRIEND` rooms use `WAITING → PLAYING → ROUND_RESULT → WAITING`; four occupied seats must all be ready before `PLAYING`.
- `BOT` rooms start in `PLAYING`, reject joins, and remain in `ROUND_RESULT` until the owner calls `/continue` or leaves.
- `currentSeat` preserves the game engine's turn/discarder seat. `actingSeat` is the player currently required to act, including a discard responder. Player highlights and arrows use `actingSeat`; response-tile derivation continues to use `currentSeat`.
- `lobbySeats` is the only waiting-room seat source. Components must not reconstruct seats from `players` or a second waiting-player list.
- Waiting projections have `roundId = null`, `players = []`, no legal actions, and no action deadline.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Create body has no valid `mode` | `400 INVALID_INPUT` |
| Join targets a bot room or an in-progress friend room | `409 ROOM_NOT_JOINABLE` |
| Join targets a full friend waiting room | `409 ROOM_FULL` |
| Ready outside `FRIEND + WAITING` | `409 ACTION_NOT_AVAILABLE` |
| Continue outside owner-controlled `BOT + ROUND_RESULT` | `409 ACTION_NOT_AVAILABLE` |

### 5. Good/Base/Bad Cases

- Good: the fourth unique ready call starts exactly one friend round and the next projection has a new `roundId`.
- Base: one-player friend room stays in `WAITING` with three unoccupied `lobbySeats` and no timer.
- Bad: treating `selfSeat === null` as the waiting signal; seated friend players have a non-null seat while waiting.

### 6. Tests Required

- Service tests assert friend creation has no round/bots, readiness is idempotent, and round result returns to waiting with scores preserved.
- Service tests assert bot rooms reject joins, do not auto-continue, and preserve scores after explicit continuation.
- Projection tests assert `currentSeat` remains the discarder while `actingSeat` identifies the pending responder.
- Frontend/API tests assert create requests include `mode` and bot continuation uses the explicit endpoint.

### 7. Wrong vs Correct

Wrong:

```tsx
<PlayerStation active={room.currentSeat === seat} />
```

This points at the discarder during `DISCARD_RESPONSE` and makes the response player look inactive.

Correct:

```tsx
<PlayerStation active={room.actingSeat === seat} />
```

Keep `currentSeat` unchanged for `pendingResponseTile`, where it intentionally locates the discarder's latest tile.
