# Taro WeChat scaffold in monorepo

**Parent:** `07-21-miniprogram-port`  
**Ordering:** Can parallel `mp-server-auth` after token response shape is known; must finish before core client UI work.

## Goal

Add a Taro 4 + React WeChat mini-program package to the pnpm workspace that compiles and opens in WeChat developer tools, with typed access to `@huanghuang/protocol` and configurable API base URL.

## Requirements

- T1. New workspace app (e.g. `apps/miniprogram`) with Taro 4 React WeChat target.
- T2. Integrates with root tooling where practical (typescript, eslint—document any Taro exceptions).
- T3. Environment/config for API origin (dev vs prod HTTPS).
- T4. Placeholder appId configuration documented.
- T5. Minimal smoke page proving build + optional health/ping or static hello.
- T6. Does not break existing `pnpm build` / web/server workspace scripts.

## Acceptance Criteria

- [x] `pnpm` install/build path for the mini-program is documented and works.
- [x] Project opens in WeChat devtools (simulator). (import apps/miniprogram; dist built)
- [x] Can import types from `@huanghuang/protocol`.
- [x] Base URL configuration is not hard-coded to localhost-only for production builds. (`TARO_APP_API_BASE`)

## Out of scope

- Full game UI (child `mp-core-client`).
- Server auth implementation (child `mp-server-auth`).
