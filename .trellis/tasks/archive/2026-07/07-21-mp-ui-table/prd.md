# Miniprogram table layout parity

**Parent:** `07-21-mp-web-parity-ui`  
**Order:** After assets

## Goal

Replace scaffold home/room UI with web-like home + game table layout using asset components and existing `useRoom`.

## Requirements

- T1. HomeScreen: nickname, create friend/bot, join code — web discreet styling.
- T2. Game shell: header (code, connection, scores summary), table surface, four relative seats, hand, melds, action dock with images.
- T3. Wire tile press + action dock to existing command helpers.
- T4. Landscape-friendly page config / layout.
- T5. Bot path remains playable.

## Acceptance Criteria

- [x] Home no longer looks like temporary scaffold only.
- [x] Playing view uses tile art + image actions + table background.
- [ ] Bot create → play actions still works in DevTools. *(operator re-verify after UI refresh)*
- [x] typecheck + build:weapp pass.
