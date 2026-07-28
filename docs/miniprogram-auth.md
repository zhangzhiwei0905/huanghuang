# Mini-program session auth

The WeChat mini-program client cannot rely on browser `Set-Cookie` the way `apps/web` does. The server supports dual credentials over the legacy-named `anonymous_sessions` table. A row with a persisted `wechat_open_id` is the stable real-account identity used by competitive profiles, matchmaking, rank settlement, and achievements.

## Credential shapes

| Client           | How to send                                                              | How token is issued                                                                   |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Web (`apps/web`) | Cookie `huanghuang_session` (existing)                                   | `Set-Cookie` on create/join                                                           |
| Mini-program     | `Authorization: Bearer <token>` **or** header `X-Session-Token: <token>` | Response header `X-Session-Token` and/or JSON `sessionToken` from `POST /api/session` |

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

## WeChat login

`POST /api/auth/wechat` supports two flows:

- `{ "code": "<wx.login code>", "resumeOnly": true }` rotates the token for an existing openid without overwriting its saved nickname/avatar. Unknown openids return `404 WECHAT_PROFILE_REQUIRED`.
- `{ "code": "<wx.login code>", "nickname": "…", "avatarUrl": "…" }` creates or updates the persistent WeChat profile after explicit native profile capture.

Requirements and responses:

- Requires env `WECHAT_APP_ID` and `WECHAT_APP_SECRET`.
- If unset → `501 WECHAT_AUTH_DISABLED`.
- The openid is persisted under a unique index and never returned to clients.
- Success returns `{ sessionId, nickname, avatarUrl, sessionToken }`; returning logins reuse the same `sessionId` while rotating the token.
- Only a session with `wechat_open_id` may use competitive profile or matchmaking routes.

## Security notes

- Only **hashes** of tokens are stored (`anonymous_sessions.token_hash`).
- Never log raw tokens, cookies, or WeChat secrets.
- Prefer HTTPS in production; mini-program 合法域名 must allow the API host and WSS.

## Client storage suggestion

Persist `sessionToken` in WeChat storage; send it on every REST call and Socket handshake. Clear it on explicit logout or when the server returns `401`.
