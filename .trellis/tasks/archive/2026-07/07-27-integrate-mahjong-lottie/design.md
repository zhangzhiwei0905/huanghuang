# 接入麻将游戏特效动画 — Technical Design

## 1. Scope and Boundaries

This change spans four existing ownership boundaries:

1. `packages/game-engine` remains the sole owner of Mahjong rules and continues
   returning a complete, authoritative `RuleResult`.
2. `apps/server/src/room-service.ts` owns the new presentation-paced transition:
   it can hold an already-accepted `RoundState` for a bounded duration before
   making it the live round.
3. `packages/protocol` owns the client-facing effect cue contract.
4. `apps/miniprogram` renders the cue with a native 2D Canvas and local Lottie
   data.

The game engine reducers are not split into partial "animate" and "finish"
operations. Scoring, wall mutation, meld creation, draw ownership, and outcome
calculation remain one pure reducer result; only publication of that result is
delayed.

The pacing rule applies only to the five supplied effect families. A normal
discard or pass has no matching animation and continues immediately. When a
paced transition completes, the engine result determines the next step:

- pong: the claimant becomes the acting player and must discard, without a draw;
- exposed/concealed/indicator/added kong: the correct actor receives the
  reducer-produced replacement draw;
- wildcard release: the same actor receives the replacement draw;
- win: the round enters result state and the settlement becomes visible.

## 2. Shared Projection Contract

Add a shared cue type to `packages/protocol/src/projections.ts`:

```ts
export type GameEffectAction =
  | MeldKind
  | "RELEASE_WILDCARD"
  | "WIN";

export type GameEffectCue = {
  id: string;
  action: GameEffectAction;
  actorSeat: Seat;
  tileKind: TileKind | null;
  winType: WinType | null;
  startedAt: string;
  endsAt: string;
};
```

`RoomProjection` gains `effectCue: GameEffectCue | null`, and its
`schemaVersion` advances from 5 to 6. The cue contains presentation facts only;
it never exposes the pending round, wall order, or another player's hand.

Contract invariants:

- `tileKind` is non-null for meld and wildcard effects and null for a win.
- `winType` is non-null only for a win.
- `id` is stable across connection-status updates and unique per accepted paced
  action.
- ISO timestamps let a reconnecting client resume only the remaining portion
  of an active cue.
- While `effectCue` is non-null, `legalActions` is empty,
  `actingSeat` is null, and `actionDeadlineAt` is null.

## 3. Authoritative Server Transition

`RoomState` gains a persisted internal field:

```ts
type PendingEffectTransition = {
  cue: GameEffectCue;
  nextRound: RoundState;
};

pendingEffectTransition: PendingEffectTransition | null;
```

The field is included in `PersistedRoomState`; legacy snapshots normalize it to
`null`. The pending `nextRound` is durable private server state and is never
projected.

### State flow

```text
live round
  │ accepted reducer result has no visual effect
  ├──────────────────────────────────────────────> apply nextRound immediately
  │
  │ accepted reducer result maps to an effect
  ▼
persist { old live round, cue, nextRound }
increment room version and broadcast cue
clear actions / actor / action deadline
  │
  │ server tick reaches cue.endsAt
  ▼
atomically replace live round with nextRound
clear pending transition
increment room version, refresh the real next deadline, persist and broadcast
```

The command acknowledgement points to the cue projection version. Applying the
timer transition is a separate authoritative room-version increment. Existing
request deduplication remains valid because the accepted command and pending
transition snapshot are written in the same
`saveRoomAndProcessedRequest` transaction.

`RoomService.execute` rejects any new game command while a transition is
pending. `actingSeat()` returns null, bot/timeout automation cannot select an
actor, and `tick()` processes an expired pending transition before normal
action deadlines. Connection changes may increment room versions during the
wait but must not replace or restart the cue.

Room close, dissolve, leave, and waiting-room lifecycle paths clear an
irrelevant pending transition when they end or discard the active round.

## 4. Effect Detection and Timing

`RoomService` derives one cue by comparing the current round with the accepted
`RuleResult.state`:

| Authoritative delta | Cue action | Lottie key | Duration |
| --- | --- | --- | ---: |
| New `PONG` meld | `PONG` | `peng` | 2000 ms |
| New exposed/concealed/indicator kong meld | matching `MeldKind` | `gang` | 2200 ms |
| Existing pong becomes `ADDED_KONG` | `ADDED_KONG` | `bu-gang` | 2300 ms |
| New released wildcard | `RELEASE_WILDCARD` | `fang-lai` | 2500 ms |
| New win outcome | `WIN` | `hu-pai` | 2800 ms |

The cue actor and tile come from the accepted authoritative state. No command
payload is trusted for animation identity.

An invariant test will assert that an accepted reducer produces at most one
paced cue. If a future reducer legitimately creates multiple visual events,
the contract must be extended to an explicit ordered queue instead of silently
dropping one.

## 5. Mini-Program Rendering

Add a dedicated `MahjongEffectOverlay` component mounted once by the playable
room page.

Responsibilities:

- create one Taro `<Canvas type="2d">` and initialize
  `lottie-miniprogram@1.0.12` after its native node is available;
- map the shared cue action to one of the five local animation modules;
- convert protocol `TileKind` to the animation pack's `m1`–`m9`,
  `p1`–`p9`, or `s1`–`s9` code;
- clone and patch tile-bearing animation data with the supplied
  `tile-faces.js`; compact pong deliberately removes all tile layers;
- stretch authored frame timing to the cue's server-owned duration;
- if joining/reconnecting during an active cue, seek to elapsed progress and
  play only the remaining portion;
- keep the final frame until the server removes the cue, then destroy the
  animation instance;
- destroy both the animation instance and Canvas binding on unmount.

Player station elements receive stable IDs based on absolute seat. Non-win
effects query the actor station rectangle and use the supplied placement
algorithm with a centered fallback when measurement fails. Pong uses a smaller
stage that slightly overlaps the station edge so the visible action badge sits
closer to the avatar. Its runtime presentation keeps only the action badge,
five lightweight particles, and two impact rings, trimming the timeline to the
first visible effect frame.

Win uses a centered square stage sized from the landscape viewport height,
preserving the authored 512×512 aspect ratio so its glyph is never stretched.
Only a restrained full-viewport scrim sits behind that square. The overlay is
fixed, above normal table and settlement layers, below the existing round-start
overlay, and has `pointer-events: none`.

The room page uses `effectCue !== null` as an additional interaction lock.
Settlement is naturally absent during a win cue because the server still
projects the old round; it appears only in the transition-completion
projection.

## 6. Audio Coordination

Without adjustment, existing projection-diff audio would fire only after the
animation, when the pending round becomes live. Extend the audio snapshot with
the active cue identity/action:

- a new live cue plays the matching existing action audio immediately;
- a win cue uses its authoritative `winType` to play `yinghu.mp3` or
  `ruanhu.mp3`;
- the subsequent cue-removal projection suppresses the duplicate meld,
  wildcard, or settlement audio produced by the public-state delta;
- initial load, reconnect, and version-gap rules remain silent as today.

Audio remains independent of Lottie completion and never controls the server
transition.

## 7. Assets, Dependency, and Package Size

Use local `animationData`, not network `path`:

- copy the five generated CommonJS data modules and `tile-faces.js` into a
  mini-program-owned effects directory;
- do not copy the much larger raw JSON files;
- pin `lottie-miniprogram` to `1.0.12`.

Evidence gathered during planning:

- the official package supports native 2D Canvas, local `animationData`, and
  requires Canvas setup before load; network `path` is the only supported path
  mode;
- the generated validator passes all five animations and all dynamic tile
  substitutions;
- local effect data plus tile-face runtime is about 373 KB;
- `lottie-miniprogram` publishes about 211 KB of mini-program distribution
  files;
- the current compiled mini-program baseline is about 843 KB by raw file sum.

The production build remains the final authority. The complete built main
package must stay below WeChat's 2 MiB limit.

The existing mini-program already has WeChat Cloud Storage initialization and
temporary-URL resolution for audio. It is not the first choice for these
animations: local generated data is about 280 KB, while the equivalent five
raw JSON files total about 1.45 MB of runtime downloads, and a network miss
would leave players watching an authoritative effect pause without its visual.

If the measured production main package nevertheless exceeds 2 MiB, keep
`tile-faces.js` local and upload only these files under a versioned cloud folder
such as `mahjong-lottie/v1/`:

- `animations/peng.json`
- `animations/gang.json`
- `animations/bu-gang.json`
- `animations/fang-lai.json`
- `animations/hu-pai.json`

`README.md`, `manifest.json`, `preview/`, `tools/`, and
`miniprogram-example/data/*.js` are not runtime cloud assets and must not be
uploaded for this fallback.

## 8. Failure Handling

- A Canvas initialization or playback failure is reported to the console and
  hides the visual overlay, but never changes or extends the authoritative
  server timer.
- Missing actor geometry falls back to a centered effect.
- A stale/expired cue is not restarted.
- If the server restarts mid-effect, snapshot restoration retains the pending
  round. The first tick after `endsAt` applies it exactly once.
- Clients that do not render the new cue still receive empty legal actions and
  cannot advance the room during the bounded pause.

## 9. Rollback

The change is additive at persistence level. Rollback consists of deploying
the prior server/client together. Before rollback, allow active effects to
finish or restart on a version that explicitly normalizes/drops
`pendingEffectTransition`; otherwise an older server would ignore the pending
next round and retain the pre-action live round.
