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
type RoomMode = "FRIEND" | "BOT" | "MATCH";
type RoomStage = "WAITING" | "PLAYING" | "ROUND_RESULT";

type RoomProjection = {
  schemaVersion: 9;
  mode: RoomMode;
  competitiveMatch: { matchId: string; ruleVersion: number } | null;
  stage: RoomStage;
  scoreResetPending: boolean;
  status: "ACTIVE" | "CLOSED";
  closeReason: "OWNER_DISSOLVED" | "WAITING_TIMEOUT" | "EMPTY_ROOM" | "MATCH_SETTLED" | null;
  waitingExpiresAt: string | null;
  roundId: string | null;
  currentSeat: Seat | null;
  actingSeat: Seat | null;
  effectCue: GameEffectCue | null;
  tingHints: DiscardTingProjection[];
  lobbySeats: LobbySeatProjection[];
  botDifficulty: "LOW" | "HIGH";
  selfRole: "PLAYER" | "SPECTATOR";
  spectators: SpectatorProjection[];
};

type TurnTimeoutSeconds = 20 | 25 | 30;

POST /api/rooms                 { nickname, baseScore, mode, turnTimeoutSeconds, botDifficulty }
POST /api/rooms/:code/ready    { ready: boolean }
PATCH /api/rooms/:code/settings { baseScore?: 1 | 2 | 5 | 10, botDifficulty?: "LOW" | "HIGH" }
POST /api/rooms/:code/bots     {}
DELETE /api/rooms/:code/bots/:seat
POST /api/rooms/:code/continue {}

room:chat {
  roomCode: string; // new four-digit code or active legacy six-digit code
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

- `FRIEND` rooms use `WAITING → PLAYING → ROUND_RESULT → WAITING`; all four
  seats must be occupied and every seated human must be ready before `PLAYING`.
  Bots are always ready and every human ready state is cleared between rounds.
- In `FRIEND + WAITING`, a joining human fills an empty seat first and otherwise
  replaces a bot. During `PLAYING` or `ROUND_RESULT`, a joining human becomes a
  private-hand-safe spectator only when a bot can be replaced and the combined
  seated/spectating human count is below four. At the next waiting transition,
  spectators replace bots in FIFO order.
- Spectators are room members for snapshot and Socket subscription purposes,
  but have `selfSeat = null`, receive `hand = null` for all four players, have
  no legal actions, and cannot send game commands or table chat.
- `BOT` rooms start in `PLAYING`, reject joins, and remain in `ROUND_RESULT` until the owner calls `/continue` or leaves.
- `MATCH` rooms are four-human, server-created, fixed-rule single rounds. They skip lobby/ready, hide friend controls, keep an exiting player's seat under trustee control, and expose only the requesting player's protection/rank transition at settlement.
- Mini-program matchmaking state is server-owned. The home page polls status serially once per second while queued; a `MATCHED` response opens only its included member projection. A local trustee marker suppresses forced table reopen after deliberate exit, but a later `ROUND_RESULT` still reopens the authoritative settlement.
- Continue matchmaking sends `previousMatchId`; the server acknowledges the old result and enqueues atomically. Return-to-lobby acknowledges without enqueuing. The client never creates those intermediate states locally.
- Public player profiles contain rank display and five achievement totals only (`releaseWildcard`, `exposedKong`, `indicatorPongKong`, `addedKong`, `concealedKong` — `releaseWildcard` displays first since it's the core game mechanic). Protection cards are self-only settlement data; openid/token/session identifiers never enter room projections.
- `currentSeat` preserves the game engine's turn/discarder seat. `actingSeat` is the player currently required to act, including a discard responder. Player highlights and arrows use `actingSeat`; response-tile derivation continues to use `currentSeat`.
- `lobbySeats` is the only waiting-room seat source. Components must not reconstruct seats from `players` or a second waiting-player list.
- `scoreResetPending` is the only signal that the next round will zero cumulative
  scores. Clients render a waiting-room notice from it and must not infer the
  reset by comparing seat controllers or `lobbySeats[].score`.
- `roundSettlement.laiyou` and `roundOutcome.laiyou` are the only laiyou signals.
  Clients must not infer 来由 from `releasedWildcards` or multiplier arithmetic.
  Web derives the win-type wording through a single `winTypeLabel` helper in
  `apps/web/src/components/GameTable.tsx`, shared by the turn marker and the
  settlement modal, so the 硬来由 / 软来由 wording is not duplicated.
- Audio lives only in the mini-program; `apps/web` has no audio layer. Do not add
  sound to the web client as part of a gameplay feature without deciding that
  separately.
- Waiting projections have `roundId = null`, `players = []`, no legal actions, and no action deadline.
- Every `FRIEND + WAITING` projection has a UTC ISO `waitingExpiresAt`; starting a round clears it, and returning from a round creates a fresh three-minute deadline. Join, readiness and base-score changes do not extend it.
- Readiness is an explicit desired state. Repeating `{ ready: true }` or `{ ready: false }` is idempotent; the client must not ask the server to perform an implicit toggle.
- Only the current friend-room owner can change `baseScore` or
  `botDifficulty`, add bots, or remove bots, and only in `WAITING`. Every
  successful setting or bot-seat change clears human readiness.
- `LOW` difficulty bots declare only `HARD` wins; `HIGH` difficulty bots may
  declare `HARD` or `SOFT` wins. The room setting applies to BOT matches and
  friend-room bots, but never changes trustee behavior for disconnected humans.
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
- `effectCue` is a room-wide, server-timed presentation phase. While it is
  non-null, `actingSeat`, `actionDeadlineAt` and `legalActions` are cleared;
  clients render the cue but must not infer or expose the already-accepted
  pending round state.
- The client keeps at most four chat messages, derives the latest active message per `senderSeat`, renders it as a bubble beside that player's avatar, and removes each message after about 3 seconds. CSS owns only the fade; JavaScript remains responsible for removal under reduced motion. The chat input remains centered in the bottom action dock and must not overlap the hand or auxiliary actions.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Create body has no valid `mode` | `400 INVALID_INPUT` |
| Create body has a timeout other than 20, 25 or 30 | `400 INVALID_INPUT` |
| Join targets a bot room | `409 ROOM_NOT_JOINABLE` |
| Join targets a full waiting room, four-human active room, or active room with no replaceable bot | `409 ROOM_FULL` |
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
- Good: an in-round spectator sees all four public areas but no private hand,
  then replaces the earliest bot at the next waiting transition and must ready.
- Good: a current member sends a 60-character-or-shorter message during a friend round; all room subscribers receive server-derived identity, and no room version changes.
- Base: one-player friend room stays in `WAITING` with three unoccupied `lobbySeats` and a server-owned three-minute deadline.
- Base: sending the same desired ready state or selecting the current base score returns the current projection without duplicating a transition.
- Bad: treating `selfSeat === null` as the waiting signal; seated friend players have a non-null seat while waiting.
- Bad: rendering `selfSeat === null` as a rejected-room screen; it is the
  intentional spectator role during an active friend round.
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

## Scenario: Private social snapshot refresh

### 1. Scope / Trigger

Changes to mini-program friends, presence, player search or room invitations
must keep the social snapshot server-owned and private to the authenticated
session.

### 2. Signatures

```ts
type SocialController = {
  snapshot: SocialSnapshot | null;
  refresh(): Promise<void>;
  search(playerId: string): Promise<PlayerSearchResult | null>;
  sendRequest(playerId: string): Promise<void>;
  invite(roomCode: string, playerId: string): Promise<void>;
};
```

REST owns mutations and full snapshots. Socket `social:update` carries only a
refresh hint on `session:<sessionId>`.

### 3. Contracts

- `useSocial(enabled)` has at most one refresh in flight and one authenticated
  Socket; cleanup disconnects it and ignores late responses.
- Presence, request and invitation events never broadcast a full friend list.
- A mutation returns an authoritative snapshot when available; otherwise the
  private Socket hint triggers a serialized refresh.
- Friend requests and room invites remain visible after relaunch until acted
  upon or expired by the server.
- `playerId` is display/search identity, while `sessionId` stays private.

### 4. Validation & Error Matrix

| Condition | UI result |
| --- | --- |
| Social snapshot loading | Stable loading state, no fake empty list |
| Unknown four-digit ID | `PLAYER_NOT_FOUND` copy |
| Duplicate outgoing request | Existing pending state, no duplicate row |
| Incoming request already exists | Offer accept rather than another request |
| Friend offline | Disable room invite |
| Invitation expires or room fills | Remove after refresh and surface invalid if tapped |

### 5. Good/Base/Bad Cases

- Good: one `social:update` after presence change refreshes the list and moves
  the online friend first.
- Base: reopening the home page restores pending requests from SQLite.
- Bad: store friendship or invitation acceptance only in React state.

### 6. Tests Required

- Service tests for request lifecycle, online projection and invite expiry.
- Hook/pure-helper tests when refresh coalescing or relationship branching
  changes.
- Mini-program typecheck and production `build:weapp` after any social UI
  contract change.

### 7. Wrong vs Correct

Wrong:

```ts
socket.on("friend:list", (friends) => setFriends(friends));
```

Correct:

```ts
socket.on("social:update", () => void refresh());
```

The authenticated REST snapshot remains the single projection boundary.

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
