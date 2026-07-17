# Frontend Hook Guidelines

## Current implementation

`apps/web/src/hooks/useRoom.ts` owns the authoritative `RoomProjection`, one Socket.IO connection, full-snapshot recovery and room mutations. `App` consumes this controller; leaf table and tile components receive callbacks and projections through props.

## Conventions

- Prefix custom hooks with `use` and keep one public hook per file.
- Socket subscription hooks subscribe once, clean up the exact handler, and expose typed projections from `@huanghuang/protocol`.
- Reuse the subscription Socket for commands. Creating a short-lived command Socket would trigger disconnect trustee behavior and is forbidden.
- Network mutations return command acknowledgements; they do not mutate the authoritative projection locally.
- Replace projections only when their version is not older than the current version. A `room:update` notification triggers `GET /api/rooms/:code` rather than carrying private state in a broadcast.
- Timer hooks display a server deadline and never decide timeout behavior.
- Track connection state explicitly as `connecting | connected | reconnecting`. Every Socket `connect` must re-send `room:subscribe`; disconnect and connect-error handlers lock game input until a fresh snapshot is applied.
- Use a synchronous mutation ref around every room mutation and command, then expose `pendingAction` for UI feedback. Clear the lock on acknowledgement, failure, or the bounded command timeout.
- Give command acknowledgements a timeout and request a full snapshot after uncertainty. The client must never wait forever or invent the command result.
- Register named Socket handlers and remove those exact handlers during cleanup. Clear reconnect timers and transient chat timers as part of the same lifecycle.
- A valid `?room=123456` URL may restore an existing anonymous member with `GET /api/rooms/:code`; a failed membership check falls back to the normal join form because the URL alone is not authorization.

## Required test points

- Subscription cleanup removes no unrelated listener.
- A version gap requests a full snapshot.
- Re-rendering does not create duplicate command submissions.
- Development Strict Mode cleanup followed by setup still completes URL restoration; do not pair an irreversible “already attempted” ref with a cancellable mount effect.

## Forbidden patterns

- No raw `socket.on` calls in leaf tile components.
- No rule calculation in hooks.
- No dependency-array suppression to hide lifecycle bugs.
- No unbounded acknowledgement waits or reconnect-only subscriptions.
