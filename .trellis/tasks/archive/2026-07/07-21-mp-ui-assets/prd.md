# Miniprogram visual assets and shell

**Parent:** `07-21-mp-web-parity-ui`  
**Order:** First

## Goal

Import Web visual assets and provide reusable tile/action/background building blocks for the mini-program.

## Requirements

- A1. Copy tiles, optimized action buttons, table background into miniprogram tree with stable import paths.
- A2. `MahjongTile` component rendering correct face for each `Tile`.
- A3. Action button image map aligned with `actionButtons` kinds (discard/wildcard/pong/kong/added-kong/win/pass).
- A4. Global theme SCSS tokens inspired by web discreet theme + game-shell background utility.
- A5. Build must include assets without WeChat packaging breakage.

## Acceptance Criteria

- [x] Assets present under miniprogram and referenced by components.
- [x] Tile component unit-smoke (typecheck) for all suits/ranks filenames.
- [x] Action images resolve for all 7 kinds.
- [x] `build:weapp` succeeds.
