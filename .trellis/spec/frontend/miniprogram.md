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

### Landscape viewport: use `100vh`, not a pure percentage chain

Taro's generated page wrappers do not reliably propagate a `page { height:
100% }` chain to the React page root. In WeChat DevTools this can collapse a
full-screen scene to zero height even though every authored ancestor declares
`height: 100%`.

For a landscape game page, keep `disableScroll: true`, set the scene root to
`height: 100vh; max-height: 100vh; overflow: hidden`, and keep the global page
overflow hidden. Reserve component-level overflow only where it is genuinely
needed, such as the hand tray's horizontal fallback.

For the room page, use `navigationStyle: "custom"` together with
`pageOrientation: "landscape"` and `disableScroll: true` to remove the native
white navigation strip. The WeChat capsule remains platform-owned even in
custom-navigation mode: read `Taro.getMenuButtonBoundingClientRect()` at
runtime, expose a right-inset CSS custom property, and keep the room capsule
and exit control outside that reserved area. Never hide or paint over the
capsule.

### Landscape notch: safe-area env values need a visual floor

In the DevTools landscape simulator, the black left notch can still be drawn
while `env(safe-area-inset-left)` resolves to `0`. Edge-aligned player cards
and controls therefore need both the platform inset and a phone-height-based
floor:

```scss
left: max(10vmin, calc(1.2vmin + env(safe-area-inset-left)));
```

Apply this to critical left-edge content, then verify it against a screenshot
that includes the native navigation bar and simulator notch. Do not assume the
safe-area environment value alone proves the content is visible.

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

### Native selector for room turn duration

The create-room form uses WeChat's native `Picker` with a local
`TurnTimeoutSeconds[]` tuple containing `20 | 25 | 30`. Keep it type-constrained
to the shared protocol union. Do not import protocol runtime constants here:
Taro can erase protocol type imports but its Webpack resolver cannot follow the
protocol package's ESM `.js` re-export paths for runtime values.

Send the selected value through `roomApi.create`. The client only chooses the
room setting; the server remains responsible for producing
`actionDeadlineAt`. Show the projected value in the waiting-room toolbar and
playable-table capsule so every member can confirm the room rule.

---

## Native Profile Capture

WeChat does not let a mini-program silently read the current avatar or
nickname. The supported flow requires explicit user interaction:

- The logged-out home may present one `微信登录` entry and open profile capture
  in a second-stage layer, but that entry must not imply silent authorization.
  First call `/api/auth/wechat` with `{ code, resumeOnly: true }`: a stored
  openid returns its saved profile, while `404 WECHAT_PROFILE_REQUIRED` opens
  the layer. Keep `chooseAvatar` and `Input type="nickname"` as two explicit
  native user actions for that first-time path, then close the layer only after
  authentication succeeds.
- After authentication, render the resolved avatar and nickname together in a
  persistent account area. Keep logout as a separate account action, clear the
  stored session immediately, and return to the single login entry; do not hide
  logout inside room creation/join forms.
- A `Button openType="chooseAvatar"` yields a local temporary path. Render
  that path immediately, then upload it on form submission. Uploading inside
  `onChooseAvatar` makes a network/domain failure look like selection failed.
- An `Input type="nickname"` can show the current WeChat nickname suggestion,
  but accepting it does not reliably emit every React/Taro input event on a
  real device. Keep the native input uncontrolled, give it a `name`, wrap it
  in `Form`, and read `event.detail.value` from `Form.onSubmit`.
- The submitted nickname remains user-editable. Validate the form value at
  submit time and keep the selected local avatar path after upload/auth
  failures so the user can retry.
- Production experience builds can enforce `uploadFile` separately from
  `request`, while devtools and real-device debug may bypass that difference.
  The current login flow therefore compresses the chosen avatar, reads it as
  base64, and sends it to `/api/upload/avatar-data` with `Taro.request`. Keep
  release-critical profile capture on this request-domain path unless the
  product intentionally restores and verifies a separate upload-file domain.
- Render upload/login progress and failures inside the login card. A page-level
  error outside the card can fall outside the visible landscape area and make
  a rejected submit look like a dead button.

Do not replace this with a controlled React value whose only synchronization
path is `onInput`/`onBlur`; that can display a native nickname while submitting
stale or empty state.

---

## Devtools Automation (miniprogram-automator)

### Working recipe

1. Enable 设置 → 安全设置 → 服务端口 in devtools (creates
   `~/Library/Application Support/微信开发者工具/<hash>/Default/.ide` with the
   HTTP port). Without it every `cli` invocation hangs with no output.
2. Build first, then start automation with the compiled project:
   `cli auto --project apps/miniprogram/dist --port <http-port> --auto-port 9420`.
   Starting at the source project root can make the independent automation
   window look for `pages/index/index.wxml` before Taro output exists.
3. DevTools RC builds can return `version` instead of the old `SDKVersion`
   field from `Tool.getInfo`, which makes miniprogram-automator 0.12.1's public
   `connect()` version check fail. In that combination, use the launcher's
   underlying `connectTool({ wsEndpoint: "ws://127.0.0.1:9420" })`.
4. Drive game state **server-side**, not through the UI: create session + room
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

开发管理 → 开发设置 → 服务器域名: add the production origin to request合法域名
(`https://<domain>`) and socket合法域名 (`wss://<domain>`; this project uses
`socket.io-mp`). The current avatar flow also uses the request domain via
`/api/upload/avatar-data`. If any future client uses `Taro.uploadFile` /
`wx.uploadFile` or the legacy `/api/upload/avatar` path, the same HTTPS origin
must additionally be configured under **uploadFile合法域名**. It is a separate
allowlist, and devtools with `urlCheck: false` can mask a missing entry. Changes
take a few minutes to propagate to a real device; a full app restart (not just
backgrounding) is sometimes needed to pick them up.

### Building for production

```bash
pnpm --filter @huanghuang/miniprogram build:weapp
```

The default compiled origin is `https://huanghuang.amazingzz.xyz`, so a normal
DevTools compile or experience-version upload cannot silently fall back to
localhost. Local server work must opt in explicitly:

```bash
TARO_APP_API_BASE=http://127.0.0.1:3000 pnpm --filter @huanghuang/miniprogram build:weapp
```

Verify the URL actually landed before shipping — it ends up in
`dist/common.js`, not `dist/app.js`:

```bash
grep -o '"https://<domain>"' apps/miniprogram/dist/common.js
```

### Player identity and public meld capacity

In the playable landscape table, player identity and exposed melds have
different capacity constraints. Keep the identity card fixed and bounded:
long nicknames may ellipsize, while score, hand count, multiplier and offline
state render as short wrapping stats inside the card. Render melds/released
wildcards exactly once in seat-specific public rails rather than allowing them
to grow the identity card.

- The opposite rail belongs immediately left of the opposite player's avatar,
  not in the centered top discard lane. Anchor its right edge to the left edge
  of the top identity station; dense four/five-group layouts may use two/three
  columns as long as they expand away from the central discard region.
- The local identity card belongs in the right side of the reserved band above
  the hand, not on the same bottom baseline as the hand. On narrow landscape
  screens, a bottom-aligned identity card is eventually covered by the
  horizontally centered 14-tile hand.
- Public rails must shrink-wrap sparse content. A fixed `300px` horizontal
  rail or an always-two-column side grid makes a lone released wildcard float
  away from its owner.
- Left/right rails use one row for one or two public groups, a two-column grid
  for three or four groups, and a three-column/two-row grid for the maximum
  five items (four melds plus released wildcard). Keeping five items in two
  columns creates a third row that collides with the local bottom rail.
- Grid children need `justify-self: start`; otherwise a narrow released-
  wildcard card stretches to the widest meld column and renders as a large
  empty-looking slab.
- Validate the maximum four groups for adjacent seats at phone landscape
  dimensions, both with and without a released wildcard. A no-meld screenshot
  or a four-meld screenshot without wildcard is not evidence that station
  geometry is safe.
- Keep the local public rail on the left and the local identity card on the
  right of the lane above the hand. This separates both from the centered
  action dock and leaves the full bottom row to the hand.

```scss
.player-meld-rail.pos-left.is-dense,
.player-meld-rail.pos-right.is-dense {
  grid-template-columns: repeat(2, max-content);
}

.player-meld-rail.pos-left.public-groups-5,
.player-meld-rail.pos-right.public-groups-5 {
  grid-template-columns: repeat(3, max-content);
}

.meld-group,
.released-wildcard-group {
  justify-self: start;
}
```

### Ting helper is presentation over the authoritative projection

The mini-program must display `RoomProjection.tingHints` exactly as projected
by the server. The client may index waits by physical discard id and order
them for readability, but it must not infer hidden tiles or recalculate
`remainingCount`.

- Render waits in a vertically scrollable warm-white card above the selected
  discard candidate; a dark horizontal ticker is too dense for novice help.
- Mount the card as an absolute overlay above the action row instead of a
  fixed-height flex child. Otherwise short wait lists leave empty space and
  every selection pushes the discard button away from its stable position.
- Size one wait to one row and cap longer lists at two visible rows with
  vertical scrolling. Keep multiplier and remaining count adjacent instead of
  using `margin-left: auto`, which creates a large blank gutter.
- Order `HARD` waits before `SOFT` waits while preserving the server-projected
  multiplier and remaining count.
- Make multiplier and remaining count separate high-emphasis elements rather
  than combining them into a low-contrast sentence.
- Keep the empty-wall state visible (`余 0 张 · 已绝张`) instead of filtering it
  out; this is useful public information even though the tile cannot be drawn.

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
