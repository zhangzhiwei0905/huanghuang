# 接入麻将游戏特效动画 — Implementation Plan

## 1. Protocol Contract

- [x] Add `GameEffectAction` and `GameEffectCue` to
  `packages/protocol/src/projections.ts`.
- [x] Add `effectCue` to `RoomProjection` and bump `schemaVersion` to 6.
- [x] Update projection fixtures and compile-time consumers in web and
  mini-program tests.

Validation:

```bash
pnpm --filter @huanghuang/protocol typecheck
pnpm exec vitest run packages/protocol
```

## 2. Authoritative Paced Transition

- [x] Add persisted `PendingEffectTransition` state and legacy normalization in
  `apps/server/src/room-service.ts`.
- [x] Derive cue action, actor, tile, win type, and tiered duration from the
  accepted reducer result.
- [x] Schedule effect-producing reducer results without exposing
  `nextRound`.
- [x] Project the cue with empty legal actions, no acting seat, and no action
  deadline.
- [x] Reject game commands and suppress bot/timeout actions while pending.
- [x] Make `tick()` apply an expired transition once, refresh the next real
  deadline, persist, and emit a new room version.
- [x] Clear pending state in round-discarding lifecycle paths.
- [x] Add service tests for every cue mapping, hidden pending state, command
  rejection, bot pause, exact expiry boundary, next-player/replacement draw,
  win-before-settlement, idempotency, and restart normalization.

Validation:

```bash
pnpm exec vitest run apps/server/src/room-service.test.ts
pnpm --filter @huanghuang/server typecheck
```

Rollback point: protocol and server changes can be reverted together before
any mini-program asset integration.

## 3. Audio Cue Synchronization

- [x] Extend `apps/miniprogram/src/lib/gameAudioEvents.ts` snapshots with cue
  identity/action.
- [x] Emit the existing action/win audio when a new live cue starts.
- [x] Suppress duplicate audio when the cue is replaced by its applied public
  state.
- [x] Preserve initial-load, reconnect, mute, and version-gap silence.
- [x] Add focused tests for each action, repeated same-cue projections,
  completion suppression, reconnect during cue, and win-type mapping.

Validation:

```bash
pnpm exec vitest run apps/miniprogram/src/lib/gameAudioEvents.test.ts
```

## 4. Lottie Runtime and Generated Assets

- [x] Add pinned `lottie-miniprogram@1.0.12` to
  `apps/miniprogram/package.json` and update `pnpm-lock.yaml`.
- [x] Copy only the generated animation data modules and `tile-faces.js` from the
  supplied output into a mini-program-owned effects directory.
- [x] Use the package's bundled TypeScript declarations for the runtime methods
  actually used.
- [x] Add pure helpers for protocol tile-code mapping, cue-to-animation mapping,
  duration/progress calculation, and placement fallbacks.
- [x] Add unit tests for those pure helpers.

Source validation:

```bash
node /Users/zhang/Documents/Codex/2026-07-27/qin/outputs/mahjong-lottie/tools/validate.js
```

## 5. Canvas Overlay Integration

- [x] Build `MahjongEffectOverlay` with one native 2D Canvas, cue-ID lifecycle,
  elapsed-progress resume, final-frame hold, and unmount cleanup.
- [x] Add absolute-seat IDs to playable player stations.
- [x] Mount the overlay once on the room page and include the cue in the
  interaction lock.
- [x] Add WXSS for avatar-adjacent and full-screen placement using safe
  supported syntax, correct z-index, and no pointer interception.
- [x] Ensure win cue removal reveals the already-authoritative settlement
  modal.

Validation:

```bash
pnpm --filter @huanghuang/miniprogram typecheck
pnpm --filter @huanghuang/miniprogram build:weapp
pnpm exec prettier --check "apps/miniprogram/src/**/*.{ts,tsx,scss}"
```

## 6. Full Quality Gate

- [x] Run all repository checks.
- [x] Inspect the compiled bundle for all five local effect modules and the
  Lottie runtime.
- [x] Measure the complete mini-program package and confirm it remains below
  2 MiB.
- [x] Cloud fallback was not needed: the complete production build is
  1.284 MiB, below the 2 MiB limit.
- [ ] Verify in WeChat DevTools at phone landscape size:
  all five effects, every relative seat, actual tile substitution, no
  interaction during the cue, effect-before-draw/turn, effect-before-settlement,
  reconnect mid-cue, and Canvas cleanup after leaving.
- [x] Update the backend and mini-program specs with the durable pacing/cue
  contract.

Commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
du -sh apps/miniprogram/dist
find apps/miniprogram/dist -type f -exec wc -c {} + | tail -n 1
```

Final rollback point: do not ship the protocol/server pacing change without the
cue-aware mini-program build.

## 7. Visual Feedback Refinement

- [x] Remove all runtime tile layers from pong and retain only its action badge,
  two impact rings, and a restrained particle set.
- [x] Reduce the pong stage and slightly overlap the actor-station edge so the
  visible feedback reads close to the avatar.
- [x] Keep the win Canvas in a centered square stage rather than stretching the
  authored 512×512 composition across a landscape viewport.
- [x] Keep the settlement owned by the post-effect authoritative projection;
  the visual refinement does not introduce a client timer or early result UI.
- [x] Re-run focused tests, full lint/typecheck/test, mini-program production
  build, and package-size measurement.
- [ ] Verify the compact pong placement and square win composition in WeChat
  DevTools or on a real phone during live cue playback.
