# Frontend Type Safety

## Type ownership

- Shared game and command types live in `packages/protocol/src`.
- Runtime payload validation uses the Zod schema next to the owning type.
- Component-only props stay next to the component.

The current source of truth is `packages/protocol/src/game.ts` and `packages/protocol/src/commands.ts`.

```ts
const parsed = commandEnvelopeSchema.safeParse(untrustedValue);
if (!parsed.success) {
  return { accepted: false, errorCode: "INVALID_COMMAND" };
}
```

## Required compiler settings

The project extends `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax` enabled.

## Forbidden patterns

- No `any` at protocol boundaries.
- No local casts from unknown Socket payloads.
- No non-null assertions in production code when a real branch can validate the value.
- No duplicate string unions for suit, rank, action, or win type.
