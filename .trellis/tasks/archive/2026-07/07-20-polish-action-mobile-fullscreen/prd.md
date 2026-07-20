# Polish action touch feedback and mobile fullscreen

## Goal

Polish the illustrated in-game action controls and mobile landscape game shell so the controls feel like standalone artwork and the table reads as one continuous full-screen surface.

## Background

- The illustrated primary actions are rendered as borderless, rounded `<button>` elements, but the shared button focus rule still applies a browser outline and the controls do not disable WebKit's rectangular tap highlight.
- The table artwork currently belongs only to `.table-surface`; `.game-header` and `.action-dock` keep opaque panel backgrounds. In phone landscape this creates visually disconnected light bands above and below the table.
- The viewport already uses `viewport-fit=cover`, `--app-height`, and safe-area insets. The game layout and action availability logic do not need to change.

## Requirements

- Remove the native rectangular touch highlight from illustrated primary-action buttons.
- Preserve an accessible keyboard focus indicator, shaped to the rounded button silhouette instead of a rectangular browser outline.
- Use scale/brightness feedback for press interaction without revealing the button's rectangular hit box.
- Extend the table artwork across the entire `.game-shell`, including the header, dock, and safe-area regions.
- Keep header and dock controls legible with lightweight translucent treatment over the continuous artwork.
- Preserve current game layout, action behavior, desktop presentation, both visual themes, and reduced-motion behavior.

## Acceptance Criteria

- [x] Tapping any illustrated action (including 出牌、放赖、碰、杠、补杠、胡牌、过) shows no rectangular native highlight or outline.
- [x] Keyboard navigation still gives each illustrated action a clearly visible rounded focus indicator.
- [x] At phone-landscape viewport sizes, the game fills the visual viewport with no white/light strips above or below the table; background continuity includes safe-area insets.
- [x] Header text/buttons, status text, and chat controls remain readable in both low and premium themes.
- [x] The page has no horizontal or vertical overflow at the representative 844×390 landscape viewport.
- [x] Existing web lint, tests, type-check, and production build pass.

## Technical Notes

- Prefer CSS-only changes in `apps/web/src/styles.css`; change component logic only if evidence shows CSS cannot satisfy the requirements.
- Move theme-specific artwork/overlay ownership from `.table-surface` to `.game-shell`, then make the table, game header, and action dock visually continuous.
- Keep an opaque/translucent fallback color beneath the background image.

## Out of Scope

- Changing Mahjong action rules, action combinations, button labels, or image artwork files.
- Redesigning the waiting room, home page, portrait-orientation notice, or non-game buttons.
- Changing the overall table geometry or compact landscape sizing.
