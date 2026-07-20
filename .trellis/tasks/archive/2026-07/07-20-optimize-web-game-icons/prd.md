# Optimize web app and game button icons

## Goal

Use the supplied Mahjong artwork to give the web app a recognizable product icon and replace seven in-game action-button treatments with action-specific artwork without changing game rules or command behavior.

## Background

- The supplied source icon is `apps/web/src/assets/icon.png` (1254×1254).
- The supplied table artwork is `apps/web/src/assets/background.png` (1672×941); a runtime-optimized derivative can be used while preserving this source file.
- The supplied button artwork is under `apps/web/src/assets/buttons/`; seven files cover the six existing conceptual primary actions plus `PASS_RESPONSE` (`过`).
- The existing PWA references `/icons/icon-192.png`, `/icons/icon-512.png`, and `/icons/apple-touch-icon.png`; `index.html` currently has no explicit browser favicon.
- `PASS_RESPONSE` is currently split into the bottom dock, which can make it invisible while response actions such as pong/kong appear above the hand. `CONTINUE_TURN` remains an auxiliary dock action and has no supplied artwork.

## Requirements

- R1. Derive the browser/PWA/Apple application icons from `apps/web/src/assets/icon.png` and add an explicit favicon reference.
- R2. Map the supplied action artwork as follows: `DISCARD_TILE` → `出牌.png`; `RELEASE_WILDCARD` → `放赖.png`; `CLAIM_PONG` and `CLAIM_INDICATOR_PONG_KONG` → `碰.png`; `CLAIM_EXPOSED_KONG` and `DECLARE_CONCEALED_KONG` → `杠.png`; `DECLARE_ADDED_KONG` → `补杠.png`; `DECLARE_WIN` → `胡牌.png`; `PASS_RESPONSE` → `过.png`.
- R3. Preserve the existing legal-action visibility, action order, disabled-state rules, click payloads, accessible labels, minimum 44px touch targets, responsive landscape layout, and both theme modes.
- R4. Promote `PASS_RESPONSE` into the same visible action bar as pong/kong response choices so all legal choices stay together. Keep only `CONTINUE_TURN` as an auxiliary dock control.
- R5. Present the supplied artwork cleanly inside the existing action bar while retaining accessible text for assistive technology.
- R6. Preserve every simultaneously legal response choice, including `碰 + 过`, `碰 + 杠 + 过`, and `亮牌碰杠 + 过`, without mutual-exclusion or filtering regressions.
- R7. Use the supplied background artwork across the playable `.table-surface` only, with cover behavior and theme-appropriate overlays that keep table content readable and visually compatible with the illustrated action buttons.

## Acceptance Criteria

- [x] Installing or bookmarking the web app uses resized variants of `apps/web/src/assets/icon.png`; the browser tab also has an explicit favicon.
- [x] Every legal image-backed action renders the mapped supplied image and still dispatches the same command/payload as before.
- [x] Indicator-pong uses the `碰` artwork, all generic exposed/concealed kong cases use the `杠` artwork, added kong uses `补杠`, and self-draw uses `胡牌`.
- [x] `PASS_RESPONSE` renders the supplied `过` artwork beside the other response choices and is not duplicated in the bottom dock.
- [x] `碰 + 过`, `碰 + 杠 + 过`, and `亮牌碰杠 + 过` produce complete, correctly ordered button sets.
- [x] Disabled discard/wildcard actions remain visibly disabled and cannot dispatch invalid selections.
- [x] Primary action buttons remain keyboard/screen-reader accessible and at least 44px high on phone landscape.
- [x] Existing action-button tests pass, and the web package passes type-check/build validation.
- [x] The playable table uses the optimized derivative of `background.png` in both themes without affecting waiting/home screens.
- [x] The background covers desktop and 844×390 landscape table viewports without tiling, page overflow, or reduced readability of stations, discards, tiles, and action buttons.

## Out of Scope

- Changing Mahjong rules, server command contracts, action eligibility, or the remaining `CONTINUE_TURN` auxiliary dock control.
- Redesigning unrelated home, room, table, or settlement UI.
- Generating artwork beyond the supplied icon, table background, and seven button images.
