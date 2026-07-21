# Mini-program session auth

The WeChat mini-program client cannot rely on browser `Set-Cookie` the way `apps/web` does. The server supports the **same anonymous session table** through dual credentials.

## Credential shapes

| Client | How to send | How token is issued |
|--------|-------------|---------------------|
| Web (`apps/web`) | Cookie `huanghuang_session` (existing) | `Set-Cookie` on create/join |
| Mini-program | `Authorization: Bearer <token>` **or** header `X-Session-Token: <token>` | Response header `X-Session-Token` and/or JSON `sessionToken` from `POST /api/session` |

Priority when multiple are present: **Bearer → `X-Session-Token` → cookie**.

## HTTP APIs

### `POST /api/session`

Body (optional): `{ "nickname": "牌友" }`

Response:

```json
{
  "sessionId": "…",
  "nickname": "牌友",
  "sessionToken": "…"
}
```

Also sets cookie (for web) and `X-Session-Token` response header.  
If the request already carries a valid Bearer/header/cookie, nickname is updated and the same token is echoed when known.

### `GET /api/session`

Requires auth (Bearer / header / cookie). Returns `{ sessionId, nickname }` or `401 UNAUTHENTICATED`.

### Room routes

Unchanged paths (`POST /api/rooms`, join, ready, …).  
`ensure` on create/join accepts header tokens and still sets the cookie for browsers.  
`resolve` on other routes accepts Bearer / `X-Session-Token` / cookie.

## Socket.IO

Handshake auth (preferred for mini-program):

```js
io(apiOrigin, {
  auth: { token: sessionToken },
  transports: ["websocket", "polling"],
});
```

Also accepted: `Authorization: Bearer …`, `X-Session-Token`, or cookie (web).

## Optional WeChat login

`POST /api/auth/wechat` with `{ "code": "<wx.login code>", "nickname": "…" }`.

- Requires env `WECHAT_APP_ID` and `WECHAT_APP_SECRET`.
- If unset → `501 WECHAT_AUTH_DISABLED`.
- On success → same `{ sessionId, nickname, sessionToken }` shape (MVP does not yet persist openId).

## Security notes

- Only **hashes** of tokens are stored (`anonymous_sessions.token_hash`).
- Never log raw tokens, cookies, or WeChat secrets.
- Prefer HTTPS in production; mini-program 合法域名 must allow the API host and WSS.

## Client storage suggestion

Persist `sessionToken` in WeChat storage; send on every REST call and Socket handshake. Clear on explicit logout (future) or when server returns `401`.
