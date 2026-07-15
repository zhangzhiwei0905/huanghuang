# Frontend Quality Guidelines

## Required checks

```bash
pnpm lint
pnpm --filter @huanghuang/web typecheck
pnpm --filter @huanghuang/web build
```

## Required patterns

- Render semantic controls and preserve a 44px minimum touch target.
- Use physical tile IDs as React keys.
- Keep the discreet theme fully functional before adding premium presentation.
- Test phone landscape sizes, desktop, keyboard focus, and reduced motion.

## Forbidden patterns

- Client-side score, win-type, wall, or legal-action calculation.
- Separate business components for the two themes.
- Large blur filters or layout-property animations on the table.
- Swallowing command rejection or recovery errors.

## Current baseline

`HomeScreen.tsx`, `GameTable.tsx` and `styles.css` implement the invite, waiting and playable table flows. The discreet low-saturation theme is the default; the premium theme changes CSS tokens without changing the component tree or server subscription.
