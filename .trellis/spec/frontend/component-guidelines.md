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

## Accessibility

- Touch targets are at least 44 by 44 CSS pixels.
- All buttons have `type="button"` unless they intentionally submit a form.
- Focus remains visible in both themes.
- Respect `prefers-reduced-motion`.

## Common mistakes

- Do not use an array index as a tile key; physical `tile.id` is the identity.
- Do not optimistically remove a tile before the authoritative projection arrives.
- Do not fork discreet and premium theme markup.
