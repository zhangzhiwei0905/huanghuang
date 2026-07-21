# Server token auth for miniprogram

**Parent:** `07-21-miniprogram-port`  
**Ordering:** First child. No hard code dependency on Taro app.

## Goal

Let WeChat mini-program clients authenticate to the existing `apps/server` without browser cookies, while keeping Web cookie sessions working.

## Requirements

- S1. Resolve session from `Authorization: Bearer <token>` (or documented equivalent header) on HTTP routes that today use `sessions.resolve` / `ensure`.
- S2. `ensure` (or dedicated session issue path) must return the raw token to non-cookie clients (JSON body field, e.g. `sessionToken`) so mini-programs can persist it; Web may keep Set-Cookie only.
- S3. Socket.IO middleware accepts the same token (handshake `auth.token` and/or header), not only `cookie`.
- S4. Web cookie path remains green: existing browser flows and tests.
- S5. Optional: `wx.login` code exchange endpoint behind env (`WECHAT_APP_ID` / `WECHAT_APP_SECRET`); if unset, endpoint returns clear 501/disabled without breaking token-only mode.
- S6. Never log raw tokens; store only hashes (existing pattern).

## Acceptance Criteria

- [x] HTTP create/join/get room works with Bearer token and no cookie. (resolve/ensure dual path + /api/session)
- [x] Socket subscribe + command works with token auth and no cookie. (handshake auth.token / header / cookie)
- [x] Web cookie-based session still works (automated and/or manual smoke). (cookie path preserved; unit tests)
- [x] Regression: `pnpm test` / typecheck/lint for server packages pass.
- [x] Protocol or API docs note token field names for the mini-program client. (see docs/miniprogram-auth.md)

## Out of scope

- Building the Taro UI.
- Formal WeChat publish.
- Removing cookie auth.
