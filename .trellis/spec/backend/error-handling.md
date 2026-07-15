# Backend Error Handling

## Categories

- Validation errors: expected client input failures, returned as stable error codes.
- Domain rejections: legal schema but illegal game action; state remains unchanged.
- Infrastructure errors: database, startup, or unexpected failures; log with context and return a generic failure.

## Pattern

Pure engine functions return structured evaluations or throw only for violated internal invariants. For example, settlement functions throw if output is not zero-sum; callers must not convert that invariant failure into an accepted command.

```ts
const parsed = commandEnvelopeSchema.safeParse(input);
if (!parsed.success) {
  return reject("INVALID_COMMAND");
}
return commandService.execute(parsed.data);
```

## API response

Use the shared `CommandResult` fields: `accepted`, `requestId`, `serverVersion`, `errorCode`, and `message`.

## Forbidden patterns

- Exposing stack traces to players.
- Logging cookies or recovery secrets.
- Using generic 200/success for a rejected command without `accepted: false`.
- Retrying a non-idempotent command with a new request ID.
