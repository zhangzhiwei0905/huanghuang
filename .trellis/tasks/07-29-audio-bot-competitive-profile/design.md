# Design

## Audio cache integrity

`GameAudioPlayer` continues to own cloud URL resolution, local caching and
`InnerAudioContext` pooling.

- Change the cache subdirectory from `audio` to `audio-v2`. The old directory
  is left untouched and becomes unreachable, which is sufficient to evict
  any previously truncated files without a destructive migration.
- Add an instance-local `warmupStarted` guard. The room page may call
  `warmup()` for every projection, but only the first call resolves/downloads
  the catalog and warms contexts.
- Call `Taro.downloadFile({ url })` without a destination. A successful result
  is written to the final cache path only through
  `FileSystemManager.saveFileSync(tempFilePath, localPath)`. Until that move
  succeeds, `localReady` remains empty and `play()` uses the existing cloud
  URL fallback.
- A failed download/save is silent and leaves no file at the playable final
  path. A later player instance may retry.

This preserves the existing no-drop concurrent playback contract and does not
introduce an audio stop timer.

## Ranked bot public profile parity

No protocol, schema or UI change is required.

`RoomService.project` currently collects only session ids whose controller is
not `BOT`. Replace that list with all non-null seat session ids. Normal room
bots have `sessionId: null`, so they remain profile-less. Ranked bots use
`rankedBotSeat`, carry stable session ids seeded by `ensureRankedBotSession`,
and therefore resolve through the same `getPublicCompetitiveProfiles` and
`projectCompetitiveProfile` path as humans.

The existing `PlayerProfileModal` already renders rank and the five achievement
totals whenever `competitiveProfile` is non-null. Once the projection is
correct, bot avatar clicks automatically gain the same display.

## Compatibility and rollback

- The audio cache version costs one additional catalog-sized cache directory
  until WeChat reclaims the old user-data files; the catalog is small enough
  for this transition.
- Public payload shape is unchanged; only ranked bot values change from
  `null` to the already-defined `PublicCompetitiveProfile`.
- Rollback is limited to `gameAudioPlayer.ts` and the session-id collection in
  `RoomService.project`.
