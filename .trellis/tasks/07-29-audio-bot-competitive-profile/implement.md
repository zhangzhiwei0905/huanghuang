# Implementation

1. [x] Update `gameAudioPlayer.ts` with a versioned cache directory, one-shot
   warmup and temp-download-to-final-save flow.
2. [x] Extend `gameAudioPlayer.test.ts` for repeated warmup, cloud fallback before
   save, versioned local paths and failed-save behavior.
3. [x] Include non-null ranked bot session ids in `RoomService.project` profile
   lookup while preserving null profiles for ordinary bots.
4. [x] Extend the existing ranked-bot achievement regression test to assert the
   bot's projected rank/achievement values and add/retain the ordinary-bot
   null-profile assertion.
5. [x] Run focused tests, frontend/backend typecheck, full lint/test, and the real
   WeChat production build.
6. [x] Update the mini-program/backend specs with the cache-integrity and
   ranked-bot projection contracts, then commit and archive the task.

## Risk points

- `FileSystemManager.saveFileSync` must receive a real `tempFilePath`; a 2xx
  response without one remains a cache miss.
- Do not mark `localReady` until the final save succeeds.
- Do not include null-session practice bots in database profile queries.

## Verification and deployment

- Work commit: `cf0685e`
- Quality gate: lint, full typecheck, 426 tests, root build and real
  `build:weapp` all pass.
- Production: `https://huanghuang.amazingzz.xyz` reports version `1.0.2`,
  revision `cf0685e`; HTTPS readiness and Socket.IO polling handshake pass.
- Rollback container:
  `huanghuang-app-rollback-0fd10e6-20260729-210949`
- Pre-deploy data backup:
  `/home/zhangzhiwei/backups/huanghuang-data-pre-cf0685e-20260729-210949.tgz`
- The server projection fix is live. The audio cache fix is part of the built
  mini-program and becomes user-visible after the new mini-program package is
  uploaded/released.
