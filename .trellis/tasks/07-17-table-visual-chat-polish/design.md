# Technical Design

## Scope and boundaries

This is a targeted redesign of the existing React game table. It preserves the current room controller, game command envelopes, chat event payload and engine rules. The only cross-layer contract addition is authoritative final concealed hands inside `RoundSettlementProjection`.

## Data contracts

Add the following required field to `RoundSettlementProjection`:

```ts
finalHands: {
  seat: Seat;
  tiles: Tile[];
  personalMultiplier: PersonalMultiplier;
}[];
```

`RoomService.project` builds this field only when `round.outcome` exists. Normal `players` projection privacy is unchanged: a player receives their own `hand`, while other players continue to receive `null` during play and after the round. The settlement modal consumes `finalHands` by seat and reuses `MahjongTile` for all artwork.

This additive projection field does not change command payloads, event names, database state or persisted round format. Client and server are deployed together, so no compatibility adapter is required. `schemaVersion` remains 4 because the existing projection shape is extended without changing existing field semantics.

## Component changes

### PlayerStation

- Add an empty `player-avatar` square before identity text.
- Replace `hidden-hand` tile-back bars with a numeric `player-hand-count` label.
- Accept the latest chat message for the player's seat and render one `player-chat-bubble` near the station.
- Render released wildcards as one SVG tile plus a release count. Keep personal multiplier in the score block.

### Table center

- Add wall count to `TurnMarker` because it already owns central turn status.
- Remove duplicate header wall count.
- Remove indicator-only dashed CSS so indicator and wildcard preview share the same tile treatment.

### Settlement modal

- Replace the compact score-only grid with four player rows.
- Each row contains the avatar placeholder, identity, horizontally compressed SVG hand tiles, multiplier, signed round delta and total score.
- The modal remains scrollable on short landscape screens, with smaller settlement tiles at the 500px height breakpoint.

### Chat

- Keep the form inside the existing bottom dock so safe-area and dynamic viewport behavior remain centralized.
- Center the form with CSS grid/absolute positioning while leaving transient connection status on the left and auxiliary actions on the right.
- Remove the dock chat feed. Derive the latest active message for each seat from `chatMessages` and pass it into `PlayerStation`.
- Change client expiry and fade animation from five seconds to three seconds. Socket lifecycle cleanup remains in `useRoom`.

## Styling rules

- Preserve both existing themes and semantic CSS variables.
- Remove wrapper borders/backgrounds from action notices and released-wildcard groups.
- Preserve borders that communicate actual state: selected, legal source, focus-visible, active player and tile body edge.
- Animate chat bubbles with opacity and transform only; reduced motion resolves immediately.
- Use the existing radius scale and no new shadows in low-key mode.

## Testing and compatibility

- Extend room-service settlement tests for all final hands and privacy assertions.
- Add a pure helper for per-seat latest chat selection only if needed; otherwise keep the derivation local and cover through component rendering or targeted helper tests.
- Run lint, typecheck, all tests and production build.
- Validate desktop and 844×390 phone landscape in both themes using a real browser.

## Rollback

The changes are isolated to the additive settlement projection, `GameTable`, `MahjongTile` styling and chat expiry. Reverting the task commit returns the old UI without database migration or persisted-data cleanup.
