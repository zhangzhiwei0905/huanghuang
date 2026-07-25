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
  schemaVersion: 5;
  mode: RoomMode;
  stage: RoomStage;
  status: "ACTIVE" | "CLOSED";
  closeReason: "OWNER_DISSOLVED" | "WAITING_TIMEOUT" | "EMPTY_ROOM" | null;
  waitingExpiresAt: string | null;
  roundId: string | null;
  currentSeat: Seat | null;
  actingSeat: Seat | null;
  tingHints: DiscardTingProjection[];
  lobbySeats: LobbySeatProjection[];
};

type TurnTimeoutSeconds = 20 | 25 | 30;

POST /api/rooms                 { nickname, baseScore, mode, turnTimeoutSeconds }
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
- Room creation accepts `turnTimeoutSeconds` as `20 | 25 | 30`; legacy
  requests that omit it default to 20. The value is projected back to every
  member and remains fixed for the lifetime of the room.
- `turnTimeoutSeconds` controls human `TURN_DECISION` deadlines only. Response
  windows and bot delays remain server-owned constants.
- Leaving removes membership immediately. Snapshot reads, Socket subscription, and chat all validate current membership; browser URL state is not proof of membership.
- Owner dissolution sets `status = "CLOSED"` immediately in every stage. Waiting timeout uses `WAITING_TIMEOUT`; an owner leaving an otherwise empty room uses `EMPTY_ROOM`. The client clears room state, chat and the invite query parameter, then maps the authoritative reason to its notice.
- A closed room remains readable for 30 seconds so Socket version notifications can lead to the close projection. After physical eviction, `ROOM_NOT_FOUND` and `NOT_A_MEMBER` also clear stale local room state with a generic closed-room notice.
- Chat is an ephemeral Socket event for `FRIEND + PLAYING`: the server derives sender identity and timestamp, broadcasts to room members, and never increments the room version or writes chat into SQLite.
- `tingHints` is an ephemeral, member-specific projection for the current legal discarder. It is empty for every other member and outside `PLAYING + TURN_DECISION`; the client renders it and never recalculates win type, multiplier or remaining copies.
- The client keeps at most four chat messages, derives the latest active message per `senderSeat`, renders it as a bubble beside that player's avatar, and removes each message after about 3 seconds. CSS owns only the fade; JavaScript remains responsible for removal under reduced motion. The chat input remains centered in the bottom action dock and must not overlap the hand or auxiliary actions.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Create body has no valid `mode` | `400 INVALID_INPUT` |
| Create body has a timeout other than 20, 25 or 30 | `400 INVALID_INPUT` |
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
- Frontend/API tests assert mini-program create requests include `mode` and
  `turnTimeoutSeconds`, readiness sends the desired boolean, settings use
  `PATCH`, and bot continuation uses the explicit endpoint.
- Browser checks cover desktop and phone landscape geometry, dissolve notice, owner settings, ready cancellation, and avatar-adjacent chat fade/removal after about 3 seconds.

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

This trusts spoofable identity and turns a three-second UI event into durable room state.

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

The service resolves the current member seat and nickname. The frontend owns the three-second queue and never writes chat back into the authoritative projection.

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

## Scenario: End-of-round final hand projection

### 1. Scope / Trigger

Any settlement UI that shows all players' concealed tiles must use an authoritative, end-of-round-only projection. It must not weaken the normal per-player hand privacy contract.

### 2. Signatures

```ts
type RoundSettlementProjection = {
  // existing settlement fields
  finalHands: {
    seat: Seat;
    tiles: Tile[];
    personalMultiplier: PersonalMultiplier;
  }[];
};
```

### 3. Contracts

- `RoomService.project` populates `finalHands` only when the round has an outcome and `roundSettlement` is non-null.
- The array contains exactly one entry for every seat in canonical seat order.
- Tiles and personal multipliers come from the authoritative round state; the browser never reconstructs a final hand from counts, discards, or melds.
- `players[selfSeat].hand` still contains the current member's hand, while every opponent `players[*].hand` remains `null`, including in `ROUND_RESULT`.
- The settlement modal reuses `MahjongTile` so final hands have the same SVG artwork and wildcard identity as the table.
- This is an additive projection field; commands, chat events, persistence and scoring formulas are unchanged.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `roundSettlement === null` | No final hands are exposed through a settlement object |
| Active or waiting projection | Opponent `PlayerProjection.hand` remains `null` |
| Round reaches win or draw | Emit four authoritative `finalHands` entries |
| A settlement entry has no matching score change | UI displays a zero fallback and does not calculate a score |
| Wildcard appears in a final hand | Render the normal SVG tile with the existing wildcard badge |

### 5. Good/Base/Bad Cases

- Good: a self-draw settlement shows four SVG hands, each player's personal multiplier, signed round delta and cumulative score.
- Base: a draw still shows all final hands and preserves any already-produced kong score changes.
- Bad: filling opponent `players[*].hand` to make the modal easier to render; this leaks concealed state outside the dedicated settlement contract.

### 6. Tests Required

- Service tests assert `finalHands` equals every authoritative round hand and multiplier after settlement.
- The same service test asserts the requesting player's hand is present and all opponent `players[*].hand` values remain `null`.
- A component rendering test asserts four settlement hand rows reuse SVG tile artwork and display positive/negative deltas.
- Full lint, type-check, tests and production build must pass after producer or consumer changes.

### 7. Wrong vs Correct

Wrong:

```ts
return {
  players: round.players.map((player) => ({ ...player, hand: player.hand })),
};
```

This publishes every concealed hand as general room state.

Correct:

```ts
return {
  players: projectPlayersForMember(round, sessionId),
  roundSettlement: round.outcome === null
    ? null
    : {
        ...projectSettlement(round),
        finalHands: SEATS.map((seat) => ({
          seat,
          tiles: round.players[seat].hand,
          personalMultiplier: round.players[seat].personalMultiplier,
        })),
      },
};
```

The dedicated settlement field is available only after the authoritative round outcome exists, while general player projection privacy stays intact.
