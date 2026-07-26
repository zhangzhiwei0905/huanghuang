# Implementation Checklist

## 1. Assets
- [x] Copy `yinghu.mp3`, `ruanhu.mp3`, `chaotiangang.mp3`, `gaokuaidian.mp3`, `woyijingtingle.mp3` from `/Users/zhang/Documents/VscodeFiles/huanghuang/huanghuang-audio/mp3-version/` into `apps/miniprogram/src/assets/audio/`.

## 2. `apps/miniprogram/src/lib/gameAudioEvents.ts`
- [x] Extend `GameAudioFileName` union with the 5 new file names (keep `"action-win.mp3"`).
- [x] Update `meldAudioFileName()` to branch `INDICATOR_PONG_KONG` → `"chaotiangang.mp3"` before the fallback `EXPOSED_KONG`/`CONCEALED_KONG` → `"action-kong.mp3"` case.
- [x] Update the WIN branch in `detectGameAudioFiles()` to push `settlement.winType === "HARD" ? "yinghu.mp3" : "ruanhu.mp3"` instead of `"action-win.mp3"`.
- [x] Add `voiceMessageAudioFileName(message: string): GameAudioFileName | null` and `VOICE_MESSAGES: { label: string; text: string }[]` (see design.md for the exact shape/text).

## 3. `apps/miniprogram/src/lib/gameAudioPlayer.ts`
- [x] Add imports for the 5 new mp3 files.
- [x] Add the 5 new entries to `AUDIO_SOURCES`.
- [x] Add the 5 new entries to `AUDIO_WINDOWS` using the full-length windows from design.md (`startTime: 0`, measured duration + ~0.15s buffer).

## 4. `apps/miniprogram/src/hooks/useRoom.ts`
- [x] Import `ChatMessageProjection` from `@huanghuang/protocol`.
- [x] Add `lastChatMessage` state, set it from a `room:chat` socket listener registered/cleaned-up alongside the existing `connect`/`disconnect`/`room:update`/`connect_error` listeners in the socket-lifecycle effect.
- [x] Add `sendVoiceMessage(message: string): void` — fire-and-forget `socket.emit("room:chat", { roomCode, message }, () => {})`, guarded by `current !== null && socket?.connected === true`. No `runExclusive`/`refresh()` — this isn't a room-mutating game command.
- [x] Add `lastChatMessage` and `sendVoiceMessage` to `RoomController` type and the returned object.

## 5. `apps/miniprogram/src/pages/room/index.tsx`
- [x] Import `voiceMessageAudioFileName`, `VOICE_MESSAGES` from `../../lib/gameAudioEvents`, and `ChatMessageProjection` type if needed.
- [x] Extend `useGameAudio` to take a 4th `chatMessage: ChatMessageProjection | null` param; add a `lastPlayedChatIdRef` and a new effect that plays the mapped audio once per distinct `chatMessage.id`, gated by `enabled` (see design.md for exact effect body).
- [x] Update the `useGameAudio(...)` call site to pass `roomCtrl.lastChatMessage`.
- [x] ~~Inside the `info-capsule` block, add the two voice-message buttons~~ — superseded per user feedback: instead, add one standalone "快捷消息" button inside `.table-surface` (bottom-right, beside `.player-station.pos-self`), gated on `room.mode === "FRIEND" && room.stage === "PLAYING"`, that opens `Taro.showActionSheet({ itemList: VOICE_MESSAGES.map(v => v.text) })` and calls `roomCtrl.sendVoiceMessage(...)` with the tapped item. New `.quick-message-fab` SCSS class added (no more `info-capsule__btn` reuse for this feature).

## 6. Tests
- [x] `apps/miniprogram/src/lib/gameAudioEvents.test.ts`:
  - Update the `it.each` meld table: `["INDICATOR_PONG_KONG", "action-kong.mp3"]` → `["INDICATOR_PONG_KONG", "chaotiangang.mp3"]`.
  - Update the win/draw test: `settlement("WIN")` (HARD) → expect `"yinghu.mp3"`; add a SOFT case → expect `"ruanhu.mp3"`. Extend the `settlement()` fixture to accept a `winType` param (default `"HARD"`) so both cases can be built.
  - Add a small test for `voiceMessageAudioFileName`: known phrase → correct file name; unknown text → `null`.
- [x] `apps/miniprogram/src/lib/gameAudioPlayer.test.ts`: no changes required (tests don't enumerate `AUDIO_SOURCES`/`AUDIO_WINDOWS` exhaustively).

## Validation
- [x] `pnpm --filter @huanghuang/miniprogram typecheck` (or repo's equivalent tsc script).
- [x] `pnpm --filter @huanghuang/miniprogram test` (vitest) — confirm updated/added tests pass.
- [x] Manual sanity check of `AUDIO_WINDOWS` durations against `afinfo` output already gathered (no cut-off audio).

## Rollback
Every change is additive or a narrow single-branch edit in 4 client-only files plus new asset files — revert via `git checkout` on those specific files if needed. No server/protocol/migration involved.
