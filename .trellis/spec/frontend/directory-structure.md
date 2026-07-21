# Frontend Directory Structure

## Current layout

The browser application lives in `apps/web`. Cross-layer payloads come from `packages/protocol`. There is no `packages/ui` yet; promote a visual primitive only after a second real consumer appears.

```text
apps/web/
├── index.html
├── vite.config.ts
├── public/icons/              # PWA / brand icons served as static assets
└── src/
    ├── main.tsx               # Root mount, viewport/safe-area sync
    ├── App.tsx                # Room restore, theme preference, screen switch
    ├── api.ts                 # REST room API + createCommand helper
    ├── api.test.ts
    ├── styles.css             # Tokens + layout; theme via data-theme
    ├── assets/
    │   ├── background.png
    │   ├── background.optimized.jpg
    │   ├── icon.png
    │   ├── buttons/           # Source + optimized action button art
    │   └── tiles/             # wan/tiao/tong SVGs
    ├── hooks/
    │   └── useRoom.ts         # Socket, projection, mutations, pending lock
    └── components/
        ├── HomeScreen.tsx     # Create / join lobby
        ├── GameTable.tsx      # Waiting + playable table shell
        ├── MahjongTile.tsx    # Tile face / selection chrome
        ├── actionButtons.ts   # Legal-action → dock button models
        ├── actionEligibility.ts # Pure per-tile highlight / kong payloads
        ├── handInteraction.ts # Pure tile-press selection decisions
        ├── playerActionNotice.ts # Detect peer meld/release notices
        └── *.test.ts          # Colocated pure-module / presentation tests
```

## Ownership

| Area | Owner | Notes |
|------|-------|-------|
| Authoritative room state + Socket | `hooks/useRoom.ts` | One connection; commands reuse it |
| REST room lifecycle | `api.ts` (`roomApi`) | create/join/ready/settings/leave/dissolve/continue |
| Command envelope construction | `api.ts` (`createCommand`) | Fresh `requestId` + `expectedVersion` |
| Table composition / chrome | `GameTable.tsx` | Props in, no Socket imports |
| Pure presentation helpers | `actionButtons.ts`, `actionEligibility.ts`, `handInteraction.ts`, `playerActionNotice.ts` | Unit-tested; no React |
| Tile artwork URL | `MahjongTile.tsx` | `import.meta.glob` over `assets/tiles` |
| Theme preference | `App.tsx` + `localStorage` key `huanghuang-theme` | `discreet` \| `premium` |

## Conventions

- Keep route/page composition under `apps/web/src`.
- Import command and projection types from `@huanghuang/protocol`; do not redefine server payloads in the app.
- Keep game rules out of the browser. The client renders `legalActions` and sends intent. The only client-side “derivation” allowed is presentation/highlight helpers over data already in the projection (see `actionEligibility.ts`).
- Use kebab-case for folders, PascalCase for component files, `useX` for hook files, and camelCase pure helper modules colocated under `components/`.
- Colocate tests as `name.test.ts` next to the module under test.
- Promote code into `packages/ui` only after a real shared use exists.

## Current example

`apps/web/src/main.tsx` owns the root render and throws when `#root` is absent. `useRoom.ts` owns the authoritative projection and Socket connection. `GameTable.tsx` renders the same component tree for both themes, while `styles.css` switches tokens through `data-theme` on `document.documentElement`. Action dock mapping lives in `actionButtons.ts`, not inline in JSX.

## Forbidden patterns

- Do not import from `apps/server`, `packages/game-engine`, or database modules.
- Do not create a parallel tile, seat, command, or score type in the frontend.
- Do not place server snapshots into scattered component-local state.
- Do not bury legal-action → button mapping or tile-eligibility logic inside large JSX components; extract pure modules with tests.
