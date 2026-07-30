# Backend Quality Guidelines

## Required checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pure game modules require positive, negative, and boundary tests. Settlement functions assert zero-sum output. Randomness and time must be injected into the engine.

## Competitive matchmaking and rank settlement

- `MATCH` rooms are server-created only: four linked WeChat sessions, fixed base score 2, 20-second turns, no lobby/ready/settings/chat/dissolve path, and exactly one round. The "no bots" rule is the default for organic 4-human matching; see the experience-phase ranked-bot exception below.
- Queue compatibility is mutual. Rank distance expands at 10/20/40 seconds; only online rows with unchanged queue versions can enter an atomic four-player match transaction.
- **Experience-phase ranked bots** (`competitive-bots.ts`'s `RANKED_BOTS`, gated by `MATCHMAKING_BOTS_ENABLED`): 10 preset bot accounts (赌神/赌侠/赌圣 at fixed starting rankLevel 17/13/9, plus 7 more — 大力娃/千里眼/铁娃/火娃/水娃/隐身娃/葫芦娃 — starting at rankLevel 0/黑铁Ⅴ) with real `anonymous_sessions`/`competitive_profiles` rows, so they settle rank and achievements exactly like a human and their rank drifts naturally over time — there is no mechanism to pin a bot's rank. All 10 use `botDifficulty: "LOW"` in ranked rooms specifically (只硬胡 — only auto-claims `DECLARE_WIN` when `winType === "HARD"`; see `chooseBotAction` in `packages/game-engine/src/bot.ts`), which is a deliberate departure from non-ranked `BOT`-mode rooms elsewhere in the codebase that may use `HIGH`. `MatchmakingService.tick()` treats the bot roster as a shared pool: it computes the currently-idle bots (`!hasActiveCompetitiveMatch(bot.id)`) fresh every tick and only forms a table when enough are idle to fill the remaining seats, so multiple bot-filled tables can run concurrently (up to `floor(10 / 3) = 3` concurrent 1-human tables) instead of the old one-table-at-a-time global mutex. The real safety net against double-booking a bot is the match-creation DB transaction re-checking each target session's active-match status and throwing `CompetitiveMatchCreationConflictError` on conflict (caught and retried next tick) — the idle-bot filter is an optimization, not the correctness guarantee.
- Bot fill reuses `matchmakingRange()` against every selected human, preserves
  complete 1–3 player parties, gives an available compatible four-human group
  priority, and rotates eligible bots by oldest/null last-match timestamp.
  Never select `RANKED_BOTS.slice(0, needed)` or compare only to one anchor.
- HTTP status polling is a matchmaking heartbeat. After 8 seconds without a heartbeat (`MATCHMAKING_HEARTBEAT_TIMEOUT_MS`, widened from 3s to tolerate normal network jitter against ~1s client polling), the row enters a 10-second disconnect grace; reconnect clears `disconnected_at` without resetting `enqueued_at`.
- Global session presence and per-room subscription presence are separate. Only the first/last subscription for `(room, session)` changes HUMAN/TRUSTEE control; a lobby Socket must not restore manual room control.
- Every accepted human or automatic action follows clone → derive facts → `saveAcceptedTransition` → replace live room. Never mutate the live MATCH room before SQLite commits.
- Competitive rank uses the shared pure transition module. Winner level change uses the authoritative public win multiplier; each payer uses `payment / baseScore`. Kong transfers and `roundDelta` never feed rank.
- A win stays `ACTIVE` while the persisted win effect is pending. The effect-completion tick commits the visible result snapshot and rank settlement together; a draw settles in its accepted transition.
- Achievement facts are limited to seven MATCH actions (`EXPOSED_KONG`, `INDICATOR_PONG_KONG`, `ADDED_KONG`, `CONCEALED_KONG`, `RELEASE_WILDCARD`, `HARD_LAIYOU`, `SOFT_LAIYOU`) and deduplicated by server round/version before counters increment. `PONG` is deliberately excluded — do not add it without a product decision, since `competitiveAchievementAction()` treats "excluded" and "not yet implemented" the same way (returns `null`). `WIN` is only converted to an achievement when `descriptor.laiyou === true` (the winning tile was drawn right after that seat's own wildcard release — "来由"), and then only into `HARD_LAIYOU`/`SOFT_LAIYOU` per `descriptor.winType`; a non-laiyou win still records nothing. `competitiveAchievementAction()` takes the whole `EffectDescriptor` (not just the bare `GameEffectAction`) so it can see `winType`/`laiyou` for this WIN case.
- Ranked match history (`GameDatabase.listCompetitiveMatchHistory`, exposed via `GET /api/competitive/matches`) is derived straight from `competitive_match_players`/`competitive_matches` columns already written by settlement — it does not parse `result_json`. `multiplier IS NULL` is the only reliable DRAW signal; once that's ruled out, `final_rank_delta`'s sign alone distinguishes WIN (`> 0`, always true per `applyCompetitiveRankTransition`) from LOSS (`<= 0`, including a fully protection-card-absorbed loss that leaves rank unchanged). "Crossed a major tier" is likewise derived on read via `majorIndexForRankLevel(preRankLevel)` vs `majorIndexForRankLevel(postRankLevel)`, not stored as its own column. This is a self-only, MATCH-only view — friend/bot rooms never create these rows.
- `INDICATOR_PONG_KONG` attribution goes to the *claiming* seat, never the seat that discarded the indicator tile — verified end-to-end with a real command/tick/bot-AI reproduction in `room-service.test.ts` ("attributes an INDICATOR_PONG_KONG claim to the claiming bot's session, not the discarding human's") across all four seat-shuffle positions. If a similar attribution report comes in again, re-run/extend that test rather than assuming the meld/seat-diff logic (`round.ts` `claimResponse`, `room-service.ts` `detectEffectDescriptor`/`competitiveAchievementEvent`) is at fault — it was audited and found correct; the discrepancy is more likely a client-side observation/display issue.
- A settled result remains recoverable until each player acknowledges it. Continue matchmaking atomically acknowledges and enqueues. All acknowledgements or the 24-hour retention boundary close the room; timeout acknowledgement releases abandoned results.
- Rank level, table score and any future rechargeable balance are separate ledgers. This project has no wallet or recharge path.

## Scenario: Ranked bot public profile projection

### 1. Scope / Trigger

Any change to MATCH seat controllers, public player projection or competitive
profile lookup must preserve profile parity between linked humans and preset
ranked bots.

### 2. Signatures

```ts
type SeatController = {
  controller: "HUMAN" | "BOT" | "TRUSTEE";
  sessionId: string | null;
};

type PlayerProjection = {
  competitiveProfile: PublicCompetitiveProfile | null;
};
```

No protocol or database schema change is required.

### 3. Contracts

- `RoomService.project` queries public competitive profiles for every non-null
  seated `sessionId`; controller kind is not an identity filter.
- Preset ranked bots carry stable session ids created by
  `ensureRankedBotSession`, so their persisted rank and five achievement
  totals project through the same `PublicCompetitiveProfile` path as humans.
- Ordinary practice/friend bots have `sessionId: null` and continue to project
  `competitiveProfile: null`.
- Never synthesize bot-only rank or achievement values in the frontend.

### 4. Validation & Error Matrix

| Condition | Required projection |
|---|---|
| Human seat with linked profile | Real public profile |
| Ranked BOT seat with stable session/profile | Real public profile |
| Practice BOT seat with null session | `competitiveProfile: null` |
| Profile row absent for a non-null session | `competitiveProfile: null` |
| Ranked bot earns a MATCH achievement | Next projection exposes the persisted increment |

### 5. Good/Base/Bad Cases

- Good: clicking a ranked bot avatar shows its current rank and all five real
  counters, including an action earned in the current match.
- Base: clicking an ordinary practice bot shows no permanent competitive
  record.
- Bad: filtering profile lookup with `controller === "BOT"`; this discards the
  identity of ranked bots even though they own real database rows.

### 6. Tests Required

- A 1-human + 3-ranked-bot MATCH projection has non-null profiles for all four
  seats.
- After a ranked bot claims an indicator pong-kong, its projected counter is
  one and the discarding human's persisted counter remains zero.
- A normal BOT-mode room keeps every null-session bot profile null.

### 7. Wrong vs Correct

Wrong:

```ts
if (seat.sessionId === null || seat.controller === "BOT") return [];
```

Correct:

```ts
if (seat.sessionId === null) return [];
return [seat.sessionId];
```

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
calculateSelfDrawSettlement({ baseScore, winnerSeat, winType, laiyou, personalMultipliers }): ScoreDelta[];
calculateKongSettlement({ baseScore, actorSeat, kind, sourceSeat }): ScoreDelta[];
```

### 3. Contracts

- Every round initializes each `personalMultiplier` to `1`; only successful `releaseWildcard` multiplies it by two.
- Pong and every kong action leave all personal multipliers unchanged.
- Exposed and indicator pong-kongs charge the source seat `3 × baseScore`; concealed kong charges every opponent `2 × baseScore`; added kong charges every opponent `1 × baseScore`.
- Kong transfers apply immediately, remain after a draw and never multiply by either player's personal multiplier.
- Self-draw payment is `baseScore × hard/soft factor × laiyou factor × winner multiplier × payer
  multiplier`. The laiyou factor is 2 only for a laiyou win, so the ceiling is 2 × 2 × 16 = 64.
- The laiyou factor never writes back into `personalMultiplier`; that union stays `1 | 2 | 4 | 8 | 16`.
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
- Good: a laiyou win doubles every self-draw payment while leaving kong transfers untouched.
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
  schemaVersion: 8;
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
- Durations are server-owned and aligned to the client visual budgets so a
  completed animation leaves no blank interaction lock: pong 450 ms; exposed,
  concealed and indicator kong 700 ms; added kong 650 ms; wildcard release
  800 ms; win 1050 ms. The process scheduler polls at 50ms, so the first tick
  after `endsAt` adds at most 50ms of completion latency.
- Cue identity, actor, tile and win type come from the accepted round delta,
  never from the command payload.
- Scheduling and completion each increment room version once. The accepted
  command result and pending transition snapshot are committed together by
  `saveRoomAndProcessedRequest`.
- `CommandResult` remains the persisted deduplication contract. At the Socket
  transport boundary, an accepted acknowledgement additionally carries
  `RoomService.project(room, requesterSessionId)` so the requester can render
  without an HTTP round trip. Peer sockets receive their own member-specific
  projections, never the requester's private projection.
- While pending, projections expose the cue with `legalActions = []`,
  `actingSeat = null` and `actionDeadlineAt = null`. Pong may project the
  already-accepted next-round public meld/hand layout immediately so the
  claimed tiles land together with its short visual beat; the authoritative
  round and all other effect transitions still commit only on expiry.
- `tick(now < endsAt)` does nothing. The first `tick(now >= endsAt)` replaces
  the live round, clears the transition, refreshes the real next deadline and
  persists. The Socket scheduler then pushes a freshly projected private
  payload to each subscribed member, avoiding a version-notice → HTTP GET tail
  after the visual completes. Later ticks cannot apply it again.
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
- Transport type-checking must preserve member-specific projection privacy;
  mini-program playback tests cover direct projection replacement separately
  from the legacy refresh fallback.

### 7. Wrong vs Correct

Wrong:

```ts
room.round = result.state;
setTimeout(() => broadcastSettlement(room), 1_050);
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
  schemaVersion: 8;
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

## Scenario: One-shot full-table score reset

### 1. Scope / Trigger

A `FRIEND` room fills empty seats with bots (`addBot`) and plays practice rounds.
Humans that join mid-round become spectators and replace bots at the next
waiting transition. The first time a round starts with all four seats human, the
cumulative ledger is zeroed. That reset happens **once per room** and never
again; a fresh ledger requires creating a new room.

### 2. Signatures

```ts
type RoomState = {
  scores: Record<Seat, number>;
  fullTableScoreResetDone: boolean;
};

type PersistedRoomState = {
  fullTableScoreResetDone?: boolean;
};

type RoomProjection = {
  schemaVersion: 8;
  scoreResetPending: boolean;
};
```

No new HTTP route, command payload or environment key.

### 3. Contracts

- `RoomService.startRound` is the single choke point. It is the only place a
  round receives `startingScores`, so the reset and the flag both live there
  instead of in a command handler. Do not add the reset to `setReady`,
  `continueBotRound` or `createRoom` — they all reach `startRound`.
- Reset condition: `!fullTableScoreResetDone && isAllHumanTable(seats)`. The flag
  then flips to `true` and never flips back.
- Fire at round **start**, not when the fourth human takes a seat. A seat can
  turn back into a bot while the room is still waiting, and the reset must not be
  spent on a round that ends up including a bot.
- A disconnect or leave replaces the seat with `botSeat()`, and the returning
  player rejoins into that seat. This must **not** trigger a second reset: the
  scores earned before the drop stay on the board. This is a deliberate rule, not
  an accident of the implementation — do not "fix" it by re-arming the flag when a
  bot takes a seat.
- `scoreResetPending = !fullTableScoreResetDone &  rounuman`. Because no path
  turns a bot-started round all-human mid-round,  instead of in a command hanAITING`.
- Snapshots written before the field in  `continueBotRound` or `createRoom` — they all res already reset so - Reset condition: `!fullTableScoreResetDone && isAllHumanTable(seat s  then flips to `true` and never flips back.
- Fire at round **start**, not whenel- Fire at round **start**, not when the foudi  turn back into a bot while the room is still waiting, and the reset must nea  spent on a round that ends up including a bot.
- A disconnect or leave replacean- A disconnect or leave replaces the seat with la  player rejoins into that seat. This must **not** trigger a second reset: tm   scores earned before the drop stay on the board. This is a deliberate rule, p  an accident of the implementation — do not "fix" it by re-arming the flag whla  bot takes a seat.
- `scoreResetPending = !fullTableScoreResetDone &  rounuman`. B F- `scoreResetPendi`,  turns a bot-started round all-human mid-round,  instead of in a command hare- Snapshots written before the field in  `continueBotRound` or `createRoom` — theyar- Fire at round **start**, not whenel- Fire at round **start**, not when the foudi  turn back into a bot while the room is still waiting, and the reset must nea  spent on a round that ends up including a bot.
- A disconnectth- A disconnect or leave replacean- A disconnect or leave replaces the seat with la  player rejoins into that seat. This must **not** trigger a second reset: tm   scores earned before the drop stay on the boat`- `scoreResetPending = !fullTableScoreResetDone &  rounuman`. B F- `scoreResetPendi`,  turns a bot-started round all-human mid-round,  instead of in a command hare- Snapshots written before the field in  `continueBotRound` or `createRoom` — theyar- Fire at round **start**, not whenel- Fire at round **start**, not when the foudi  turn bce- A disconnectth- A disconnect or leave replacean- A disconnect or leave replaces the seat with la  player rejoins into that seat. This must **not** trigger a second reset: tm   scores earned before the drop stay on the boat`- `scoreResetPending = !fullTableScoreResetDone &  rounuman`. B F- `scoreResetPendi`,  turns a bot-started round all-human mid-round,  instead of in a command hare- Snapshots written before the field in  `continueBotRound` or `creaZERO_SCORES };
  room.fullTableScoreResetDone = true;
}
```

## Scenario: Laiyou (来由) wins

### 1. Scope / Trigger

`releaseWildcard` removes a wildcard and immediately draws a replacement. Winning
on exactly that replacement tile is 来由: 硬来由 for a hard win, 软来由 for a soft
win. It doubles the whole self-draw payment on top of the release doubling.

### 2. Signatures

```ts
type RoundState = {
  laiyouCandidate: { seat: Seat; tileId: string } | null;
};

type RoundOutcome = { kind: "WIN"; winType: WinType; laiyou: boolean; /* ... */ };

export function isLaiyouWin(state: RoundState, seat: Seat): boolean;

type RoundSettlementProjection = {
  winBaseMultiplier: 1 | 2 | null; // win type only
  laiyou: boolean;
  laiyouMultiplier: 1 | 2 | null;
};

type GameEffectCue = { laiyou: boolean };

type RoomProjection = { schemaVersion: 8 };
```

### 3. Contracts

- The candidate is `{ seat, tileId: lastDrawnTileId }`, written by `releaseWildcard`
  after its replacement draw. `isLaiyouWin` compares it against the current
  `lastDrawnTileId`.
- Do **not** add explicit candidate clearing to other reducers. Every later draw
  (next turn, concealed kong, added kong, exposed kong claim) overwrites
  `lastDrawnTileId`, which invalidates the candidate by comparison. Paths that
  hand the turn over without drawing (pong / indicator pong-kong) leave
  `lastDrawSeat` on the previous drawer, so `hasCurrentDrawnTile` already blocks
  a win there.
- Passing the win (`continueTurn`) sets `winPassedThisTurn`, so the same tile can
  never be re-claimed as laiyou.
- The laiyou class is always the engine's `winType`. `evaluateWin` already enforces
  the wildcard-count rules (`TOO_MANY_WILDCARDS`; a soft win uses exactly one
  wildcard as substitute), so no extra hand inspection is needed.
- Confirmed rule detail: holding two wildcards, releasing one, then drawing into a
  hard win is **硬来由**, even though a wildcard is still in hand. What makes it
  hard is that the remaining wildcard stands for its own face value rather than
  substituting another tile, which is exactly what `winType === "HARD"` means. Do
  not add a "hand must contain no wildcard" condition on top of `winType`.
- `winBaseMultiplier` keeps meaning "win type only". Laiyou is a separate
  projected factor so clients can break the total down instead of guessing.
- Rounds are persisted inside the room JSON. `normalizeRoundState` must default
  `laiyouCandidate` to `null` and `outcome.laiyou` to `false` on every load path,
  including `pendingEffectTransition.nextRound`.
- Bot behaviour is unchanged: bots already declare a win whenever it is legal, so
  they earn laiyou naturally.

### 4. Validation & Error Matrix

| Condition | Required behaviour |
|---|---|
| Win on the post-release draw | `outcome.laiyou = true`, payments doubled |
| Win passed via `continueTurn`, then a later win | `laiyou = false` |
| Win on a kong replacement draw after a release | `laiyou = false` |
| Draw outcome | `laiyou = false`, `laiyouMultiplier = null` |
| Any settlement delta sum is nonzero | Throw through `assertZeroSum` |
| Round snapshot predating the fields | Normalize to `null` / `false` |

### 5. Good/Base/Bad Cases

- Good: releasing the last wildcard and drawing the winning tile projects 硬来由
  with `laiyouMultiplier: 2` and a doubled payer amount.
- Base: an ordinary self-draw projects `laiyou: false` and `laiyouMultiplier: 1`.
- Bad: recomputing laiyou on the client from `releasedWildcards`, or folding the
  laiyou factor into `winBaseMultiplier` / `personalMultiplier`.

### 6. Tests Required

- Engine tests cover hard laiyou (with exact doubled deltas), soft laiyou, the
  passed-win case and the kong-replacement-draw case.
- Settlement tests assert laiyou doubles every delta, the 64× ceiling and zero sum.
- Service tests assert the projected `laiyou` / `laiyouMultiplier` for laiyou and
  non-laiyou wins, plus normalization of a snapshot without the fields.
- Mini-program audio tests assert the laiyou mapping and that one win speaks once.

### 7. Wrong vs Correct

Wrong:

```ts
// Client-side guess from public state
const laiyou = player.releasedWildcards.length > 0 && settlement.winnerSeat === player.seat;
```

Correct:

```ts
// Engine decides, projection carries it, client only renders
const laiyou = isLaiyouWin(state, seat);
const deltas = calculateSelfDrawSettlement({ baseScore, winnerSeat: seat, winType, laiyou, personalMultipliers });
```

## Scenario: Semantic game audio mapping

### 1. Scope / Trigger

The mini-program is the only client with audio (`apps/web` has no audio layer).
`apps/miniprogram/src/lib/gameAudioEvents.ts` turns projection deltas into file
names; `gameAudioPlayer.ts` owns the per-file playback window.

### 2. Signatures

```ts
const WIN_AUDIO_FILE: Record<WinType, GameAudioFileName>;
const LAIYOU_AUDIO_FILE: Record<WinType, GameAudioFileName>;
export function winAudioFileName(winType: WinType | null, laiyou: boolean): GameAudioFileName;
const AUDIO_WINDOWS: Record<GameAudioFileName, AudioWindow>;
```

### 3. Contracts

- Win audio is chosen through `winAudioFileName` in both the `effectCue` branch
  and the settlement fallback. Never re-inline a `winType === "HARD" ? ... : ...`
  ternary; that duplication is what the tables replace.
- 来由 is a distinct semantic event that currently maps onto the plain hard/soft
  clips. Swapping in dedicated audio means editing `LAIYOU_AUDIO_FILE` only.
- `AUDIO_WINDOWS` is `Record<GameAudioFileName, AudioWindow>`. Adding a file name
  without its window fails typecheck; keep that guard rather than widening it.
- Playback timing is unchanged by audio-mapping work: the cue speaks once when it
  appears, and the `completingEffect` suppression stops the matching public-state
  diff from speaking again.

### 4. Validation & Error Matrix

| Condition | Required behaviour |
|---|---|
| New win cue with `laiyou: true` | One file from `LAIYOU_AUDIO_FILE` |
| New win cue with `laiyou: false` | One file from `WIN_AUDIO_FILE` |
| Same settlement round id seen again | No audio |
| Cue completing into visible state | Suppress the duplicate diff |

### 5. Good/Base/Bad Cases

- Good: a soft laiyou win speaks exactly one clip per round.
- Base: a draw settlement stays silent.
- Bad: adding a dedicated laiyou file name without an `AUDIO_WINDOWS` entry, or
  pushing both the cue file and the settlement fallback file for one win.

### 6. Tests Required

- Assert the laiyou and non-laiyou mappings through `winAudioFileName`.
- Assert one win produces one file and repeats produce none.
