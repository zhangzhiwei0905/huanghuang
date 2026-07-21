# Mini-program device QA checklist

Parent task: `07-21-miniprogram-port`  
Integration child: `07-21-mp-integration`

## Build & import

- [ ] `pnpm install`
- [ ] Start API: `pnpm --filter @huanghuang/server dev` (or production HTTPS)
- [ ] `pnpm --filter @huanghuang/miniprogram build:weapp` (or `dev:weapp`)
- [ ] WeChat DevTools → 导入项目 → directory `apps/miniprogram`
- [ ] Confirm `project.config.json` `appid` (`touristappid` OK for local; replace for real app)
- [ ] Local HTTP: keep DevTools “不校验合法域名” on

## Production domain notes

| Item | Value |
|------|--------|
| Request 合法域名 | HTTPS host of `apps/server` (no path) |
| Socket 合法域名 | Same host (WSS) |
| Build-time API | `TARO_APP_API_BASE=https://your.domain` |
| Auth | `docs/miniprogram-auth.md` — Bearer / `X-Session-Token` |

## Functional checklist (simulator)

- [ ] Home shows `API_BASE`
- [ ] Create **人机对战** → enters room page with room code
- [ ] Waiting: Ready works; bot seats fill / game starts per server rules
- [ ] Playing: hand tiles render; legal action buttons appear; discard/pong/kong/win/pass as offered
- [ ] Brief network toggle → reconnect status → can continue after sync
- [ ] Round result → **再来一局** (bot mode)
- [ ] Leave / dissolve returns to empty room state / home

## Functional checklist (real device preview)

- [ ] Same as simulator against reachable API (LAN IP or HTTPS)
- [ ] Token survives app background briefly
- [ ] No permanent soft-lock after reconnect

## Web regression smoke

- [ ] Browser `pnpm dev` create/join still works with **cookie** session

## Known limitations (MVP)

- UI is functional, not pixel-parity with web table art / dual theme
- No friend-room chat UI
- Landscape: page uses normal phone layout; not forced system landscape
- Socket.IO on some WeChat bases may prefer polling first; client allows `websocket` + `polling`
- `wx.login` openId persistence not stored server-side yet (optional endpoint issues anonymous token only)
- Formal WeChat 审核/发布 out of scope

## Automation already green (CI-local)

```bash
pnpm lint
pnpm typecheck   # includes @huanghuang/miniprogram when script present
pnpm test
pnpm --filter @huanghuang/miniprogram build:weapp
pnpm --filter @huanghuang/web build
```
