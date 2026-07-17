# Implementation Plan

- [ ] Load game-engine and backend Trellis guidance.
- [ ] Define restricted bot view and intent types.
- [ ] Implement structural/live-improvement discard ranking with injected RNG.
- [ ] Implement win, wildcard, pong/pass and kong action decisions.
- [ ] Export the strategy from the game engine.
- [ ] Map public state in `RoomService` and execute intents through existing reducers.
- [ ] Separate BOT and TRUSTEE automatic behavior.
- [ ] Add pure strategy tests including the drawn-tile regression.
- [ ] Add controller-separation service tests.
- [ ] Add deterministic multi-round simulation coverage.
- [ ] Run engine tests/type-check and server/full checks.

## Rollback

The strategy module does not change persisted state or protocols. Reverting the server dispatch and export restores prior behavior without data migration.
