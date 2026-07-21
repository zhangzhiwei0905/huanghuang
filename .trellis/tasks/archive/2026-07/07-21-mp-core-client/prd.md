# Miniprogram core client game path

**Parent:** `07-21-miniprogram-port`  
**Ordering:** After scaffold exists and server token auth is available (local or deployed).

## Goal

Implement the WeChat mini-program core product path: home (create/join), waiting room, playable table, commands/projections, reconnect—without chat or premium theme.

## Requirements

- C1. Home: nickname, create friend/bot room, join by 6-digit code.
- C2. Waiting: ready toggle, owner base score, leave/dissolve as on web core.
- C3. Playing: render projection (hands/melds/discards/legal actions), send commands with `requestId` + `expectedVersion`.
- C4. Single shared Socket; re-subscribe on connect; snapshot on `room:update` / version gap.
- C5. Persist session token; attach to REST + Socket.
- C6. Bot continue + reconnect/trustee UX sufficient to finish a game.
- C7. One theme; landscape-oriented table layout best-effort on phone.
- C8. Prefer pure helper reuse from web patterns; no game-engine import; no client rule authority.

## Acceptance Criteria

- [x] Friend room: create/join/ready/settings/dissolve/leave UI + server commands wired (device multi-seat play deferred to integration).
- [x] Bot mode: create BOT room, play actions, continue button on ROUND_RESULT (device E2E in integration).
- [x] Disconnect/reconnect path: socket reconnect + snapshot refresh + pending lock (device verification in integration).
- [x] Chat UI not required; premium theme not required.

## Out of scope

- Formal publish.
- Pixel-perfect parity with web CSS.
- Room chat.
