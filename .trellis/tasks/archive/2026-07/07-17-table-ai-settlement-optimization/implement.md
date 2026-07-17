# Implementation Plan

## 1. Table meld and result presentation

- [ ] Create and activate the presentation child task.
- [ ] Load frontend Trellis guidelines before editing.
- [ ] Render all persistent melds from `PlayerStation`, including the local player.
- [ ] Remove the local `.meld-row` and constrain station meld geometry responsively.
- [ ] Remove upper settlement multiplier/payment sections.
- [ ] Add explicit round/cumulative labels to player rows.
- [ ] Update component presentation tests.
- [ ] Run targeted Web tests, type-check and build.
- [ ] Check both themes at desktop and 844×390 phone landscape.

## 2. Balanced bot strategy

- [ ] Create and activate the bot child task after the presentation child passes.
- [ ] Load backend/game-engine guidance before editing.
- [ ] Add restricted bot decision contracts and pure discard/response strategy.
- [ ] Export the strategy from the game engine.
- [ ] Map public state in `RoomService` and execute returned intents through existing reducers.
- [ ] Dispatch BOT and TRUSTEE to distinct automatic policies.
- [ ] Add deterministic strategy unit tests and fixed-seed simulations.
- [ ] Add service integration tests for bot/trustee behavior.
- [ ] Run engine and server targeted checks.

## 3. Scoring and multiplier regression protection

- [ ] Create and activate the scoring child after bot checks pass.
- [ ] Add settlement tests for exposed, indicator, concealed and added kongs.
- [ ] Add round tests proving only wildcard release changes personal multiplier.
- [ ] Add service scenarios for kong-then-win and kong-then-draw net score projection.
- [ ] Correct production scoring only if a test exposes an actual mismatch.
- [ ] Run engine and server targeted checks.

## 4. Integration and completion

- [ ] Run `pnpm --filter @huanghuang/game-engine test`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run `docker compose -f deploy/compose.yaml config`.
- [ ] Review the full diff for protocol, privacy, scoring and persisted-state compatibility.
- [ ] Update project specs with durable bot/controller behavior and settlement presentation contracts.
- [ ] Archive completed child and parent tasks through the Trellis finish workflow.

## Risk and Rollback Points

- UI geometry: rollback before changing any protocol fields; browser inspection is required because SSR tests cannot detect overflow.
- Bot strategy: keep strategy input restricted so future refactors cannot accidentally expose hidden state; simulation thresholds must be deterministic and conservative.
- Scoring: preserve existing production functions unless a failing regression demonstrates a defect; every settlement remains zero-sum.
- Database: no runtime database changes are permitted in this task.
