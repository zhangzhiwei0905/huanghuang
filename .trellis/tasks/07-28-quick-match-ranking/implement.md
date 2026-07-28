# Implementation Plan

## 1. Protocol and pure rank domain

- Add competitive rank/profile/matchmaking DTOs and schemas to `packages/protocol`.
- Extend room mode/projection/settlement contracts for MATCH and competitive results.
- Add pure rank formatting and transition functions with exhaustive boundary tests.

## 2. Database

- Add additive competitive profile, queue, match, player settlement and achievement fact tables.
- Add typed profile/queue/match read methods.
- Add atomic match creation and accepted-transition transactions.
- Cover creation, dedupe, rollback, restart and settlement idempotency with in-memory SQLite tests.

## 3. Services

- Add `MatchmakingService` with dynamic mutual windows, FIFO/level scoring, cancellation, presence grace and recovery.
- Extend `RoomService` with MATCH creation, lifecycle guards, trustee exit, match settlement projection and current-match lookup.
- Unify human and automatic accepted-rule persistence before mutating live room state.

## 4. Transport

- Add authenticated competitive profile, matchmaking and result acknowledgement routes.
- Add member-specific Socket matchmaking events and reference-counted session presence.
- Map stable domain errors to HTTP/Socket responses.

## 5. Mini-program

- Add matchmaking API/store/hook and home quick-start UI.
- Add queue panel, cancellation, resume and matched room handoff.
- Add MATCH table restrictions, exit confirmation and competitive settlement controls.
- Extend profile popover with rank/achievement data and avatar click support.
- Keep web type-compatible without a matchmaking entry.

## 6. Documentation and validation

- Update backend/frontend Trellis specs and public docs for MATCH, rank authority and single-instance limits.
- Run focused tests while implementing, then full lint, typecheck, test, monorepo build and mini-program production build.
- Verify the built mini-program flow and layout in WeChat DevTools/automation when available.

## Risk and Rollback Points

- Do not update live room memory before SQLite commits.
- Do not derive rank from `roundDelta`; use authoritative self-draw payment evidence.
- Do not include private profile fields in public room projections.
- Keep migrations additive and FRIEND/BOT snapshot normalization intact.
- Before production rollback, stop queue admission and drain active MATCH rooms.
