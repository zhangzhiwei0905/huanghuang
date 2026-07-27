# Backend Quality Guidelines

## Required checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pure game modules require positive, negative, and boundary tests. Settlement functions assert zero-sum output. Randomness and time must be injected into the engine.

## Room turn-duration configuration

- `packages/protocol/src/commands.ts` owns the only allowed values:
  `20 | 25 | 30`, with 20 as the compatibility default.
- `RoomState.turnTimeoutSeconds` is persisted in the existing room JSON
  snapshot and projected to clients. Snapshot normalization defaults legacy
  rows that lack the field to 20.
- `RoomService.refreshDeadline` applies the configured duration only to human
  `TURN_DECISION`. Keep the 5-second discard-response window and bot delay
  independent.
- Protocol tests reject unsupported values; service tests assert a configured
  human room creates the matching deadline.

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

## Scenario: Restricted-view balanced bot decisions

### 1. Scope / Trigger

Any change to bot discard, response, wildcard, kong or win decisions must preserve hidden-state privacy and reducer authority.

### 2. Signatures

```ts
type BotDecisionView = {
  seat: Seat;
  phase: "TURN_DECISION" | "DISCARD_RESPONSE";
  legalActions: readonly string[];
  hand: Tile[];
  melds: Meld[];
  releasedWildcards: Tile[];
  wildcardKind: TileKind;
  indicatorTile: Tile;
  wallRemaining: number;
  pendingDiscard: Tile | null;
  publicPlayers: readonly BotPublicPlayer[];
};

chooseBotAction(view: BotDecisionView, randomInt: RandomInt): BotAction | null;
```

### 3. Contracts

- `BotDecisionView` contains the acting bot's concealed hand and public table information only. It must not contain `RoundState`, opponent hands or wall tile order.
- The strategy returns an intent. `RoomService` executes that intent through existing `round.ts` reducers; the strategy never mutates authoritative state or calculates score.
- Discard ranking preserves completed groups, pairs and incomplete runs and weights improvements by unseen physical copies. Equal candidates use injected randomness.
- A legal win takes priority; two or more held wildcards trigger release before discard; legal kong value is normally taken; pong may pass when opening the hand worsens its structure.
- `BOT` uses the balanced strategy. `TRUSTEE` and human timeout automation remain conservative: response pass, legal win, excess-wildcard release, then legal discard.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Strategy returns a reducer-valid intent | Apply exactly one authoritative transition |
| Strategy returns `null` | Do not mutate state; report `ACTION_NOT_AVAILABLE` internally |
| TRUSTEE receives a pong/kong response | Pass instead of using bot claim logic |
| Candidate discard is a wildcard | Exclude it through `discardableTileIds` |
| Equal-ranked physical tiles | Select with injected `RandomInt` |

### 5. Good/Base/Bad Cases

- Good: a newly drawn tile completes a useful run, so the bot discards an isolated tile instead of returning the draw.
- Base: a disconnected human times out during a pong response and passes without changing their hand.
- Bad: passing `round.players` or `round.wall` to the strategy; this enables hidden-state cheating and couples strategy to persistence state.

### 6. Tests Required

- Pure tests cover useful drawn tiles, isolated candidates, physical-tile tie breaking, excess wildcard release, pong/pass and kong claims.
- Fixed-seed simulations execute every intent through real reducers, terminate every round and include at least one bot win in the stable batch.
- Service tests prove BOT/TRUSTEE separation and preserve room version/persistence behavior.
- Type-check the restricted view so no opponent hand or wall order field can be consumed accidentally.

### 7. Wrong vs Correct

Wrong:

```ts
function chooseBotAction(round: RoundState, seat: Seat) {
  return inspectEveryHandAndWall(round);
}
```

Correct:

```ts
const action = chooseBotAction(projectBotDecisionView(round, seat), randomInt);
return executeThroughRoundReducer(round, seat, action);
```

## Scenario: Kong transfers and personal multipliers

### 1. Scope / Trigger

Any change to wildcard release, meld reducers, self-draw settlement or end-of-round score projection must preserve the independent multiplier and kong ledgers.

### 2. Signatures

```ts
calculateSelfDrawSettlement({ baseScore, winnerSeat, winType, personalMultipliers }): ScoreDelta[];
calculateKongSettlement({ baseScore, actorSeat, kind, sourceSeat }): ScoreDelta[];
```

### 3. Contracts

- Every round initializes each `personalMultiplier` to `1`; only successful `releaseWildcard` multiplies it by two.
- Pong and every kong action leave all personal multipliers unchanged.
- Exposed and indicator pong-kongs charge the source seat `3 × baseScore`; concealed kong charges every opponent `2 × baseScore`; added kong charges every opponent `1 × baseScore`.
- Kong transfers apply immediately, remain after a draw and never multiply by either player's personal multiplier.
- Self-draw payment remains `baseScore × hard/soft factor × winner multiplier × payer multiplier`.
- End-of-round `roundDelta` is current score minus starting score, so it combines earlier kong transfers and final self-draw transfers. `payments` contains only the final self-draw payer deltas.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Discard-triggered kong has no/different invalid source | Throw an internal invariant error |
| Any settlement delta sum is nonzero | Throw through `assertZeroSum` |
| Round ends in draw after kong | Project no self-draw payments and retain kong round deltas |
| New round starts | Preserve cumulative score and reset personal multipliers to `1` |

### 5. Good/Base/Bad Cases

- Good: an added kong earns three base-score payments, then a later self-draw adds independently calculated payer amounts.
- Base: ordinary pong changes only meld/hand state.
- Bad: treating a kong as another multiplier or multiplying its transfer by released-wildcard counts.

### 6. Tests Required

- Exact payer/amount tests cover exposed, indicator, concealed and added kong and assert zero sum.
- Round tests assert multiplier invariants for pong/all kong kinds, wildcard doubling and new-round reset.
- Service projection tests cover kong-then-win and kong-then-draw net score changes.

### 7. Wrong vs Correct

Wrong:

```ts
player.personalMultiplier *= kongMultiplier;
```

Correct:

```ts
applyScoreDeltas(state, calculateKongSettlement({ baseScore, actorSeat, kind, sourceSeat }));
```

## Forbidden patterns

- Rule branches in routes or Socket listeners.
- Mutating state before persistence commits.
- `Math.random()` inside replayable domain logic.
- Passing opponent concealed hands or wall order into bot strategy code.
- Changing `personalMultiplier` from pong or kong reducers.
- Catching an error and returning success.

## Scenario: Authoritative effect-paced transitions

### 1. Scope / Trigger

Any accepted rule result that creates a pong, kong, added kong, released
wildcard or win must publish a room-wide effect phase before exposing the
resulting round. This is a cross-layer protocol and persisted-room contract,
not a client-only delay.

### 2. Signatures

```ts
type GameEffectAction = MeldKind | "RELEASE_WILDCARD" | "WIN";

type GameEffectCue = {
  id: string;
  action: GameEffectAction;
  actorSeat: Seat;
  tileKind: TileKind | null;
  winType: WinType | null;
  startedAt: string;
  endsAt: string;
};

type PendingEffectTransition = {
  cue: GameEffectCue;
  nextRound: RoundState;
};

type RoomProjection = {
  schemaVersion: 7;
  effectCue: GameEffectCue | null;
};
```

There is no new HTTP route, command payload or environment key. Existing game
commands can schedule a cue; `RoomService.tick(now)` is the only completion
entry point.

### 3. Contracts

- The game engine still returns one complete `RuleResult`. `RoomService`
  compares the current and accepted rounds, then either applies a non-effect
  result immediately or persists `{ old round, cue, nextRound }`.
- Durations are server-owned: pong 2000 ms; exposed, concealed and indicator
  kong 2200 ms; added kong 2300 ms; wildcard release 2500 ms; win 2800 ms.
- Cue identity, actor, tile and win type come from the accepted round delta,
  never from the command payload.
- Scheduling and completion each increment room version once. The accepted
  command result and pending transition snapshot are committed together by
  `saveRoomAndProcessedRequest`.
- While pending, projections keep the old public round and expose the cue with
  `legalActions = []`, `actingSeat = null` and `actionDeadlineAt = null`.
  The private `nextRound` is never projected.
- `tick(now < endsAt)` does nothing. The first `tick(now >= endsAt)` replaces
  the live round, clears the transition, refreshes the real next deadline,
  persists and broadcasts. Later ticks cannot apply it again.
- Startup restores an active transition. Bot, trustee and human command paths
  cannot advance it early. Lifecycle paths that discard/end the active round
  clear irrelevant pending state.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| New command has correct current version while a cue is pending | `ACTION_NOT_AVAILABLE` |
| Repeated already-processed request | Return stored `CommandResult`; do not schedule again |
| Accepted result contains no paced delta | Apply immediately; `effectCue: null` |
| Accepted result contains more than one paced delta | Throw invariant error; do not silently drop an effect |
| Tick is one millisecond before `endsAt` | Keep old round and cue |
| Tick reaches/passes `endsAt` | Apply once, clear cue, increment version |
| Legacy room snapshot lacks the pending field | Normalize to `null` |
| Restart restores an expired transition | First tick applies it once |

### 5. Good/Base/Bad Cases

- Good: a kong cue is visible to every member while the replacement tile
  remains private pending state; the draw and next action deadline appear only
  after cue completion.
- Good: a win cue projects no settlement, then the completion version exposes
  the already-calculated settlement.
- Base: discard and pass transitions still apply immediately because they have
  no supplied effect.
- Bad: applying `nextRound` immediately and asking each client to hide it for
  2.2 seconds; reconnects and bots would observe different authoritative
  states.
- Bad: using a client timer to send a “finish animation” command; a disconnected
  actor could stall the whole room.

### 6. Tests Required

- Service tests cover every action-to-cue mapping and exact duration.
- Boundary assertions compare the public old state at `endsAt - 1` with the
  applied next state at `endsAt`, including replacement draws/next actor.
- Win tests assert `roundSettlement === null` during the cue and authoritative
  settlement after completion.
- Pending-phase tests assert empty actions/actor/deadline, command rejection,
  no bot/trustee advance and stable cue ID across unrelated room updates.
- Persistence tests restart `RoomService` on the same database and assert no
  loss, early application or duplicate application.
- Deduplication tests repeat the accepted request and assert the room/cue
  version does not change.

### 7. Wrong vs Correct

Wrong:

```ts
room.round = result.state;
setTimeout(() => broadcastSettlement(room), 2_800);
```

Correct:

```ts
room.pendingEffectTransition = {
  cue: createEffectCue(descriptor, now),
  nextRound: result.state,
};
// tick() later applies nextRound and starts the next authoritative deadline.
```

## Scenario: Member-specific discard ting guidance

### 1. Scope / Trigger

Any feature that marks which physical hand tile can be discarded to enter ting, or displays
winning-tile type/multiplier/remaining copies, must use the engine analysis and the member-specific
room projection. Frontends must not duplicate `evaluateWin`.

### 2. Signatures

```ts
analyzeDiscardTingOptions({
  concealedTiles,
  melds,
  wildcardKind,
}): {
  discardTileId: string;
  waits: { tileKind: TileKind; winType: WinType }[];
}[];

type DiscardTingProjection = {
  discardTileId: string;
  waits: {
    tileKind: TileKind;
    winType: WinType;
    multiplier: number;
    remainingCount: number;
  }[];
};

type RoomProjection = {
  schemaVersion: 7;
  tingHints: DiscardTingProjection[];
};
```

### 3. Contracts

- `packages/game-engine/src/ting.ts` removes one non-wildcard physical tile ID, enumerates the 27
  tile kinds, and calls the existing `evaluateWin` for every simulated winning tile.
- The engine output contains rule results only. It does not know projections, hidden/public state,
  remaining copies or display multipliers.
- `RoomService.project` emits non-empty `tingHints` only to the current member during
  `PLAYING + TURN_DECISION` when `DISCARD_TILE` is legal. Every other projection emits `[]`.
- `discardTileId` preserves physical identity so duplicate face tiles can each be marked and selected.
- The projected multiplier is `(HARD ? 2 : 1) * currentPlayer.personalMultiplier`; payer
  multipliers are not included.
- Remaining copies are public-information upper bounds: start at four, then subtract the current
  member's hand, the indicator, every discard, released wildcard and public meld tile.
- Public tiles are deduplicated by physical tile ID before counting because a claimed discard can
  still appear in the source discard list and in a meld's `tileIds`.
- Remaining-count code must not read `round.wall` or opponent concealed hands. A zero count remains
  in the wait list.
- If the post-discard hand already contains a wildcard, the wildcard kind is not a wait candidate.
  Otherwise the wildcard kind is evaluated through the same win rule and can be projected.

### 4. Validation & Error Matrix

| Condition | Required projection |
|---|---|
| Waiting, settlement or discard-response phase | `tingHints: []` |
| Requesting member is not the current discarder | `tingHints: []` |
| A physical discard produces no legal wait | Omit that discard from projected `tingHints` |
| A wait has four publicly visible copies | Keep the wait with `remainingCount: 0` |
| Hidden wall/opponent hand changes but public state does not | Projection remains identical |
| Post-discard hand already holds a wildcard | No wildcard-kind wait |

### 5. Good/Base/Bad Cases

- Good: two identical physical tiles both carry the same waits under different `discardTileId`
  values, and selecting either one uses the existing second-tap discard interaction.
- Base: a hand with no ting-producing discard receives an empty list and renders no guide chrome.
- Bad: sending exact wall counts, subtracting opponent hands, or importing the game engine into a
  frontend to recompute waits.

### 6. Tests Required

- Engine tests cover hard/soft waits, duplicate physical discards, wildcard inclusion/exclusion,
  non-ting discards and the shorter concealed hand after pong.
- Service tests assert combined multipliers, public counts, physical-ID deduplication, zero-copy
  retention and empty projections for non-acting members.
- A privacy regression mutates wall order and opponent concealed kinds while leaving public state
  unchanged, then asserts `tingHints` remains equal.
- Frontend helper tests assert only non-empty discard hints are indexed and edge/center card anchors
  remain inside the hand rail.

### 7. Wrong vs Correct

Wrong:

```ts
const waits = calculateWinTypesInMiniProgram(room.players[room.selfSeat].hand);
const remaining = round.wall.filter((tile) => sameKind(tile, wait)).length;
```

Correct:

```ts
const hints = analyzeDiscardTingOptions({
  concealedTiles: player.hand,
  melds: player.melds,
  wildcardKind: round.wildcardKind,
});

return projectPublicTingHints(hints, publicVisibleTileCounts);
```

## Scenario: Bot-to-human cumulative score reset

### 1. Scope / Trigger

A `FRIEND` room fills empty seats with bots (`addBot`) and plays practice rounds.
Humans that join mid-round become spectators and replace bots at the next
waiting transition. Once all four seats are human and the round starts, the
cumulative totals earned while a bot was seated must be discarded.

### 2. Signatures

```ts
type RoomState = {
  scores: Record<Seat, number>;
  scoresIncludeBotRounds: boolean;
};

type PersistedRoomState = {
  scoresIncludeBotRounds?: boolean;
};

type RoomProjection = {
  schemaVersion: 7;
  scoreResetPending: boolean;
};
```

No new HTTP route, command payload or environment key.

### 3. Contracts

- `RoomService.startRound` is the single choke point. It is the only place a
  round receives `startingScores`, so the reset and the flag update both live
  there instead of in a command handler. Do not add the reset to `setReady`,
  `continueBotRound` or `createRoom` — they all reach `startRound`.
- Reset condition: all four seat controllers are `HUMAN` **and**
  `scoresIncludeBotRounds` is true. The flag is then recomputed as
  `!allHuman`, which makes the reset one-shot: later all-human rounds keep
  accumulating.
- The flag is evaluated at round **start**. A human who leaves mid-session is
  replaced by `botSeat()`, so the next round is a bot round and a later
  full-human table will reset. That is intentional under the "reset from zero"
  rule; changing it requires distinguishing `addBot` from leave-substitution.
- `scoreResetPending = scoresIncludeBotRounds && allHuman`. Because no path
  turns a bot-started round all-human mid-round, it is only ever true in
  `WAITING`.
- Snapshots written before the field infer it from seats: a table currently
  seating a bot is treated as carrying bot-era totals; an all-human table is
  not, so real players never lose totals they already earned. All three
  `normalizeRoom` return branches must set the field.

### 4. Validation & Error Matrix

| Condition | Required behaviour |
|---|---|
| Bot round played, then four humans ready | `scores` and `startingScores` all zero |
| Consecutive all-human rounds | `startingScores` equals previous cumulative totals |
| `BOT` mode `continueBotRound` | Cumulative totals preserved, flag stays true |
| Legacy snapshot with a bot seat and no flag | Flag inferred true, `scores` preserved |
| Legacy all-human snapshot with no flag | Flag inferred false, `scores` preserved |

### 5. Good/Base/Bad Cases

- Good: three spectators replace three bots at the waiting transition, everyone
  readies, and the new round starts every seat at zero.
- Base: a room that never seated a bot readies four humans and keeps totals.
- Bad: zeroing scores in `enterWaiting` (a seat can turn back into a bot before
  the round starts), or letting the client zero `lobbySeats[].score` locally.

### 6. Tests Required

- Service test drives the full path: `addBot` ×3, ready, finish the round,
  spectators join, `tick` into waiting, ready all four, assert zeroed
  `scores` / `startingScores` and `scoreResetPending` back to false.
- Service test asserts two consecutive all-human rounds keep cumulative totals.
- Persistence test restores one bot-seated and one all-human legacy snapshot
  without the field and asserts the inferred flag and preserved scores.

### 7. Wrong vs Correct

Wrong:

```ts
// In setReady, after the last human readies:
if (SEATS.every((seat) => room.seats[seat].controller === "HUMAN")) {
  room.scores = { ...ZERO_SCORES }; // resets every all-human round
}
```

Correct:

```ts
// In startRound, before createRound:
const allHuman = isAllHumanTable(room.seats);
if (allHuman && room.scoresIncludeBotRounds) {
  room.scores = { ...ZERO_SCORES };
}
room.scoresIncludeBotRounds = !allHuman;
```
