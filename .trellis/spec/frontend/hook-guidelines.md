# Frontend Hook Guidelines

## Current implementation

`apps/web/src/hooks/useRoom.ts` owns the authoritative `RoomProjection`, one Socket.IO connection, full-snapshot recovery, chat buffer, and room mutations. `App` consumes this controller; leaf table and tile components receive callbacks and projections through props only.

## Conventions

- Prefix custom hooks with `use` and keep one public hook per file.
- Socket subscription hooks subscribe once, clean up the **exact** named handlers, and expose typed projections from `@huanghuang/protocol`.
- Reuse the subscription Socket for commands. Creating a short-lived command Socket would trigger disconnect trustee behavior and is forbidden.
- Network mutations return command acknowledgements; they do not mutate the authoritative projection locally on optimistic success.
- Replace projections only when their version is not older than the current version. A `room:update` notification triggers `GET /api/rooms/:code` rather than carrying private state in a broadcast.
- Timer display uses the server deadline; the client never decides timeout winners.
- Track connection state explicitly as `connecting | connected | reconnecting`. Every Socket `connect` must re-send `room:subscribe`; disconnect and connect-error handlers lock game input until a fresh snapshot is applied.
- Let Socket.IO own ordinary transport-error retries. Do not also recreate the
  Socket from every `connect_error`: a delayed manual timer can destroy a
  connection that the built-in backoff already recovered. Reserve a bounded
  hard-recreate watchdog for `io server disconnect` (automatic reconnect is
  disabled) and Manager `reconnect_failed`; cancel it on `connect`, and reset
  its one-attempt budget only after a fresh subscription projection arrives.
- Use a synchronous mutation ref around every room mutation and command, then expose `pendingAction` / `busy` for UI feedback. Clear the lock on acknowledgement, failure, or the bounded command timeout (`COMMAND_ACK_TIMEOUT_MS`, currently 8000).
- Give command acknowledgements a timeout and request a full snapshot after uncertainty. The client must never wait forever or invent the command result.
- Map stable error codes to Chinese player-facing labels in one place (`ERROR_LABELS` / `errorLabel` in `useRoom.ts`), not inside leaf components.
- A valid `?room=123456` URL may restore an existing anonymous member with `GET /api/rooms/:code` from `App.tsx`; a failed membership check falls back to the normal join form because the URL alone is not authorization. Use a cancellable mount effect so Strict Mode remounts still complete restoration.

## Required test points

- Subscription cleanup removes no unrelated listener.
- A version gap requests a full snapshot.
- Re-rendering does not create duplicate command submissions.
- Development Strict Mode cleanup followed by setup still completes URL restoration; do not pair an irreversible “already attempted” ref with a cancellable mount effect.
- Command ack timeout clears `pendingAction` and recovers via snapshot.

## Forbidden patterns

- No raw `socket.on` calls in leaf tile or table components.
- No rule calculation in hooks (no win/score/legal-action authority).
- No dependency-array suppression (`eslint-disable`) to hide lifecycle bugs.
- No unbounded acknowledgement waits or reconnect-only subscriptions that skip `room:subscribe`.
- No second Socket instance for REST-less command fan-out.
- No unconditional hard Socket recreation from `connect_error`.
