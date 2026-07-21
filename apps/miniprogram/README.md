# @huanghuang/miniprogram

WeChat mini-program client scaffold (Taro 4 + React) for 晃晃.

## Prerequisites

- Node.js 24 + pnpm 11 (repo root)
- [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- Running API (`pnpm --filter @huanghuang/server dev` or production HTTPS)

## Install

From repo root:

```bash
pnpm install
```

## Configure

| Variable / file | Purpose |
|-----------------|---------|
| `TARO_APP_API_BASE` | API origin at **build** time (default `http://127.0.0.1:3000`) |
| `project.config.json` → `appid` | Replace `touristappid` with your WeChat mini-program appId |
| WeChat 合法域名 | Production: request + socket 合法域名 = your HTTPS API host |

Examples:

```bash
# local server
pnpm --filter @huanghuang/miniprogram dev:weapp

# production API
TARO_APP_API_BASE=https://huanghuang.example.com pnpm --filter @huanghuang/miniprogram build:weapp
```

Auth contract: see [`docs/miniprogram-auth.md`](../../docs/miniprogram-auth.md).

## Open in WeChat DevTools

1. Build once: `pnpm --filter @huanghuang/miniprogram build:weapp` (outputs `apps/miniprogram/dist`).
2. DevTools → 导入项目 → directory **`apps/miniprogram`** (uses `project.config.json` `miniprogramRoot: dist/`).
3. For local HTTP API, disable domain check in DevTools (or set `urlCheck: false` in project config — already default for scaffold).
4. Smoke page: health check + `POST /api/session` token issue.

## Scripts

| Script | Command |
|--------|---------|
| Watch build (weapp) | `pnpm --filter @huanghuang/miniprogram dev:weapp` |
| Production weapp build | `pnpm --filter @huanghuang/miniprogram build:weapp` |
| Typecheck | `pnpm --filter @huanghuang/miniprogram typecheck` |

## Monorepo notes

- Depends on `@huanghuang/protocol` via `workspace:*`.
- Uses React 18 (Taro 4 support line); `apps/web` remains React 19 — do not share React instances across the two apps.
- Root `eslint` ignores `apps/miniprogram/**` compiled output; source is typechecked by package `tsc`.
- Root `pnpm build` runs package `build` scripts only when present — this package uses `build:weapp` intentionally so web/server CI is unchanged. Call `build:weapp` explicitly for mini-program artifacts.

## Out of scope (later tasks)

- Full table UI (`mp-core-client`)
- Real-device integration checklist (`mp-integration`)


## Core client pages

| Page | Path | Role |
|------|------|------|
| Home | `pages/index/index` | create friend/bot, join by code, issue session token |
| Room | `pages/room/index` | waiting room + playable table, Socket.IO commands |

Room handoff uses temporary storage key `huanghuang_open_room` after create/join.

## Realtime notes

Use `socket.io-mp` (WeChat native WebSocket transport). Plain `socket.io-client` does **not** work reliably in WeChat DevTools and will loop on “实时连接暂时中断，正在重连”.

Local DevTools still needs **不校验合法域名**. Server must be the `miniprogram` branch with token auth.

