# Implementation Plan

## 1. Shared settlement data

- [x] Extend `RoundSettlementProjection` with four authoritative final concealed hands and per-player multipliers.
- [x] Populate the field in `RoomService.project` only when a round has ended.
- [x] Extend server tests for final-hand content and in-game hand privacy.

## 2. Player stations and table center

- [x] Add blank square avatar slots to every player station.
- [x] Replace simulated hidden-hand rectangles with a numeric remaining-hand label.
- [x] Move wall remaining count into the central turn marker and remove the duplicate header value.
- [x] Remove the indicator dashed outline and non-semantic tile/action wrapper frames.

## 3. Meld and wildcard presentation

- [x] Flatten released-wildcard presentation to match meld tiles.
- [x] Show one wildcard tile plus release count `×N` while retaining the separate personal multiplier.
- [x] Preserve landed action feedback without persistent frames.

## 4. Chat experience

- [x] Center the friend-room chat form in the bottom dock with iOS safe-area support.
- [x] Render each active message as a speech bubble near its sender's avatar.
- [x] Reduce message lifetime and fade duration to three seconds.
- [x] Verify the form does not overlap auxiliary actions on phone landscape.

## 5. Settlement modal

- [x] Render four player settlement rows with SVG final hands.
- [x] Add per-player multiplier, signed round delta and total score.
- [x] Preserve hard/soft win hierarchy and bot/friend continuation behavior.
- [x] Add short-landscape responsive rules.

## 6. Verification

- [x] Run focused protocol/server/frontend tests after each cross-layer stage.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
- [x] Browser-check desktop and 844×390 phone landscape in discreet and premium themes.
- [x] Run `git diff --check` and review visible strings, focus states and reduced-motion behavior.

## Risk and rollback points

- The settlement field must be added to both producer and consumer in one change to avoid a type/runtime mismatch.
- The player station is position-sensitive at short landscape heights; preserve absolute station anchors and only change its internal grid.
- The bottom chat form must leave room for the theme toggle and response controls.
- No database migration is needed; a full task revert is the rollback path.
