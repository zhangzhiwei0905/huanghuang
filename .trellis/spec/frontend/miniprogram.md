# Mini-Program (Taro/WeChat) Guidelines

> Conventions for `apps/miniprogram`. Everything here was learned the hard way
> during the landscape-UX rounds (task `07-21-mp-landscape-ux`); follow them
> before shipping any style or UI change.

---

## WXSS / WebView Compatibility

### Don't: `color-mix()`

**Problem**: The devtools simulator WebView (nwjs/Chromium 91) and low-end XWeb
runtimes do not support `color-mix()`. The declaration is dropped silently —
translucent chrome (leave button, info capsule, hand tray) renders with **no
background at all**, leaving white text on the light table art.

```scss
// Don't
background: color-mix(in srgb, #14180f 55%, transparent);

// Do — precompute the static equivalent
background: rgb(20 24 15 / 62%);
```

Safe modern syntax already in use and verified working: `rgb(r g b / a%)`,
`inset: 0`, `max()`, `@keyframes`, `env(safe-area-inset-*)`.

### Gotcha: native `<button>` collapses `width: auto`

WeChat's native button can render a 2-CJK-character label as a **circle with
wrapped text** even with `white-space: nowrap`. Force an explicit width:

```scss
.leave-fab {
  min-width: 12vmin !important;
  width: 12vmin !important;
  white-space: nowrap !important;
}
```

### Layout math: px floors beat vmin on phones

Tiles use `width: 3.6vmin; min-width: 20px`-style rules. On every real phone in
landscape (height ≤ ~555 CSS px) the **min-px floor wins**. Any container
capacity calculation ("6 tiles per row") must be done in px, not vmin, and the
container needs its own floor: `width: max(26vmin, 152px)`.

### Clipping: `overflow-x: auto` clips vertically too

The hand tray scrolls horizontally; anything drawn above tile tops (selection
raise, hint labels, the drawn-tile "摸" marker) is clipped unless the container
reserves headroom (`padding-top: 2.6vmin`). Don't position children above the
container's content box.

### Gotcha: `wx.request` always sends `Content-Type: application/json`

This cannot be suppressed from the client — not by omitting the header key,
not by setting it to `""`. Both were tried and verified against the live mp
runtime (`mini.evaluate` calling `wx.request` directly, bypassing Taro): the
server still received `application/json` and 400'd on a bodyless DELETE
either way. A client-side "only set Content-Type when there's a body" fix
(`src/api/http.ts`) **looks correct in code review but does nothing at
runtime** — don't trust it without a live probe.

The real fix has to be server-side: `apps/server/src/index.ts` overrides
Fastify's JSON `addContentTypeParser` to treat an empty body as `undefined`
instead of throwing `FST_ERR_CTP_EMPTY_JSON_BODY`. Any bodyless
POST/PATCH/DELETE route needs this — don't reintroduce a client-only "fix"
for the same symptom.

---

## Projection-Derived UI State

### Pattern: diffing discard tails for "most recent discard"

`RoomProjection` has no "who just discarded" field. `useRecentDiscardId`
(`src/pages/room/index.tsx`) diffs each seat's discard pile across updates.
**Contract**: only a pile that *grew* promotes its tail to "recent"; a shrink
(pong/kong claim) must clear a highlight that points at a tile no longer on the
table. Tracking tail-id alone (without length) reintroduces the stale-highlight
bug. Mirrors `apps/web/src/components/GameTable.tsx:766` but must be persistent-
safe because mp keeps the highlight until the next discard.

---

## Devtools Automation (miniprogram-automator)

### Working recipe

1. Enable 设置 → 安全设置 → 服务端口 in devtools (creates
   `~/Library/Application Support/微信开发者工具/<hash>/Default/.ide` with the
   HTTP port). Without it every `cli` invocation hangs with no output.
2. `cli auto --project apps/miniprogram --auto-port 9420`, then
   `automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" })`.
3. Drive game state **server-side**, not through the UI: create session + room
   via the HTTP API, then
   `mini.evaluate((tok, rm) => { wx.setStorageSync("huanghuang_session_token", tok); wx.setStorageSync("huanghuang_open_room", rm); }, token, room)`
   and `mini.reLaunch("/pages/room/index")`. BOT rooms start in `PLAYING` and
   auto-play on action-deadline timeouts, so a full round settles by itself
   (~3–5 min) — poll `GET /api/rooms/:code` for `stage === "ROUND_RESULT"`.

### Don't: element queries

`page.$()` / `page.$$()` **hang forever** against this Taro build and poison
the automation session — after one stuck query, every later command (even
`screenshot`) times out. Recovery: `cli close --project …` then `cli auto`
again. Use screenshots + server-side state assertions instead; wrap every
automator call in a `Promise.race` timeout.

### Don't: rebuild during a capture session

`taro build` rewrites `dist/`, devtools recompiles, and the simulator resets to
the entry page mid-capture (you'll screenshot the home page instead of the
room). Finish all builds before starting a capture run.

---

## Production Rollout (real device, not devtools)

### AppID: test accounts (测试号) cannot whitelist server domains

`project.config.json`'s `appid` must be a **properly registered** mini-program
(individual or enterprise registration via `mp.weixin.qq.com`'s normal
signup), not a 测试号 (sandbox test account obtained from the "sandbox" quick-
start flow). Test accounts either lack the "服务器域名" (server domain)
settings page entirely or don't enforce it — either way, `wx.request` /
`wx.connectSocket` from a real device fail with `request:fail url not in
domain list` regardless of what you configure, while the devtools simulator
keeps working fine (`urlCheck: false` in `project.config.json` bypasses
domain validation there, masking the problem). If devtools works but a real
device doesn't, check the appid type before anything else.

Individual registration doesn't require the paid "认证" step — that only
unlocks payment/advanced APIs, unrelated to server domain whitelisting.

### Required mp.weixin.qq.com config once you have a real AppID

开发管理 → 开发设置 → 服务器域名: add the production origin to **three**
lists — `https://<domain>` under request合法域名, `wss://<domain>` under
socket合法域名 (this project uses `socket.io-mp`, which is a WebSocket
client; missing the socket entry breaks realtime even if REST calls work),
and `https://<domain>` under **uploadFile合法域名** (a separate whitelist
from request合法域名 — `Taro.uploadFile`/`wx.uploadFile`, e.g. the
`chooseAvatar` → `/api/upload/avatar` flow, checks this list specifically;
missing it fails with the same `request:fail url not in domain list` shape
as the other two, and the devtools simulator masks it the same way
(`urlCheck: false` bypasses domain validation there) — same failure class
as the appid/domain gotcha above, just a third list to remember). Changes
take a few minutes to propagate to a real device; a full app restart (not
just backgrounding) is sometimes needed to pick them up.

### Building for production

```bash
TARO_APP_API_BASE=https://<domain> pnpm --filter @huanghuang/miniprogram build:weapp
```

Verify the URL actually landed before shipping — it ends up in
`dist/common.js`, not `dist/app.js`:

```bash
grep -o '"https://<domain>"' apps/miniprogram/dist/common.js
```

### Gotcha: swallowed network errors mask domain-whitelist failures

`Taro.request` rejects with a plain `{ errMsg: string }` when the platform
blocks the request before it reaches the server (wrong domain, DNS, TLS,
timeout) — this is not an `Error` instance and not an `ApiError`. Any catch
block that does `cause instanceof ApiError ? cause.code : "UNKNOWN"` and maps
to a generic label (e.g. `src/pages/index/index.tsx`'s `submit()`) throws
away the one piece of information that tells you whether it's a server bug
or a client/platform-level block. Always surface `cause.errMsg` (or
`cause.message`) as a fallback instead of a fixed generic string.

### Ignorable noise: `routeDone with a webviewId ... is not found`

A `SystemError (appServiceSDKScriptError)` specifically during **真机调试**
(devtools attached to a real device over the debug bridge), triggered by
`Taro.navigateTo` page transitions, often worse with `compileHotReLoad: true`
in `project.private.config.json`. This is a known instability in the debug
bridge's own webview-lifecycle tracking, not an application bug — confirmed
by testing plain 预览 (scan-code preview, no debug bridge attached), which
completes the same navigation cleanly. Don't chase this in application code;
if navigation genuinely fails (not just a console error) even under plain
预览, that's a real bug — but real 真机调试-bridge noise should be dismissed
once 预览 is confirmed clean.

---

## Verification Commands

```bash
cd apps/miniprogram && pnpm typecheck && pnpm build:weapp
pnpm exec prettier --check "apps/miniprogram/src/**/*.{ts,tsx,scss}"   # repo root
```

ESLint currently excludes `apps/miniprogram` (pre-existing repo config).
