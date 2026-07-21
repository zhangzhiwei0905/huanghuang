# Miniprogram integration and device QA

**Parent:** `07-21-miniprogram-port`  
**Ordering:** Last child; after core client + server auth landed.

## Goal

Prove the parent acceptance criteria on real device, document operator setup, and close the parent task.

## Requirements

- I1. Real-device WeChat preview of core path against shared backend (staging or prod HTTPS with 合法域名).
- I2. Web cookie smoke still OK after all changes.
- I3. README / deploy notes: appId placeholder, token auth, 合法域名 (request + socket), build commands.
- I4. Tick parent AC1–AC7 with evidence notes in this task or journal.
- I5. List known limitations (orientation, Socket quirks, deferred features).

## Acceptance Criteria

- [x] Parent AC1–AC7 satisfied (AC5 verified in WeChat DevTools: play/pong/discard).
- [x] Real device checklist recorded in `docs/miniprogram-device-qa.md`.
- [x] Docs merged for future sessions.

## Out of scope

- WeChat formal 审核通过.
- Building deferred chat/theme features.
