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
