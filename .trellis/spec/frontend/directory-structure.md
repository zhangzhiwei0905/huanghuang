# Frontend Directory Structure

## Current layout

The browser application lives in `apps/web`. Cross-layer payloads come from `packages/protocol`; reusable visual primitives will live in `packages/ui` when they have at least two consumers.

```text
apps/web/
├── index.html
├── vite.config.ts
└── src/
    ├── api.ts
    ├── App.tsx
    ├── components/
    │   ├── GameTable.tsx
    │   ├── HomeScreen.tsx
    │   └── MahjongTile.tsx
    ├── hooks/useRoom.ts
    ├── main.tsx
    └── styles.css
```

## Conventions

- Keep route/page composition under `apps/web/src`.
- Import command and projection types from `@huanghuang/protocol`; do not redefine server payloads in the app.
- Keep game rules out of the browser. The client renders `legalActions` and sends intent.
- Use kebab-case for folders, PascalCase for component files, and `useX` for hook files.
- Promote code into `packages/ui` only after a real shared use exists.

## Current example

`apps/web/src/main.tsx` owns the root render and throws when `#root` is absent. `useRoom.ts` owns the authoritative projection and Socket connection. `GameTable.tsx` renders the same component tree for both themes, while `styles.css` switches tokens through `data-theme`.

## Forbidden patterns

- Do not import from `apps/server` or database modules.
- Do not create a parallel tile, seat, command, or score type in the frontend.
- Do not place server snapshots into scattered component-local state.
