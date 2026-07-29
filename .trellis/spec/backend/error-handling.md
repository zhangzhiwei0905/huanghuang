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

## Scenario: Resume a stored WeChat profile

### 1. Scope / Trigger

Any change to mini-program login, logout, `openid` persistence or
`POST /api/auth/wechat` must preserve first-time profile consent while allowing
a returning WeChat identity to reuse its server-stored avatar and nickname.

### 2. Signatures

```ts
POST /api/auth/wechat
{ code: string; resumeOnly: true }

GameDatabase.resumeWechatSession(openId: string, tokenHash: string):
  AnonymousSession | null
```

### 3. Contracts

- The server exchanges `code` for `openid` with the configured
  `WECHAT_APP_ID` / `WECHAT_APP_SECRET`.
- When `resumeOnly === true`, an existing `openid` rotates only its token and
  `last_seen_at`; nickname and avatar URL remain unchanged.
- A missing `openid` returns `404 WECHAT_PROFILE_REQUIRED` and creates no
  session row. The client then opens explicit `chooseAvatar` +
  `Input type="nickname"` profile capture.
- A normal profile submission keeps the existing upsert behavior and may
  update the stored nickname/avatar.

### 4. Validation & Error Matrix

| Condition | HTTP | Body |
|---|---:|---|
| Missing/empty code | 400 | `{ error: "INVALID_INPUT" }` |
| WeChat code exchange rejected | 401 | `{ error: "WECHAT_AUTH_FAILED" }` |
| WeChat exchange unavailable | 502 | `{ error: "WECHAT_AUTH_UNAVAILABLE" }` |
| `resumeOnly` with unknown openid | 404 | `{ error: "WECHAT_PROFILE_REQUIRED" }` |
| `resumeOnly` with known openid | 200 | Stored nickname/avatar + new session token |

### 5. Good/Base/Bad Cases

- Good: a player who previously completed profile capture logs out, logs in
  again, and receives the same nickname/avatar with a rotated token.
- Base: a first-time player receives `WECHAT_PROFILE_REQUIRED` and is sent to
  native profile capture.
- Bad: creating a `"微信玩家"` row during resume, or overwriting a saved avatar
  with `null`.

### 6. Tests Required

- Database tests assert unknown openids create no rows.
- Database tests assert token rotation invalidates the old hash while preserving
  nickname and avatar.
- Mini-program build inspection asserts `resumeOnly: true` and
  `WECHAT_PROFILE_REQUIRED` handling are present.
- Real-device acceptance confirms a previously linked WeChat user skips repeat
  profile entry.

### 7. Wrong vs Correct

Wrong:

```ts
database.upsertWechatSession(
  { openId, nickname: "微信玩家", avatarUrl: null },
  tokenHash,
);
```

Correct:

```ts
const session = database.resumeWechatSession(openId, tokenHash);
if (session === null) {
  return reply.code(404).send({ error: "WECHAT_PROFILE_REQUIRED" });
}
```

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

## Deployment version endpoint

`GET /api/version` returns `{ version, builtAt, updatedAt, revision }` so the
client (and a human eyeballing `curl` output) can confirm which build is
actually running — deployment is entirely manual (no CI/CD), so this is the
only way to know whether a given production instance has picked up recent
changes.

- `version` is a `MAJOR.MINOR.PATCH` string (e.g. `1.0.3`), NOT the git sha —
  it auto-increments its patch number by exactly 1 every time the backend is
  genuinely redeployed, regardless of what the commit changed. It is
  persisted in a single-row `app_version` table (`apps/server/src/database.ts`,
  `id INTEGER PRIMARY KEY CHECK (id = 1)`) inside the same SQLite file as
  everything else, so it survives container rebuilds even though the image
  itself is stateless (the table lives on the persistent Docker volume, not
  in the image).
- **Bump decision** (`apps/server/src/version.ts`'s `resolveAppVersion`,
  computed once at server startup, never per-request): compares the current
  build's `APP_REVISION` (see below) against the `last_revision` stored from
  the previous startup.
  - Different revision → genuinely new deploy → `bumpPatch(storedVersion)`.
  - Same revision (a plain container restart / crash-restart, no rebuild) →
    version stays unchanged. This is the load-bearing guarantee: restarting
    the process must never bump the version on its own.
  - No stored row yet (first-ever run) → seeds `"1.0.0"`.
  - `APP_VERSION_OVERRIDE` env var, if set to a valid `\d+\.\d+\.\d+` string,
    always wins over the above and forces that exact version — this is a
    **one-time reset mechanism**: the deploy operator sets it only for the
    single deploy where they want to force a specific starting point (e.g.
    "start from 1.2.0"), then removes it; leaving it set would pin every
    future deploy to that same value instead of resuming auto-increment.
    A malformed override value is silently ignored (falls through to the
    normal logic above) rather than accepted as garbage or crashing startup.
- `revision` (git short sha) and `builtAt` (Docker image build timestamp)
  work exactly as before this redesign: `revision` comes from
  `process.env.APP_REVISION`, which only exists at runtime because
  `deploy/server.Dockerfile`'s runtime stage re-declares `ARG APP_REVISION`
  (Docker ARGs never carry across a new `FROM` stage without re-declaring
  them) and adds `ENV APP_REVISION=${APP_REVISION}` right after it.
  `builtAt` is a file (`/app/BUILD_TIME`), written once via `date -u` in the
  Dockerfile's build stage and copied into the runtime stage. Both are kept
  in the API response for engineering debugging even though the UI's primary
  display is now `version` + timestamp, not the raw sha.
- `updatedAt` is when this `version` number was last actually assigned
  (differs from `builtAt` only in edge cases; both are frozen across a plain
  restart with no rebuild).
- All of `version`/`revision`/`builtAt` degrade to safe defaults
  (`"1.0.0"`/`"unknown"`/`"unknown"`) rather than throwing when the env var
  or file is missing (e.g. running `pnpm dev` locally with no Docker build
  behind it).
- The deploy command that builds the image must `export
  APP_REVISION=$(git rev-parse --short HEAD)` first — whatever compose/build
  invocation is actually used only reads this from the invoking shell's
  environment, it does not compute it. Forgetting this export is silent:
  the build still succeeds, it just never triggers a version bump because
  `revision` stays `"unknown"` across every deploy (matches the "same
  revision → no bump" rule above, so this failure mode is at least safe,
  just wrong — the version number simply never moves).

### Frontend version (miniprogram)

There is no way to read, at build time, the version string a developer will
type into the WeChat DevTools upload dialog when publishing a 体验版 — that
field only exists in the DevTools UI at upload time, not in any source file.
So the frontend's displayed version instead tracks
`apps/miniprogram/package.json`'s `"version"` field, which the developer
must manually edit to match whatever they're about to type into the upload
dialog, before each build+upload. `TARO_APP_VERSION`/`TARO_APP_BUILT_AT` are
injected via `defineConstants` in `apps/miniprogram/config/index.ts` reading
that field (fallback `"0.0.0"` if unreadable) plus a build-time
`new Date().toISOString()`. This manual-sync convention is documented in a
comment directly above the reading code in that config file — don't remove
it or "improve" it into an automatic git-sha lookup again, that was the
exact thing the user asked to move away from.

### Gotcha: frontend must not crash on an old-shape backend response

Frontend and backend deploy independently. A frontend build can reach a
backend that hasn't been redeployed yet (or vice versa), so
`versionApi.get()` in `apps/miniprogram/src/api/http.ts` validates the
response shape (`version`/`builtAt` are strings) and throws instead of
blindly trusting the cast — an old backend still serving the pre-redesign
`{ revision, builtAt }` shape must surface as the existing "获取失败"
fallback in `AboutModal`, not render `"undefined · <timestamp>"`.

## Engine invariants

Pure engine functions return structured evaluations or throw only for violated internal invariants. For example, settlement functions throw if output is not zero-sum. Callers must not convert that invariant failure into an accepted command; treat it as infrastructure / programming error.

## Forbidden patterns

- Exposing stack traces to players.
- Logging cookies, raw session tokens, or recovery secrets.
- Using generic HTTP 200 / Socket success for a rejected command without `accepted: false`.
- Retrying a non-idempotent command with a **new** `requestId` after uncertainty; recover with a full snapshot first (`GET /api/rooms/:code`).
- Mapping every domain string to HTTP 500.
