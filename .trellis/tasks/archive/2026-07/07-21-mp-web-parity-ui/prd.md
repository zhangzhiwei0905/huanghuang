# Miniprogram Web-parity UI and friend rooms

## Goal

Bring the WeChat mini-program client to **visual and interaction parity with the Web game shell** (tiles, action buttons, table background, layout chrome) and complete **friend-room UX** for mini-program-only use. Cross-client (Web+MP same room) is not required.

## Background

- Branch: `miniprogram`. Core play already works (token auth, socket.io-mp, bot discard/pong verified).
- Web reference: `apps/web` — `GameTable.tsx`, `MahjongTile.tsx`, `HomeScreen.tsx`, `styles.css`, assets under `apps/web/src/assets/` (tiles SVG, optimized action PNGs, `background.optimized.jpg`).
- Current MP: functional green UI + text tiles; friend create/join exists but lacks invite polish and web-like waiting/table chrome.
- Product shift: **mini-program is the primary future client**; dual-end co-play not in scope.

## Requirements

- R1. **Visual assets**: ship the same tile faces, action button art, and table background family as Web inside `apps/miniprogram` (copy or shared package path; no broken Chinese filenames in runtime if packaging requires aliases).
- R2. **Home / lobby styling**: home create/join screens should match Web discreet visual language (colors, card layout, CTAs)—not the temporary scaffold green form only.
- R3. **Table shell**: implement web-like structure: header, table surface with four seats, hand row, melds/discards, action dock with image buttons; landscape-friendly layout on phone (page orientation or CSS landscape best-effort).
- R4. **Theme**: at least **discreet** full path; **premium** token swap if low-cost via CSS variables / `data-theme` equivalent; premium not blocking if discreet matches web baseline.
- R5. **Friend room complete**: create friend room, show/copy 6-digit code, join by code, lobby seats (ready/owner/connected), owner base score, ready toggle, dissolve/leave, then full play with same action model as bot mode.
- R6. **Bot mode** remains fully playable under the new UI.
- R7. No client-side rule authority; keep protocol-driven `legalActions` + pure helpers.
- R8. Chat still deferred unless free with layout; not required for acceptance.

## Task map

| Child | Owns |
|-------|------|
| `07-21-mp-ui-assets` | Asset pipeline + MahjongTile/action button components + global theme tokens/background |
| `07-21-mp-ui-table` | Home + GameTable layout parity using assets; wire existing useRoom |
| `07-21-mp-friend-room` | Invite code UX, lobby completeness, friend-flow QA |

## Acceptance Criteria (parent)

- [x] AC1. Mini-program uses Web-equivalent tile artwork and action button images (same designs).
- [x] AC2. Playing table shows web-like shell: background, seats, hand tiles, action dock images.
- [x] AC3. Home create/join UI is visually consistent with Web discreet style.
- [ ] AC4. Friend room: create → share/copy code → second client join → ready → play → leave/dissolve. *(operator two-client QA)*
- [ ] AC5. Bot mode still completable under new UI. *(operator re-verify)*
- [x] AC6. typecheck + build:weapp pass (size warnings only).

## Out of scope

- Pixel-perfect identity with every web animation / PWA install chrome.
- Formal WeChat publish.
- Web+MP same-room guarantee (may still work via shared server but not acceptance).
- Chat UI, ranked matchmaking.

## Decisions

| Item | Choice |
|------|--------|
| Visual target | Match Web discreet game shell + assets |
| Dual-end | Not required |
| Delivery | Parent + 3 children on `miniprogram` |
