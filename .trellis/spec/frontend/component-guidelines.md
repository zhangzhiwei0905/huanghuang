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
- Animate only `transform`, `opacity`, and `box-shadow` for table actions. `box-shadow` is scoped to the pong/kong/wildcard-release action-feedback exception (see below) — do not use it to add ambient shadows/glow elsewhere.
- A control must have a visible text or accessible name; color alone cannot communicate wildcard or disabled state.

## Action-feedback animation (pong / kong / wildcard release)

- Both themes use one shared animation intensity for these three action categories; do not fork per-theme strength. This is a deliberate exception to the low-key theme's general "no glow/no game-y animation" rule (see parent task `07-15-huanghuang-web-game-plan/prd.md` R6) — the exception is scoped to these three actions only.
- Classify `PlayerActionNotice["action"]` (from `playerActionNotice.ts`) into exactly one of three CSS category classes before rendering: `action-pong`, `action-kong` (covers all four kong-family meld kinds: `EXPOSED_KONG`/`CONCEALED_KONG`/`ADDED_KONG`/`INDICATOR_PONG_KONG`), `action-wildcard`. Do not change `playerActionNotice.ts`'s detection logic itself to add per-action styling — keep detection and presentation separate.
- Apply the same category class in two places so the effect reads consistently: the transient floating notice (`.player-action-tiles`) and a short-lived `is-landed` highlight (~600–900ms, auto-cleared via `setTimeout`, same pattern as the notice's own dismiss timer) on the tile/meld that just became persistent (public meld row, wildcard tag, or the acting player's own hand meld row).
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

## Accessibility

- Touch targets are at least 44 by 44 CSS pixels.
- All buttons have `type="button"` unless they intentionally submit a form.
- Focus remains visible in both themes.
- Respect `prefers-reduced-motion`.

## Common mistakes

- Do not use an array index as a tile key; physical `tile.id` is the identity.
- Do not optimistically remove a tile before the authoritative projection arrives.
- Do not fork discreet and premium theme markup.
