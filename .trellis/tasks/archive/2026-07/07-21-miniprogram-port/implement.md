# Implement plan: Miniprogram port (parent)

## Order

1. **Planning gate (this parent)** — PRD/design/implement reviewed; do **not** `task.py start` on parent for coding.
2. **`07-21-mp-server-auth`** — start first; land Bearer/header + Socket auth; Web cookie regression; optional WeChat login endpoint stub/real.
3. **`07-21-mp-taro-scaffold`** — can start once auth response shape is sketched (or in parallel with mock token); monorepo Taro WeChat app builds in devtools.
4. **`07-21-mp-core-client`** — after scaffold + auth available against local/prod API.
5. **`07-21-mp-integration`** — real device, docs, close parent ACs.
6. Parent archive when all children archived and AC1–AC7 checked.

## Branch

```bash
git checkout main && git pull   # if remote used
git checkout -b miniprogram
```

Create branch at first implementation start (`mp-server-auth` or scaffold—whichever starts first).

## Validation (integration level)

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# plus WeChat devtools build for apps/miniprogram
# manual: web cookie smoke (create room in browser)
# manual: mini-program core path on simulator + real device
```

## Per-child definition of done

See each child's `prd.md`. Parent closes only when integration child signs AC1–AC7.

## Rollback points

- After server-auth: web must still pass tests; revert token middleware if web broken.
- After scaffold: removable app package without affecting web.
- After core-client: client-only; server remains.
