# Implementation

1. Update `gameAudioPlayer.ts` with a versioned cache directory, one-shot
   warmup and temp-download-to-final-save flow.
2. Extend `gameAudioPlayer.test.ts` for repeated warmup, cloud fallback before
   save, versioned local paths and failed-save behavior.
3. Include non-null ranked bot session ids in `RoomService.project` profile
   lookup while preserving null profiles for ordinary bots.
4. Extend the existing ranked-bot achievement regression test to assert the
   bot's projected rank/achievement values and add/retain the ordinary-bot
   null-profile assertion.
5. Run focused tests, frontend/backend typecheck, full lint/test, and the real
   WeChat production build.
6. Update the mini-program/state-management specs with the cache-integrity and
   ranked-bot projection contracts, then commit and archive the task.

## Risk points

- `FileSystemManager.saveFileSync` must receive a real `tempFilePath`; a 2xx
  response without one remains a cache miss.
- Do not mark `localReady` until the final save succeeds.
- Do not include null-session practice bots in database profile queries.
