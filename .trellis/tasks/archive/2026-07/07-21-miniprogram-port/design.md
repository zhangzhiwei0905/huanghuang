# Design: Miniprogram port

## Architecture

```text
┌─────────────────────┐     HTTPS REST + Socket.IO      ┌──────────────────────┐
│ apps/miniprogram    │ ──────────────────────────────► │ apps/server          │
│ (Taro React / WeChat)│   Authorization: Bearer <tok>  │ SessionService       │
└─────────────────────┘                                 │ RoomService          │
         │                                                │ SQLite               │
         │ types / pure helpers                           └──────────┬───────────┘
         ▼                                                           │
┌─────────────────────┐                                              │
│ packages/protocol   │ ◄────────────────────────────────────────────┘
│ (shared DTOs/Zod)   │         same as apps/web
└─────────────────────┘

apps/web continues to use cookie session + same RoomService.
```

## Boundaries

| Layer | Responsibility |
|-------|----------------|
| `apps/miniprogram` | WeChat UI, Taro request/socket, storage of session token, presentation pure helpers |
| `apps/server` | Auth dual-path, rooms, projections, commands (unchanged authority) |
| `packages/protocol` | Shared types/schemas; add auth DTOs only if needed (e.g. session issue response) |
| `packages/game-engine` | Unchanged; not imported by mini-program client |
| `apps/web` | Must keep working with cookies after server auth changes |

## Auth & session data flow

1. Mini-program cold start: read token from Taro storage.
2. If missing: call new or extended session endpoint (or first create/join with nickname) that **returns** `{ sessionToken, sessionId?, nickname }` and stores token.
3. All REST: `Authorization: Bearer <token>` (preferred) or agreed custom header; server `resolve` checks header then cookie.
4. Socket.IO: pass token in `auth: { token }` (or extraHeaders if supported in WeChat build); server middleware resolves token hash like cookie path.
5. Optional: `POST /api/auth/wechat` with `wx.login` `code` → server exchanges via WeChat API (appId/secret from env) → bind/create session by openId; returns same token shape.
6. Web: unchanged cookie `ensure`/`resolve`; regression tests required.

### Storage model impact

- Today `anonymous_sessions` stores `token_hash` only (cookie value hashed). Bearer token can be the **same raw token** class (base64url random) hashed identically—no need for a second identity system for MVP.
- Optional openId: add nullable `wechat_openid` column (additive migration) or side table; MVP may ship token-only first and openId as follow-up inside `mp-server-auth` if timeboxed.

## Client structure (target)

```text
apps/miniprogram/
  config / project.config
  src/
    app.config.ts
    app.tsx
    api/          # REST + token injection
    socket/       # single shared socket
    pages/        # home, room/table
    components/   # tile, table chrome
    lib/          # pure helpers (ported or shared)
```

Prefer **copy-or-extract pure modules** over a new shared package on day one unless duplication hurts; if extracting, `packages/game-ui-logic` is optional later—not required for MVP.

## Realtime

- Keep existing events: `room:update`, `room:chat` (client may ignore chat), `game:command`, subscribe ack with projection.
- `room:update` still triggers full snapshot GET with token auth.
- Command idempotency (`requestId`, `expectedVersion`) unchanged.

## Compatibility

- Web production deploy must not break: cookie attributes, Socket cookie auth, static hosting.
- Mini-program requires WSS to same host; Caddy/existing TLS assumed.
- CORS: browser CORS less relevant for mini-program; still keep Socket CORS sane for web.

## Risks & trade-offs

| Risk | Mitigation |
|------|------------|
| Socket.IO on WeChat flaky | Pin known-good client build; test reconnect; fall back to poll only if forced and server allows |
| Cookie vs Bearer double paths bugs | Centralize `resolveRequestAuth` unit tests; E2E web smoke after change |
| Landscape on WeChat | Page orientation in `app.json` / page config; document limitations |
| Token leakage in logs | Reuse logging guidelines—never log raw tokens |
| WeChat appId/secret for openId | Optional path; feature-flag if secrets absent |
| Large UI rewrite | Core path only; one theme; reuse tile assets where packaging allows |

## Rollout / rollback

- Feature is additive: token auth + new client. Rollback = disable mini-program distribution; server token paths can remain (harmless) or gate optional WeChat route via env.
- Do not remove cookie auth in this project.

## Branching

- Implementation branch: `miniprogram` from latest `main`.
- Children commit on that branch (or short-lived sub-branches merged into `miniprogram`).
