# Miniprogram port of huanghuang game

## Goal

Deliver a WeChat mini-program client for 晃晃 that plays the existing four-player digital mahjong game (friend rooms + bot mode) on a real device, reusing the authoritative `apps/server`, `packages/protocol`, and game rules—without requiring formal WeChat app-store publish in this effort.

## Background

- Web client: `apps/web` (React 19 + Vite + `socket.io-client`).
- Server: Fastify + Socket.IO + SQLite; anonymous sessions via cookie `huanghuang_session` (`SessionService.resolve` / `ensure`); Socket.IO middleware currently authenticates only via cookie header (`resolveRawCookie`).
- Shared packages: `@huanghuang/protocol`, `@huanghuang/game-engine`.
- No account system, matchmaking, history, or replay in the product MVP.
- Branch target for implementation: `miniprogram` from `main` (create when the first child starts implementation—not during planning alone).

## Requirements

- R1. **Platform:** WeChat mini-program only for MVP acceptance.
- R2. **Stack:** Taro 4 + React app in the monorepo (e.g. `apps/miniprogram`).
- R3. **Core parity:** create/join, ready, owner base score, leave/dissolve, friend + bot modes, full in-round play driven by server `legalActions` / projections, reconnect/trustee, bot continue-after-round.
- R4. **Deferred:** friend-room chat, premium theme, PWA/install behaviors, formal WeChat review/publish, non-WeChat mini-program targets.
- R5. **Auth:** mini-program uses persisted session **token in HTTP headers and Socket auth**; Web **cookie** path remains supported. Optional `wx.login` code → openId-linked anonymous session (not a full account product).
- R6. **Backend:** same `apps/server` instance/model as Web (shared rooms/DB); WeChat request/socket 合法域名 point at existing HTTPS host.
- R7. **Acceptance bar:** WeChat developer tools + **real-device preview** core path; not formal publish.
- R8. **Layout:** playable phone landscape (or documented best-effort) table UX for the core path.
- R9. Delivery is split into four child tasks (see Task map); parent owns integration acceptance AC1–AC7.

## Task map (children)

| Child | Owns | Depends on (ordering note) |
|-------|------|----------------------------|
| `07-21-mp-server-auth` | Server token + Socket auth; Web cookie regression; optional WeChat code exchange | — (first) |
| `07-21-mp-taro-scaffold` | Taro WeChat app package, build to devtools, protocol import, env base URL | can parallel auth after API sketch |
| `07-21-mp-core-client` | Lobby, waiting room, table UI/state, commands | scaffold + auth contract |
| `07-21-mp-integration` | Real device QA, docs, parent AC closeout | core client + auth |

Parent does not implement app code itself; it owns cross-child acceptance and final review.

## Acceptance Criteria (parent / integration)

- [x] AC1. WeChat mini-program builds via Taro from the monorepo and opens in WeChat devtools. (build:weapp green; import path documented)
- [x] AC2. Anonymous session works via header token without browser cookies; Web cookie path still works for `apps/web`. (server tests + dual auth)
- [x] AC3. Friend-room and bot-mode core client paths implemented against shared server APIs/Socket. **Device multi-seat friend E2E** still operator-verified via `docs/miniprogram-device-qa.md`.
- [x] AC4. Client implements subscribe/ack/reconnect+refresh. **Real-device blip** remains on device QA checklist.
- [ ] AC5. Real-device preview completes the same core path as devtools. *(operator — see device QA doc)*
- [x] AC6. Docs record appId placeholder, API base URL, and WeChat 合法域名 notes. (`apps/miniprogram/README.md`, `docs/miniprogram-auth.md`, `docs/miniprogram-device-qa.md`)
- [x] AC7. Chat, premium theme, and formal WeChat publish are not required to close.

## Out of scope

- Alipay / Douyin / other mini-program runtimes.
- Client-side rule authority or scoring rewrite.
- Native iOS/Android store apps.
- Ranked matchmaking, paid features, history, replay.
- Friend chat, dual theme, PWA parity, formal WeChat提交审核通过.

## Technical notes (summary; detail in design.md)

- Extend `SessionService` to resolve Bearer (or `X-Session-Token`) **or** cookie; issue token to mini-program clients (response body and/or header) because `Set-Cookie` is not reliable there.
- Socket.IO handshake must accept the same token (auth payload / header), not only cookie.
- Mini-program cannot use browser `fetch` cookie jar, `localStorage` DOM APIs identically—use Taro storage and `Taro.request` / Socket client adapted for WeChat.
- Reuse pure TS from web where possible (`actionButtons`, `actionEligibility`, etc.) after stripping DOM assumptions; do not import `apps/web` React DOM components wholesale.
- Production Web static hosting remains; mini-program is a separate client artifact.

## Decisions log

| Decision | Choice |
|----------|--------|
| Platforms | WeChat only |
| Framework | Taro 4 + React |
| Feature parity | Core path; chat/premium/PWA deferred |
| Auth | Header token + optional wx.login; cookie kept |
| Backend | Same apps/server |
| Release bar | Devtools + real device |
| Structure | Parent + 4 children |
