# Frontend Quality Guidelines

## Required checks

```bash
pnpm lint
pnpm --filter @huanghuang/web typecheck
pnpm --filter @huanghuang/web build
pnpm test
```

Root `pnpm test` runs the monorepo vitest suite (engine, server, web pure modules). Prefer adding pure-module tests next to the helper rather than only end-to-end browser tests.

## Required patterns

- Render semantic controls (`button`, `main`, `role="status"`, etc.) and preserve a **44px** minimum touch target on primary actions.
- Use **physical tile IDs** as React keys for hands, melds, and discards.
- Keep the **discreet** theme fully functional before adding premium presentation. Both themes share one component tree; only CSS tokens / artwork change via `data-theme`.
- Verify phone landscape (e.g. 844×390), desktop, keyboard focus, and `prefers-reduced-motion`.
- Extract legal-action presentation into pure modules:
  - `actionButtons.ts` — dock button models / image map
  - `actionEligibility.ts` — hand highlights, concealed/added kong payloads
  - `handInteraction.ts` — select vs confirm tile press
  - `playerActionNotice.ts` — peer action banners
- Colocate unit tests for those modules (`*.test.ts`). `GameTable.presentation.test.ts` covers presentation-facing pure helpers exported from or used by the table.
- Command path: `createCommand` → Socket emit with ack timeout → on uncertainty request full snapshot via `roomApi.get`. Never invent acceptance.

## Forbidden patterns

- Client-side score, win-type, wall shuffle, or legal-action **authority**. Presentation may highlight tiles from projection fields only.
- Separate business components for the two themes.
- Large blur filters or layout-property animations on the table (prefer `transform` / `opacity`; `box-shadow` only for the documented action-feedback exception in `component-guidelines.md`).
- Swallowing command rejection or recovery errors (surface `error` / `notice` from `useRoom`).
- Opening a second Socket for commands (triggers disconnect trustee behavior).
- Deep-importing game-engine or server code into the web app.

## Current baseline

`HomeScreen.tsx`, `GameTable.tsx`, and `styles.css` implement invite, waiting, and playable-table flows. Default theme is discreet (`huanghuang-theme` localStorage). Game shell artwork uses optimized `background.optimized.jpg` under `.game-shell`; home/waiting surfaces stay free of that full-bleed table art. Action dock uses optimized button PNGs from `assets/buttons/optimized/`.

## Review checklist (quick)

- [ ] Types imported from `@huanghuang/protocol` where shared
- [ ] No new rule formula in the browser
- [ ] Pure helper extracted + tested if branching grew inside JSX
- [ ] Touch targets and focus styles still work on mobile
- [ ] Theme toggle does not fork component trees
