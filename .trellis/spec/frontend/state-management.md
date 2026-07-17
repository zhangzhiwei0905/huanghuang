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
  schemaVersion: 4;
  mode: RoomMode;
  stage: RoomStage;
  status: "ACTIVE" | "CLOSED";
  closeReason: "OWNER_DISSOLVED" | "WAITING_TIMEOUT" | "EMPTY_ROOM" | null;
  waitingExpiresAt: string | null;
  roundId: string | null;
  currentSeat: Seat | null;
  actingSeat: Seat | null;
  lobbySeats: LobbySeatProjection[];
};

POST /api/rooms                 { nickname, baseScore, mode }
POST /api/rooms/:code/ready    { ready: boolean }
PATCH /api/rooms/:code/settings { baseScore: 1 | 2 | 5 | 10 }
POST /api/rooms/:code/continue {}

room:chat {
  roomCode: string; // six digits
  message: string; // trimmed, 1..60 characters
}

type ChatMessageProjection = {
  id: string;
  roomId: string;
  senderSeat: Seat;
  nickname: string;
  message: string;
  sentAt: string;
};
```

### 3. Contracts

- `FRIEND` rooms use `WAITING → PLAYING → ROUND_RESULT → WAITING`; four occupied seats must all be ready before `PLAYING`.
- `BOT` rooms start in `PLAYING`, reject joins, and remain in `ROUND_RESULT` until the owner calls `/continue` or leaves.
- `currentSeat` preserves the game engine's turn/discarder seat. `actingSeat` is the player currently required to act, including a discard responder. Player highlights and arrows use `actingSeat`; response-tile derivation continues to use `currentSeat`.
- `lobbySeats` is the only waiting-room seat source. Components must not reconstruct seats from `players` or a second waiting-player list.
- Waiting projections have `roundId = null`, `players = []`, no legal actions, and no action deadline.
- Every `FRIEND + WAITING` projection has a UTC ISO `waitingExpiresAt`; starting a round clears it, and returning from a round creates a fresh three-minute deadline. Join, readiness and base-score changes do not extend it.
- Readiness is an explicit desired state. Repeating `{ ready: true }` or `{ ready: false }` is idempotent; the client must not ask the server to perform an implicit toggle.
- Only the current friend-room owner can change `baseScore`, and only in `WAITING`. A successful change clears every ready state so all four players reconfirm the new score.
- Leaving removes membership immediately. Snapshot reads, Socket subscription, and chat all validate current membership; browser URL state is not proof of membership.
- Owner dissolution sets `status = "CLOSED"` immediately in every stage. Waiting timeout uses `WAITING_TIMEOUT`; an owner leaving an otherwise empty room uses `EMPTY_ROOM`. The client clears room state, chat and the invite query parameter, then maps the authoritative reason to its notice.
- A closed room remains readable for 30 seconds so Socket version notifications can lead to the close projection. After physical eviction, `ROOM_NOT_FOUND` and `NOT_A_MEMBER` also clear stale local room state with a generic closed-room notice.
- Chat is an ephemeral Socket event for `FRIEND + PLAYING`: the server derives sender identity and timestamp, broadcasts to room members, and never increments the room version or writes chat into SQLite.
- The client keeps at most four chat messages, renders them in the action dock outside the table, and removes each one after 5 seconds. CSS may animate only the fade; JavaScript remains responsible for removal under reduced motion.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Create body has no valid `mode` | `400 INVALID_INPUT` |
| Join targets a bot room or an in-progress friend room | `409 ROOM_NOT_JOINABLE` |
| Join targets a full friend waiting room | `409 ROOM_FULL` |
| Ready payload omits a boolean `ready` | `400 INVALID_INPUT` |
| Ready outside `FRIEND + WAITING` | `409 ACTION_NOT_AVAILABLE` |
| Non-owner updates base score | `403 OWNER_ONLY` |
| Owner updates base score outside `FRIEND + WAITING` | `409 ACTION_NOT_AVAILABLE` |
| Snapshot/subscribe/chat sender is not a current member | `403 NOT_A_MEMBER` or Socket `NOT_A_MEMBER` acknowledgement |
| Chat room code, trimmed length, or payload type is invalid | Socket `INVALID_INPUT` acknowledgement |
| Chat is sent outside `FRIEND + PLAYING` | Socket `ACTION_NOT_AVAILABLE` acknowledgement |
| Continue outside owner-controlled `BOT + ROUND_RESULT` | `409 ACTION_NOT_AVAILABLE` |
| Friend waiting deadline is reached | Closed projection with `WAITING_TIMEOUT`; later reads return `404 ROOM_NOT_FOUND` after eviction |
| Owner leaves with another human present | Transfer ownership; keep the original waiting deadline |
| Owner leaves with no other human present | Closed projection with `EMPTY_ROOM` |

### 5. Good/Base/Bad Cases

- Good: the fourth unique ready call starts exactly one friend round and the next projection has a new `roundId`.
- Good: a current member sends a 60-character-or-shorter message during a friend round; all room subscribers receive server-derived identity, and no room version changes.
- Base: one-player friend room stays in `WAITING` with three unoccupied `lobbySeats` and a server-owned three-minute deadline.
- Base: sending the same desired ready state or selecting the current base score returns the current projection without duplicating a transition.
- Bad: treating `selfSeat === null` as the waiting signal; seated friend players have a non-null seat while waiting.
- Bad: persisting chat in the room snapshot or trusting client-provided nickname/seat; this leaks transient data and permits identity spoofing.
- Bad: resetting `waitingExpiresAt` whenever somebody joins or toggles ready; a room could then be kept alive forever without starting.

### 6. Tests Required

- Service tests assert friend creation has no round/bots, readiness is idempotent, and round result returns to waiting with scores preserved.
- Service tests assert ready cancellation prevents launch, only the current owner can update base score, and a score change clears readiness.
- Service tests assert leaving removes membership, transfers ownership to an in-room human, and re-entry succeeds only through join.
- Service tests assert owner dissolution is immediate in waiting and playing stages and projects `OWNER_DISSOLVED`.
- Boundary tests assert the room is active at `waitingExpiresAt - 1`, closes at the deadline, and is absent from both memory and SQLite after the notification window.
- Service tests assert starting before the deadline does not close the active round, returning to waiting creates a new deadline, and sole-owner leave projects `EMPTY_ROOM`.
- Protocol/service tests reject blank, over-60-character, non-member, and wrong-stage chat while preserving server-derived sender fields.
- Service tests assert bot rooms reject joins, do not auto-continue, and preserve scores after explicit continuation.
- Projection tests assert `currentSeat` remains the discarder while `actingSeat` identifies the pending responder.
- Frontend/API tests assert create requests include `mode`, readiness sends the desired boolean, settings use `PATCH`, and bot continuation uses the explicit endpoint.
- Browser checks cover desktop and phone landscape geometry, dissolve notice, owner settings, ready cancellation, and chat fade/removal after 5 seconds.

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

Wrong:

```ts
socket.emit("room:chat", { roomCode, nickname, senderSeat, message });
room.messages.push(message);
save(room);
```

This trusts spoofable identity and turns a five-second UI event into durable room state.

Correct:

```ts
const parsed = chatMessageInputSchema.safeParse(input);
if (!parsed.success) return acknowledge({ accepted: false, errorCode: "INVALID_INPUT" });
const message = roomService.createChatMessage(sessionId, parsed.data.roomCode, parsed.data.message);
if (typeof message === "string" || message === null) {
  return acknowledge({ accepted: false, errorCode: message ?? "ROOM_NOT_FOUND" });
}
io.to(message.roomId).emit("room:chat", message);
```

The service resolves the current member seat and nickname. The frontend owns the five-second queue and never writes chat back into the authoritative projection.

Wrong:

```ts
room.waitingExpiresAt = new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString();
room.readySessionIds = toggleReady(room.readySessionIds, sessionId);
```

This silently extends room lifetime on every interaction.

Correct:

```ts
function enterWaiting(room: RoomState, now: number): void {
  room.stage = "WAITING";
  room.waitingExpiresAt = new Date(now + WAITING_ROOM_TIMEOUT_MS).toISOString();
}
```

Only lifecycle entry creates the deadline; UI timers merely display it.
