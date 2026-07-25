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
  schemaVersion: 5;
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
