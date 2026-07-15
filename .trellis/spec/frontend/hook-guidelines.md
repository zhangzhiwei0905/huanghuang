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

## Required test points

- Subscription cleanup removes no unrelated listener.
- A version gap requests a full snapshot.
- Re-rendering does not create duplicate command submissions.

## Forbidden patterns

- No raw `socket.on` calls in leaf tile components.
- No rule calculation in hooks.
- No dependency-array suppression to hide lifecycle bugs.
