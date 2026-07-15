# Logging Guidelines

## Runtime logging

Fastify owns structured runtime logging. `apps/server/src/index.ts` creates the application with `Fastify({ logger: true })`, which records server startup, request method/path, response status and elapsed time as JSON.

Use these levels consistently:

- `info`: startup, shutdown and room lifecycle milestones that help operate the service.
- `warn`: rejected or recoverable infrastructure conditions such as repeated version conflicts or delayed timers.
- `error`: failed persistence, unrecoverable room restoration or an exception that prevents a command from completing.
- `debug`: local diagnosis only; it must remain disabled in normal production use.

## Safe context

Logs may contain opaque room IDs, room version, command type, stable error code and elapsed time. Prefer machine-readable context fields over composed messages.

Never log:

- anonymous session cookies, raw session tokens or token hashes;
- a player's concealed hand, the wall order or the complete persisted room JSON;
- nicknames when an opaque session or room ID is sufficient;
- command payloads that contain physical tile IDs unless a narrowly scoped local diagnosis explicitly requires them.

The `technical_logs` table is reserved for future retained application events. Do not write to it until retention and redaction are implemented together.

## Error handling relationship

Expected rule rejections are returned as stable command error codes and are not server errors. Log infrastructure failures once at the boundary where they are handled; do not log and rethrow the same failure through every layer.
