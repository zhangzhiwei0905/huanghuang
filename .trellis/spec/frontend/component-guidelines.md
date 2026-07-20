# Frontend Component Guidelines

## Component shape

Use function components with explicit props and semantic HTML. A component renders server-provided state; it does not decide whether an action is legal.

```tsx
type ActionButtonProps = {
  label: string;
  disabled: boolean;
  onPress: () => void;
};

export function ActionButton({ label, disabled, onPress }: ActionButtonProps) {
  return <button type="button" disabled={disabled} onClick={onPress}>{label}</button>;
}
```

## Styling

- Use shared CSS custom properties and stable class names.
- Both visual themes must use the same component tree and hit targets.
- `.table-surface` owns the playable-table artwork. Use the optimized derivative of `apps/web/src/assets/background.png` with `background-size: cover`, no tiling, and theme-specific translucent overlays; do not apply this artwork to home, waiting-room, header, or action-dock surfaces.
- Animate only `transform`, `opacity`, and `box-shadow` for table actions. `box-shadow` is scoped to the pong/kong/wildcard-release action-feedback exception (see below) — do not use it to add ambient shadows/glow elsewhere.
- A control must have a visible text or accessible name; color alone cannot communicate wildcard or disabled state.

## Action-feedback animation (pong / kong / wildcard release)

- Both themes use one shared animation intensity for these three action categories; do not fork per-theme strength. This is a deliberate exception to the low-key theme's general "no glow/no game-y animation" rule (see parent task `07-15-huanghuang-web-game-plan/prd.md` R6) — the exception is scoped to these three actions only.
- Classify `PlayerActionNotice["action"]` (from `playerActionNotice.ts`) into exactly one of three CSS category classes before rendering: `action-pong`, `action-kong` (covers all four kong-family meld kinds: `EXPOSED_KONG`/`CONCEALED_KONG`/`ADDED_KONG`/`INDICATOR_PONG_KONG`), `action-wildcard`. Do not change `playerActionNotice.ts`'s detection logic itself to add per-action styling — keep detection and presentation separate.
- Apply the same category class in two places so the effect reads consistently: the transient floating notice (`.player-action-tiles`) and a short-lived `is-landed` highlight (~600–900ms, auto-cleared via `setTimeout`, same pattern as the notice's own dismiss timer) on the tile/meld that just became persistent inside the acting player's `PlayerStation` (public meld row or wildcard tag).
- All three category keyframes must resolve instantly to their end state under `@media (prefers-reduced-motion: reduce)` — verify the reduced-motion block actually overrides `animation-duration`/`animation-iteration-count` for the new keyframes, not just `transition`.

**Example** (`apps/web/src/components/GameTable.tsx`):
```tsx
function actionCategory(action: PlayerActionNotice["action"]): "pong" | "kong" | "wildcard" {
  if (action === "RELEASE_WILDCARD") return "wildcard";
  if (action === "PONG") return "pong";
  return "kong"; // EXPOSED_KONG | CONCEALED_KONG | ADDED_KONG | INDICATOR_PONG_KONG
}
```

## Deriving per-tile legality client-side

- `RoomProjection.legalActions` is a flat `string[]` of action types for the current player — it carries no per-tile detail. Do not ask for new server fields to highlight "which tile" enables an action; derive it in a pure, unit-tested module (see `apps/web/src/components/actionEligibility.ts`) from data already in the projection (`hand`, `melds`, `discards`, `wildcardKind`, `currentSeat`, `roundPhase`).
- Known-safe derivation: during `roundPhase === "DISCARD_RESPONSE"`, `currentSeat` still points at the discarder (it only advances once the response resolves) — the tile being responded to is `playerAt(room, room.currentSeat).discards.at(-1)`. Verified against `packages/game-engine/src/round.ts`; re-verify against the engine source (not just this note) if the round state machine changes.
- Wildcard tiles (`room.wildcardKind`) must be excluded from concealed-kong/added-kong eligibility — the engine forbids using the wildcard's own face for real melds, only for the final win check.
- Keep detection (what's legal) and eligibility-highlighting (which tile) as separate pure functions; don't let presentation code infer legality itself — legality still comes only from `legalActions`, eligibility only decides *which* already-legal tile to show/use.

## Merging mutually-exclusive actions into one button

- When two action types can never be legal at the same time (e.g. `CLAIM_EXPOSED_KONG` vs `DECLARE_CONCEALED_KONG`, or `CLAIM_PONG` vs `CLAIM_INDICATOR_PONG_KONG`), it's fine to render one button that dispatches whichever is currently in `legalActions`, with a small dynamic sub-label showing the specific action (e.g. "杠" button sub-labels "明杠"/"暗杠"). The `aria-label` must state the specific action, not the generic merged label, so screen readers get the real action name.
- For actions needing a tileId/meldId payload (`DECLARE_CONCEALED_KONG`, `DECLARE_ADDED_KONG`), prefer the user's manually-selected tile when it's a valid source; otherwise auto-derive from the eligibility module above. Never duplicate payload-shape logic — one function builds the payload, both the manual-select path and the auto-derive path call it.

## On-demand primary game actions

`RoomProjection.legalActions` is the only source for showing an in-game action. Do not render a permanent row of disabled actions: an unavailable action must not occupy space or compete with the current decision.

Use `apps/web/src/components/actionButtons.ts` as the single presentation mapping:

```text
DISCARD_TILE                                -> 出牌
RELEASE_WILDCARD                            -> 放赖
CLAIM_PONG / CLAIM_INDICATOR_PONG_KONG      -> 碰
CLAIM_EXPOSED_KONG / DECLARE_CONCEALED_KONG -> 杠
DECLARE_ADDED_KONG                          -> 补杠
DECLARE_WIN                                 -> 自摸
PASS_RESPONSE                              -> 过
```

- Render these seven image-backed conceptual actions only in the action bar immediately above the self hand. `PASS_RESPONSE` must stay beside pong/kong response choices so the player can see every legal response in one place; keep only `CONTINUE_TURN` as a quieter auxiliary control in the bottom dock.
- Preserve mapping order and mutual exclusion in the pure `primaryActionButtons` function. Rendering code consumes its models and must not repeat legal-action branches.
- `DISCARD_TILE` requires a selected non-wildcard physical tile. `RELEASE_WILDCARD` requires a selected physical wildcard. Share this check through `hasValidTileSelection`; never send a known-invalid selection and wait for a server rejection to explain the UI state.
- Discard is the stable high-frequency primary style; wildcard release is the distinctive multiplier style; pong/kong/added-kong share the neutral base-action style; self-draw is the win style. Both themes use one component tree and the existing semantic tokens.
- On phone landscape, keep every button at least 44px high and position the action group so its actual button rectangles do not overlap the central discard zone or the hand.

Wrong:

```tsx
<button disabled={!legal.includes("DECLARE_WIN")}>自摸</button>
<button disabled={!legal.includes("CLAIM_PONG")}>碰</button>
```

Correct:

```tsx
const buttons = primaryActionButtons(room.legalActions);
return buttons.length === 0 ? null : buttons.map(renderActionButton);
```

Tests must cover empty actions, turn-action ordering, `碰 + 过`, `碰 + 杠 + 过`, `亮牌碰杠 + 过`, auxiliary-action exclusion, and wildcard versus non-wildcard selection. A rendering regression test must assert that `PASS_RESPONSE` uses `.primary-action-button.action-pass` and is absent from the auxiliary dock.

Wrong:

```tsx
const dockActions = legalActions.filter((action) => action === "PASS_RESPONSE");
```

Correct:

```tsx
const buttons = primaryActionButtons(legalActions); // includes PASS_RESPONSE last
const dockActions = legalActions.filter((action) => !isPrimaryGameAction(action));
```

This prevents the pass choice from becoming visually detached or clipped while pong/kong buttons remain visible above the hand.

## Accessibility

- Touch targets are at least 44 by 44 CSS pixels.
- All buttons have `type="button"` unless they intentionally submit a form.
- Focus remains visible in both themes.
- Respect `prefers-reduced-motion`.

## Hand selection and table motion

- Keep physical tile identity (`tile.id`) through selection and animation. A first press selects, a second press on the same ordinary tile may submit `DISCARD_TILE`, and pressing another tile switches selection.
- Route this decision through the pure `decideTilePress` helper. A wildcard never uses the second-press discard path; it remains selected for the explicit `RELEASE_WILDCARD` action.
- The synchronous event handler and the room controller both guard submissions. A disabled React render alone is not a sufficient duplicate-click lock because two input events can arrive before the next render.
- Keep a newly drawn tile outside the sorted hand until it leaves the hand. After the authoritative projection removes a tile, sort/render the next projection and animate wrapper elements with FLIP.
- FLIP and tile-entry effects are presentation only: measure after layout, animate `transform`/`opacity`, and never reorder or remove projection data from an animation callback.
- Treat initial mount, reconnect recovery, and `prefers-reduced-motion` as no-history states. Render the final projection immediately and do not replay old draw, discard, round-start, or special-tile effects.
- Put high-frequency timers in the smallest owning component. `TurnMarker` may update twice per second; it must not force the entire `GameTable` to re-render.

Required tests cover first/select, switch/select, second-press discard, wildcard protection, illegal phase, and synchronous lock behavior.

## Scenario: Persistent meld and compact settlement ownership

### 1. Scope / Trigger

Any change to player-station melds or the round-result modal must preserve one rendering owner and the authoritative settlement projection.

### 2. Signatures

```tsx
<PlayerStation player={player} landedMeldId={meldId} landedCategory={category} />

<RoundSettlementModal
  settlement={room.roundSettlement}
  players={room.players}
  wildcardKind={room.wildcardKind}
/>
```

### 3. Contracts

- `PlayerStation` owns persistent meld rendering for every seat, including the local player. `.self-area` owns only the local concealed hand and action controls.
- `.player-melds` is a constrained, wrapping full-width station row. A local meld must not be duplicated in a separate absolute row.
- Landed pong/kong feedback continues to target the persistent `MeldGroup` inside the station and respects reduced motion.
- The result header identifies winner plus hard/soft win, or draw. It does not repeat multiplier formula/payment cards above the player list.
- Each final-hand row renders authoritative concealed tiles, personal multiplier, explicitly labelled round delta and cumulative score. Bot-mode continue/leave actions remain available.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Player has no melds or released wildcards | Omit `.player-melds` |
| Local player gains a meld | Render it once inside their station |
| Four meld groups wrap | Keep groups inside the station and table viewport |
| Score change is absent | Display zero instead of calculating a score |
| Round is a draw | Keep four final-hand rows and any kong-derived round deltas |

### 5. Good/Base/Bad Cases

- Good: the local player's pong appears below their identity inside the same framed station.
- Base: a player without public state keeps the compact one-row station.
- Bad: rendering the local meld in both `PlayerStation` and `.self-area`, or rebuilding opponent final hands from counts.

### 6. Tests Required

- SSR presentation tests assert the local public-combination label occurs exactly once and no `.meld-row` exists.
- Settlement presentation tests assert four hands, four multiplier labels, four round labels and four cumulative labels, and absence of the removed upper formula/payment classes.
- Browser checks cover desktop and 844×390 landscape in both themes, station containment and reduced motion.

### 7. Wrong vs Correct

Wrong:

```tsx
{position !== 0 && <PlayerMelds />}
{self && <div className="meld-row"><PlayerMelds /></div>}
```

Correct:

```tsx
{player.melds.length > 0 && <div className="player-melds">{player.melds.map(renderMeld)}</div>}
```

## Common mistakes

- Do not use an array index as a tile key; physical `tile.id` is the identity.
- Do not optimistically remove a tile before the authoritative projection arrives.
- Do not fork discreet and premium theme markup.
- Do not keep both `click` and `dblclick` discard paths; their event sequence can submit twice or make touch behavior inconsistent.
- Do not use array order as animation history after reconnect; there is no trustworthy client-side transition to replay.

## Scenario: iOS dynamic viewport and installable shell

### 1. Scope / Trigger

Any change to root layout height, fixed game controls, safe-area padding, PWA metadata or service-worker caching must preserve browser and installed iOS landscape behavior.

### 2. Signatures

```text
viewport: width=device-width, initial-scale=1, viewport-fit=cover
CSS: --app-height, --safe-top, --safe-right, --safe-bottom, --safe-left
manifest: display=standalone, orientation=landscape, start_url=/
service worker exclusions: /api/*, /socket.io/*
```

### 3. Contracts

- `main.tsx` updates only `--app-height` from `visualViewport.height` (falling back to `innerHeight`) on resize, orientation change and page show.
- Fixed headers, the table and the bottom action dock consume shared height and safe-area variables. Do not mix new `100vh` calculations into child components.
- The production-only service worker may cache the app shell and same-origin static assets. API and Socket.IO remain network-only, and cached data is never a room-state source.
- Apple metadata and 180px/192px/512px icons ship from `apps/web/public` and must appear in `dist` after Vite build.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Safari address bar expands/collapses | Recompute `--app-height`; table controls stay inside the visual viewport |
| Device has a notch/home indicator | Apply `env(safe-area-inset-*)` to fixed edges |
| App is installed | Launch standalone in landscape with the declared icons/theme |
| API/Socket request occurs | Bypass service-worker cache entirely |
| Offline shell is available | Render the shell; room restoration may still fail clearly because gameplay requires network |

### 5. Good/Base/Bad Cases

- Good: at 844×390, game shell height is 390px and header + table + dock exactly fill it without document scrolling.
- Base: desktop browsers without safe-area insets resolve each inset to `0px`.
- Bad: using `100vh` for the table while the dock uses `visualViewport`; mobile Safari then clips or creates an extra scroll region.

### 6. Tests Required

- Run Web typecheck and production build; assert manifest, service worker and all three PNG icons exist in `apps/web/dist`.
- Browser-check desktop and phone landscape widths, verify no game-shell horizontal/vertical overflow, and inspect console errors.
- Verify the service worker and manifest return 200 from the production server; real-device acceptance still includes Safari and “Add to Home Screen”.

### 7. Wrong vs Correct

Wrong:

```css
.game-shell { height: 100vh; }
.action-dock { bottom: 0; }
```

Correct:

```css
.game-shell { height: var(--app-height); }
.action-dock {
  height: calc(var(--action-dock-height) + var(--safe-bottom));
  padding-bottom: calc(6px + var(--safe-bottom));
}
```
