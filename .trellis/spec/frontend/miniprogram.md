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

### Pattern: projection-derived short game audio

`src/lib/gameAudioEvents.ts` owns the projection-diff contract for spoken tile
and action audio. `src/lib/gameAudioPlayer.ts` owns the WeChat playback API and
bundled MP3 mapping; the room page only advances the tracker and forwards file
names to the player.

```ts
updateGameAudioTracker(
  tracker,
  room,
  connectionStatus === "connected",
): GameAudioFileName[];
```

- Seed the tracker from the first room projection without playing anything.
- Disarm it whenever the Socket is not connected. The first projection after
  reconnect re-arms the tracker but stays silent, so restored historical
  discards, melds or settlement never replay.
- Require `room.version === previous.version + 1` before emitting audio. A
  version gap means the client recovered a full snapshot and must not replay
  events accumulated between the two visible projections.
- Detect discards by physical tile ID, not only pile length. A claimed discard
  and a later new discard can leave the pile at the same length.
- A new `effectCue.id` plays pong, kong, added-kong, released-wildcard or win
  audio at the start of the server-owned animation phase. Win uses the cue's
  authoritative `winType` (`yinghu.mp3` for `"HARD"`, `ruanhu.mp3` for
  `"SOFT"`); a draw has no cue and stays silent.
- When the server removes a cue and publishes the accepted meld, released
  wildcard or settlement in the next room version, suppress the matching
  projection-diff audio so the same action is not spoken twice. Continue
  detecting normal discards from physical tile IDs.
- `GameEffectAction === "INDICATOR_PONG_KONG"` (碰亮牌/朝天杠) plays
  `chaotiangang.mp3`, not the generic `action-pong.mp3`/`action-kong.mp3`.
- **Clips are pre-trimmed at the source, not windowed at playback time.**
  `scripts/trim-audio.mjs` ffmpeg-cuts each clip in `huanghuang-audio/mp3-version/`
  down to its intended voice span and writes the result to
  `huanghuang-audio/mp3-trimmed/` (uploaded to the WeChat Cloud Storage folder
  named by `CLOUD_FOLDER` in `cloudAudio.ts`). `gameAudioPlayer.ts` has **no**
  `AUDIO_WINDOWS` table, no `startTime` seek, and no stop-timer — every clip
  plays from 0 to its natural `onEnded`. The old design (seek into a full-length
  clip, forcibly `context.stop()` after a computed duration) is a **rejected
  pattern**: the stop-timer started counting from `play()` being called, not
  from when sound actually started, so a real network download + decode
  (`useWebAudioImplement: true` requires full decode before sound starts) could
  eat the entire window and truncate or fully silence a 300–400ms action cue
  under real-device latency. If a clip's playable window ever needs to change,
  re-run the trim script and re-upload — do not resurrect an in-player window
  table.
- **The pool never silently drops a play() call.** `acquireContext()` returns
  an idle pooled context or creates a new one — there is no hard concurrency
  cap. On natural completion, the context returns to a bounded idle-reuse pool
  (`MAX_IDLE_POOL_SIZE`); only the *excess idle* contexts beyond that bound get
  destroyed, never a context that's mid-playback. This is a **regression
  fix**: an earlier revision added a hard `POOL_SIZE = 2` cap that returned
  `null` (dropped, unlogged) whenever both slots were busy — a single long
  clip (`yinghu.mp3` at ~2.3s, `woyijingtingle.mp3` at ~3.4s) could occupy a
  slot for seconds and silently eat every action/tile cue that happened during
  that window, which is what "sounds like it's queueing" actually was. Do not
  reintroduce a hard drop-on-full cap in the name of resource limits; the
  bounded idle-reuse pool already caps steady-state native-context count
  without ever refusing a concurrent play.
- **Warm a local file cache, not just the context pool.** `warmup()` checks
  `Taro.getFileSystemManager()` for a local copy of each clip under
  `${Taro.env.USER_DATA_PATH}/audio/<fileName>` and `Taro.downloadFile({ url,
  filePath })`s any miss. `play()` uses the confirmed-local path synchronously
  when present; only a cache miss falls back to the existing async
  `resolveAudioFileUrls` cloud-temp-URL path. This removes the network
  round-trip from the hot path — re-assigning `context.src` to a fresh HTTPS
  URL on every single play (the pre-fix behavior) added an unpredictable
  100–400ms decode-visible delay on top of the truncation bug above.
- Keep `obeyMuteSwitch = true` on every context, whether pooled or freshly
  created.
- Store the audio preference as a boolean under
  `huanghuang_game_audio_enabled`, defaulting to enabled when missing or
  unreadable. Continue advancing the projection tracker while muted so
  re-enabling audio plays only future events.
- Keep the audio file catalog in a `Record<GameAudioFileName, string>`-shaped
  list (`AUDIO_FILE_NAMES` in `gameAudioPlayer.ts`, mirrored in
  `scripts/trim-audio.mjs`'s trim spec) so a missing tile or action asset fails
  type-check/build instead of becoming a silent runtime hole. `action-win.mp3`,
  `laiyou.mp3` and `pre-audio.mp3` are dead — no code path ever selects them —
  and must stay out of `GameAudioFileName`, `AUDIO_FILE_NAMES`, and the trim
  script's file list; don't re-add a "just in case" entry for them.

Tests must cover equal-length discard replacement, every cue-to-audio mapping,
cue-completion suppression, wildcard release, both win types, initial-load
silence, reconnect silence, pool warmup/reuse without ever dropping a
concurrent play, idle-pool bound without leaking contexts, local-cache
hit/miss behavior, listener cleanup, destroy-before-URL-resolution safety and
stored mute preference.
Production verification must assert all cataloged MP3 files exist in `dist`
and that the complete main package remains below WeChat's size limit.

### Pattern: server-timed Mahjong Lottie overlay

`RoomProjection.effectCue` is the only trigger for the mini-program's
`MahjongEffectOverlay`. A successful button click never starts an effect
optimistically. The shared mapping is:

| Cue action | Local animation | Placement |
|---|---|---|
| `PONG` | compact text-only `peng` | actor station |
| exposed/concealed/indicator kong | `gang` | actor station |
| `ADDED_KONG` | `bu-gang` | actor station |
| `RELEASE_WILDCARD` | `fang-lai` | actor station |
| `WIN` | `hu-pai` | full viewport |

- Pin `lottie-miniprogram` and initialize it with one native
  `<Canvas type="2d">`. Load local CommonJS `animationData`; the package's
  `path` mode is network-only.
- Keep generated modules under `src/effects/mahjong/`. Use the supplied
  `tile-faces.cjs` to clone and substitute the authoritative `TileKind` before
  playback for tile-bearing effects; protocol suits map to `WAN → m`,
  `TONG → p`, `TIAO → s`. Pong's source asset is authored tile-free from the
  start (no badge-and-particles-only variant to derive at runtime), so it
  skips the tile-substitution branch entirely (see `loadMahjongAnimationData`
  in `runtime.ts`).
- Keep the server interaction duration and client visual budget aligned:
  pong 450ms, kong-family 700ms, added kong 650ms, wildcard release 800ms and
  win 1050ms. `room-service.ts`'s `EFFECT_DURATION_MS` remains the
  authoritative transition deadline; `mahjongEffect.ts`'s
  `EFFECT_VISUAL_DURATION_MS` independently guards rendering and
  `effectVisualEndsAt(cue)` caps it to the authoritative `endsAt`. Matching
  values ensure the animation ends as the accepted transition becomes
  eligible to commit, without a blank interaction lock after the canvas
  disappears. The server completion scheduler runs at 50ms, bounding its
  additional poll latency.
- `presentationProfiles` in `runtime.ts` gives each `MahjongEffectKey` an
  `outPoint` — the frame (at the asset's authored 60fps) where its badge/主体
  has already settled into a legible final state, cut *before* the source's
  own hold-and-fade tail. `applyPresentation` clamps `op` to that frame and
  tags `meta.presentation`; it does **not** filter layers by name. Picking
  `outPoint` is a per-asset visual judgment call (see
  `.trellis/tasks/07-27-mahjong-effect-redesign/design.md` for the worked
  example across all five actions) — the goal is always "the reader has
  already gotten the beat" before the cut, never a fixed fraction of the
  source's `op`. A source asset can be exported with a full, unhurried
  hold/fade tail past `outPoint`; that trailing data is only shipped bundle
  weight, never rendered, and is fine to leave in place, or physically
  trim later if bundle size becomes the binding constraint (they are not the
  same constraint).
- `MahjongEffectOverlay` hides itself the instant Lottie's own `complete`
  event fires (i.e. at `outPoint`), plus a redundant `setTimeout` fallback —
  it does **not** wait for `cue.endsAt`. There is no authored fade-out inside
  the Lottie data for this reason: the overlay wrapper's own 90ms CSS
  `opacity` transition supplies the perceived disappearance. Don't reintroduce
  a slow internal fade tail thinking it improves the "vanish" — it just adds
  dead time before the frame the component actually cuts to.
- Non-win effects synchronously derive the actor's relative seat from
  `(actorSeat - selfSeat + 4) % 4`, then approximate the stable
  `.player-station.pos-*` rectangle from viewport dimensions. Do not run
  `boundingClientRect()` before every cue: the stations are absolutely
  positioned and their entrance changes opacity only, so that asynchronous
  query adds start latency without improving the anchor. Pong uses the
  smallest stage and slightly overlaps the station edge so its visible center
  stays close to the avatar. Win renders inside a centered square stage
  derived from viewport height; a separate full-viewport scrim provides focus
  without stretching the authored 512×512 composition.
- The overlay is fixed and pointer-transparent, above table content, and
  hidden outright while `roundSettlement !== null` (the settlement modal owns
  the screen at that point). Cue change and page unmount must destroy the
  prior animation instance.
- Include `effectCue !== null` in the room interaction lock even though the
  projection also has empty legal actions. Canvas/playback failure hides the
  visual and logs the failure; it never changes the authoritative timer.
- Pass every REST, Socket and storage-restored projection through
  `normalizeRoomProjection` before placing it in React state. During a
  staggered schema 5 → 6 rollout, an older server projection has no
  `effectCue`; normalize that missing field to `null` once at the boundary.
  Downstream audio, overlay and interaction code may then keep the strict
  `GameEffectCue | null` contract and must not treat `undefined` as an active
  effect.
- For accepted game commands, consume the member-specific projection attached
  to the Socket acknowledgement immediately; do not issue a redundant HTTP
  refresh first. A `room:update` may likewise carry a projection targeted to
  that socket, especially when a timed effect commits. Replace it directly and
  keep the legacy version-hint → HTTP refresh path only as a staggered-rollout
  fallback. All replacements still pass through normalization and monotonic
  version checks.
- Production verification must run the real WeChat build and measure all files
  under `dist`. If the package remains below 2 MiB, keep the effects local.
  Cloud fallback, if ever required, uploads only the five raw animation JSON
  files under a versioned prefix and keeps the tile-face runtime local.

Pure helper tests must cover all action mappings, suit codes, duration
stretching, `effectVisualEndsAt` capping, reconnect seek frames,
actor-adjacent placement and full-screen win placement. The production build
must contain all five animation modules and the Lottie runtime.

### Pattern: quick voice messages reuse `room:chat`, audio-only

The mini-program does not implement the web app's chat bubble UI. Instead,
`useRoom.ts` listens for `room:chat` (already broadcast server-side to the
whole Socket room, including the sender) and exposes the latest
`ChatMessageProjection` as `lastChatMessage`; `sendVoiceMessage(message)` is a
fire-and-forget `socket.emit("room:chat", { roomCode, message }, () => {})`
with no `runExclusive`/`refresh()` — it is not a room-mutating game command.
`useGameAudio` matches `lastChatMessage.message` against
`voiceMessageAudioFileName()` (exact string match against the fixed
`VOICE_MESSAGES` catalog in `gameAudioEvents.ts`) and plays the matching clip
once per distinct `chatMessage.id`; unmatched or already-played messages are a
no-op. There is no chat bubble/toast tied to *receiving* a message, and no
persisted history — do not add one without revisiting this decision.

Sending, however, does have a small custom UI: the room page shows a single
standalone "快捷消息" trigger button (`.quick-message-fab`, parked beside the
self player-station card at the table's bottom-right, not inside
`info-capsule`) only when `quickMessageAvailable` (`room.mode === "FRIEND" &&
room.stage === "PLAYING"`), mirroring the server's own `createChatMessage`
validation. Tapping it opens a custom in-game speech-bubble popover
(`.quick-message-bubble`, a `useState` boolean, not `Taro.showActionSheet`)
listing the `VOICE_MESSAGES` catalog; tapping an item sends and closes it,
tapping the `.quick-message-overlay` behind it closes without sending. Both
the trigger and the bubble share the warm cream "mahjong tile" card material
from `.player-station` (not the dark `.leave-fab`/`.sound-fab` chrome) since
this is a social action, not a utility control — the system action sheet was
explicitly rejected by the user in favor of this in-theme popover.

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

### Pattern: player-station stat hierarchy and active-seat emphasis

`.player-station__stat` (score/multiplier/hand-count row) used one uniform
size/weight/color for all three values — no visual hierarchy. Per explicit
user feedback, score is what players actually track round to round, so it
reads first: `--score` is the largest/boldest, colored with the existing jade
`--accent`. `--multiplier` is explicitly red per user request — reuse the
existing `--danger` token (`#7a4b45`, a muted terracotta already in the
palette) rather than a saturated alarm-red; red is otherwise unused on this
card so it doesn't compete with anything, and it reads as "stakes/risk"
against the cool jade + cream card. `--hand` is smallest/most muted,
`opacity: 0.8` on top of `--muted`. (An earlier pass used the gold
`--tile-gold` token for multiplier — the user asked for red specifically,
so that's gone; `--tile-gold` is still the right choice for anything that
needs a *third*, non-alarming accent, e.g. `TingHintCard`'s `.is-soft`.)

`.player-station.is-active` (whose-turn highlight) originally pulsed a
box-shadow from fully invisible (`0 0 0 0`) up to a faint 12%-opacity ring and
back — easy to miss at a glance. The fix keeps a ring that's never fully
invisible (0%/100% keyframe already shows a visible `rgb(47 106 76 / 50%)`
ring) and pulses outward to a bigger, softer glow at 50%, plus a thicker 2px
border and a light jade-tinted background wash. **Do not add `transform` to
`.is-active`** — `.pos-opposite`/`.pos-left`/`.pos-right`/`.pos-self` each set
their own `transform` for positioning (e.g. `translateX(-50%)` for the
opposite seat), and since `.is-active` and each `.pos-*` class have equal
selector specificity, whichever rule is declared later in the stylesheet
wins the cascade — a `transform` on `.is-active` would silently break the
opposite seat's centering the moment it becomes active. Emphasize with
border/glow/background only, never geometry, on this element.

Left/right meld rails (`.player-meld-rail.pos-left`/`.pos-right`) sat at
`top: 45%` while their own player-station card sits at `top: 29%` — a ~16
point gap, far more than the card's own ~8-10vmin height, floating the melds
in empty space. A first fix flattened this to a second guessed percentage
(`top: 37%`), which closed the gap but then overlapped the card's stats row —
two independent percentages of the same container can't be trusted to track
each other's real height. Fixed properly with `top: calc(29% + 12vmin)`:
anchored to the card's own `top: 29%` plus a fixed vmin clearance sized to
the card's actual content (avatar row + up to two wrapped lines of stats),
so the gap moves with the card instead of drifting out of sync with it. This
still keeps the rail further from the `top: 46%` discard-zone band than the
original 45% did.

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
- No `ScrollView`, no capped height: the card renders every wait in full and
  grows to whatever height the content needs. An earlier pass tried hiding
  just the scrollbar chrome (`ScrollView` + `enhanced` + `showScrollbar={false}`
  + `::-webkit-scrollbar{display:none}`) while keeping the 2-row scroll cap —
  the user rejected that too ("还是有滚动条" / "希望是直接展示完整"): a
  hidden-but-still-scrollable list isn't the same as showing it complete.
  `.ting-hint-card__list` is a plain flex column now, no scroll container at
  all.
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

### Competitive matchmaking presentation

- The signed-in home shows the server-projected rank and places `快速开始` before practice/friend actions.
- Queue polling is serial, never overlapping. It stops on unmount, cancel, or a non-QUEUED state; delayed responses must not overwrite a newer MATCHED state.
- The matching modal shows wait time and the same 10/20/40-second search-window labels owned by product requirements. It does not offer bot fallback or configuration.
- A MATCH projection hides room code sharing, settings, chat and dissolve controls. Exiting PLAYING requires explicit confirmation that trustee play and rank settlement continue.
- Settlement uses `winnerMultiplier`, `payerEffectiveMultiplier` and `competitiveSettlement.self`; it must not derive rank from personal multiplier, table score or `roundDelta`.
- `PlayerProfileModal` labels room score as `本局牌桌分`, shows public rank/four MATCH achievement totals, and represents a `null` competitive profile as no permanent record rather than four zero counters.
- `normalizeRoomProjection` upgrades legacy projections once at the boundary with null competitive fields and authoritative effective-payment fallback. Components consume strict schema 9 values.

## Verification Commands

```bash
cd apps/miniprogram && pnpm typecheck && pnpm build:weapp
pnpm exec prettier --check "apps/miniprogram/src/**/*.{ts,tsx,scss}"   # repo root
```

ESLint currently excludes `apps/miniprogram` (pre-existing repo config).
