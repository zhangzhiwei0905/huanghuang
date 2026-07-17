# Technical Design

## Task Boundaries

The parent task coordinates three independently verifiable deliveries:

1. table meld/result presentation;
2. balanced bot strategy and trustee separation;
3. scoring/multiplier regression protection.

The parent also records the decision to defer PostgreSQL. It does not own direct implementation unless cross-child integration exposes a shared defect.

## Frontend Presentation

`PlayerStation` becomes the only persistent public-meld owner for every seat. The local hand area continues to own concealed tiles and action controls but no longer renders a second meld row. Existing `MeldGroup` instances and landed-action state are reused.

The station grid keeps the identity and score row at the top and gives `.player-melds` a constrained full-width row. Meld groups remain intact, while the container wraps groups within the station. Responsive tile dimensions continue to be selected by the existing media queries.

The settlement protocol remains unchanged. `RoundSettlementModal` keeps the outcome title, four authoritative final-hand rows, and bot-mode actions, but removes the upper multiplier formula/payment presentation. Each score cell explicitly labels round and cumulative values.

## Bot Strategy Boundary

A pure `packages/game-engine/src/bot.ts` module owns bot decisions. It receives a restricted view rather than `RoundState`:

- acting seat and legal action names;
- own concealed hand, melds, released wildcards and last drawn tile ID;
- wildcard and indicator kinds;
- wall count;
- public discards, meld tile kinds and released wildcards from all seats.

It never receives opponent concealed hands or wall order. The server maps authoritative state into this view, asks for an intent, then invokes the existing round reducer. All legality and score mutation remain in `round.ts`.

Discard selection ranks every legal candidate by hand structure and live improvements. The scorer rewards completed groups, pairs and adjacent/gapped runs and penalizes isolated tiles. It then enumerates all 27 possible next tile kinds and weights structural improvements by the number of physical copies not already visible or held. Exact ties use an injected `RandomInt`.

Response decisions compare the post-claim hand quality with passing. Kongs receive their fixed positive transfer and replacement-draw benefit; pong is accepted only when it does not materially worsen hand quality. The strategy always declares a legal win and releases excess wildcards.

Trustee behavior remains in the server as the conservative timeout policy. Controller dispatch uses the exact controller value rather than treating every non-human controller as a bot.

## Scoring Contract

The existing settlement functions remain authoritative:

- self-draw reads hard/soft multiplier and both players' personal multipliers;
- kong settlement reads only base score, kind, actor and source seat;
- personal multiplier mutation remains exclusive to `releaseWildcard`.

Tests, rather than unnecessary production rewrites, lock all kong variants, multiplier invariants, and draw/win integration. Round score changes remain current score minus starting score, so they naturally combine immediate kong transfers and final self-draw transfers.

## Compatibility

- No protocol schema version changes.
- No persisted room-state migration.
- Existing active SQLite room snapshots remain loadable.
- Existing UI themes share one component tree.
- Existing command payloads and idempotency behavior remain unchanged.

## PostgreSQL Decision

SQLite remains the production database for the current single-instance, small-audience deployment. A later account project should first separate stable player identity from revocable auth sessions and make persistence asynchronous/serialized, then use a maintenance-window PostgreSQL cutover. Avatar bytes belong in object storage; the database stores references and metadata.

## Rollback

Each child task is independently revertible:

- UI child restores the separate local meld row and upper settlement sections without touching rules.
- Bot child restores the prior automatic-action policy without changing round state shape.
- Scoring child is test-focused; any discovered production correction is isolated in the pure engine.
