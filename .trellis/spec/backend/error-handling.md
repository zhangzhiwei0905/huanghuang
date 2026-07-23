# Backend Error Handling

## Categories

- **Validation errors**: schema/input failures. HTTP returns `400` with `{ error: "INVALID_INPUT" }`. Socket acks return `{ accepted: false, errorCode: "INVALID_COMMAND" | "INVALID_INPUT" }`.
- **Domain rejections**: legal schema but illegal or unavailable game/room action. State is unchanged. Prefer stable codes such as `ACTION_NOT_AVAILABLE`, `FORBIDDEN`, `NOT_A_MEMBER`, `ROOM_NOT_FOUND`, `VERSION_CONFLICT`, `ROOM_FULL`, `ROOM_NOT_JOINABLE`.
- **Infrastructure errors**: database, startup, or unexpected failures. Log with context at the handling boundary and return a generic failure to the client.

## Two response shapes

### HTTP room lifecycle (`apps/server/src/index.ts`)

```ts
const parsed = createRoomSchema.safeParse(request.body);
if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });

const room = rooms.join(...);
if (room === "ROOM_FULL") return reply.code(409).send({ error: "ROOM_FULL" });
if (room === "ACTION_NOT_AVAILABLE") {
  return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
}
```

Typical status usage today:

| Situation | HTTP | Body |
|-----------|------|------|
| Zod failure | 400 | `{ error: "INVALID_INPUT" }` |
| Domain conflict / not available | 409 | `{ error: "<CODE>" }` |
| Missing room / auth as used by route | 404 / 401 as implemented on that route | `{ error: "<CODE>" }` |

### Avatar data upload (`POST /api/upload/avatar-data`)

The mini-program sends a compressed PNG/JPEG as base64 JSON so experience
builds can use the normal request-domain allowlist. Decode and validate through
`apps/server/src/avatar-upload.ts`; do not write request bytes directly.

| Situation | HTTP | Body |
|-----------|------|------|
| Missing/malformed base64 or unsupported file signature | 400 | `{ error: "INVALID_AVATAR" }` |
| Encoded or decoded payload exceeds 2 MiB | 413 | `{ error: "AVATAR_TOO_LARGE" }` |
| Filesystem or unexpected failure | 500 | `{ error: "AVATAR_UPLOAD_FAILED" }` |

Keep infrastructure details in server logs only. The legacy multipart
`/api/upload/avatar` route remains for older clients, but the current
mini-program must use `/api/upload/avatar-data`.

### Socket game commands and chat

Commands are acknowledged with the shared `CommandResult` (or a thin `{ accepted: false, errorCode }` for pre-execute failures):

```ts
const parsed = commandEnvelopeSchema.safeParse(unknownCommand);
if (!parsed.success) {
  return acknowledge({ accepted: false, errorCode: "INVALID_COMMAND" });
}
const result = rooms.execute(sessionId, parsed.data);
// result: { accepted, requestId, serverVersion, errorCode, message }
acknowledge(result);
```

`RoomService.execute` reuses a stored result when `(session_id, request_id)` was already processed, so retries with the **same** `requestId` are safe. A newer request against a stale `expectedVersion` is rejected with `VERSION_CONFLICT`.

## Engine invariants

Pure engine functions return structured evaluations or throw only for violated internal invariants. For example, settlement functions throw if output is not zero-sum. Callers must not convert that invariant failure into an accepted command; treat it as infrastructure / programming error.

## Forbidden patterns

- Exposing stack traces to players.
- Logging cookies, raw session tokens, or recovery secrets.
- Using generic HTTP 200 / Socket success for a rejected command without `accepted: false`.
- Retrying a non-idempotent command with a **new** `requestId` after uncertainty; recover with a full snapshot first (`GET /api/rooms/:code`).
- Mapping every domain string to HTTP 500.
