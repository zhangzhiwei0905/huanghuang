# Implement plan

1. `mp-ui-assets` — copy assets, tile + button components, theme SCSS, smoke on home.
2. `mp-ui-table` — rebuild home + room pages to web-like layout; wire actions/hand.
3. `mp-friend-room` — invite/copy, lobby polish, two-client friend QA notes.
4. Parent AC check + archive.

Validation:
```bash
pnpm --filter @huanghuang/miniprogram typecheck
pnpm --filter @huanghuang/miniprogram build:weapp
pnpm test && pnpm lint
```
