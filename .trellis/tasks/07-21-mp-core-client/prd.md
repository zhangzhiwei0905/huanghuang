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

- [ ] Friend room: four seats path testable (may use multiple tools/accounts or mixed web+mp if helpful) create/join/ready/start/play.
- [ ] Bot mode: solo vs bots playable end-to-end including continue.
- [ ] Disconnect/reconnect does not permanently soft-lock input without recovery path.
- [ ] Chat UI not required; premium theme not required.

## Out of scope

- Formal publish.
- Pixel-perfect parity with web CSS.
- Room chat.
