# Technical Design

## Strategy Ownership

Add a pure `bot.ts` module to the game engine. The module receives a deliberately restricted `BotDecisionView` containing legal action names, the acting player's concealed/public state, public table state, wildcard/indicator data and wall count. It does not receive `RoundState`, opponent hands or wall tiles.

The server maps `RoundState` to this view and translates the returned intent to existing reducers. Reducers remain the only authority for legal actions, draws, meld creation, win checks and score changes.

## Hand Evaluation

For each legal discard, remove the candidate and calculate a structural score from tile-kind counts:

- complete triplets/sequences;
- pairs;
- adjacent and one-gap incomplete sequences;
- isolated tiles;
- existing public meld count;
- one retained wildcard as flexible completion potential.

Enumerate all 27 next tile kinds. A draw contributes improvement weight only for copies not already held or publicly visible. This live-improvement score breaks the current draw-and-immediately-discard loop and lets hands evolve toward a legal standard win.

Equal best candidates are selected through an injected `RandomInt`.

## Action Decisions

- Win always has highest priority.
- Release wildcards while at least two remain.
- Concealed/added/exposed/indicator kongs are normally accepted for fixed score and replacement-draw value when legal.
- Pong compares the resulting post-claim structure with the current hand and passes when opening the hand materially reduces quality.
- Discard uses the ranked candidate described above.

## Controller Separation

`RoomService` dispatches exact controllers:

- `BOT`: full strategy.
- `TRUSTEE`: current conservative timeout behavior; response pass, legal win, excess-wildcard release, then drawn tile or legal fallback discard.
- `HUMAN`: timeout invokes the same conservative trustee behavior without changing controller identity.

## Testing

Pure unit tests use handcrafted views and deterministic RNG. Service tests verify mapping and reducer execution. A fixed-seed simulation repeatedly executes strategy intents through the real round state machine and asserts termination, legality and at least one bot win over a conservative batch.
