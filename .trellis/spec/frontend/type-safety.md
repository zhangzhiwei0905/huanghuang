# Frontend Type Safety

## Type ownership

| Kind | Location | Rule |
|------|----------|------|
| Shared game / command / projection types | `packages/protocol/src` (`game.ts`, `commands.ts`, `projections.ts`) | Import from `@huanghuang/protocol` only |
| Runtime payload validation | Zod schemas next to owning types in protocol; server runs them at the boundary | Client trusts typed projections after HTTP/Socket layers; does not reimplement server schemas ad hoc |
| Component-only props | Next to the component (`GameTableProps`, `MahjongTileProps`, …) | Do not put these in protocol |
| Pure UI helper models | Colocated modules (`ActionButtonModel`, `HandHighlight`, `PlayerActionNotice`, …) | Derive from protocol types via `Extract` / mapped types; do not invent parallel action unions |

```ts
import type { CommandEnvelope, RoomProjection } from "@huanghuang/protocol";

// Presentation-only extract of command types that own dock buttons
export type PrimaryGameAction = Extract<
  CommandEnvelope["type"],
  | "DISCARD_TILE"
  | "RELEASE_WILDCARD"
  | "CLAIM_PONG"
  // …
>;
```

## Required compiler settings

The project extends `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax` enabled. Prefer `import type` for type-only imports.

## Patterns in this app

- `api.ts` throws `ApiError` with a stable `code` string from HTTP `{ error }`; UI maps codes to labels in `useRoom.ts` (`ERROR_LABELS`), not by parsing free-form English.
- `createCommand` always sets a new `requestId` (`crypto.randomUUID()`) and `expectedVersion: room.version`.
- Socket and REST paths that accept untrusted input validate on the **server**. The client still types acknowledgements as `CommandResult | { accepted: false; errorCode: string }`.
- Pure helpers accept `RoomProjection` / `PlayerProjection` / `Tile` and return serializable decision objects — easy to unit-test without React.

## Forbidden patterns

- No `any` at protocol boundaries.
- No local casts from unknown Socket payloads into game types without a validated path.
- No non-null assertions in production code when a real branch can validate the value.
- No duplicate string unions for suit, rank, action, seat, win type, or room stage — reuse protocol types.
- No redefinition of `RoomProjection` fields inside components.
