# Validation

## Visual fixtures

Captured with WeChat DevTools RC 2.02.2607171 at the iPhone 12/13 Pro landscape simulator size after a clean production build.

| Scenario | Screenshot | Result |
|---|---|---|
| Four seats, released wildcard only | `/private/tmp/huanghuang-public-rail-wildcard-only.png` | Top rail sits directly below identity; side rails stay on their owner edges; self rail stays above the hand. |
| Four seats, one meld plus released wildcard | `/private/tmp/huanghuang-public-rail-sparse.png` | Sparse rails shrink-wrap content with no empty grid column. |
| Four seats, four melds plus released wildcard | `/private/tmp/huanghuang-public-rail-dense.png` | Top/self remain one row; left/right use three columns and two rows; no rail overlaps the center panel, action button, hand, or another seat. |
| Local identity above a 14-tile hand | `/private/tmp/huanghuang-public-rail-dense.png` | Local identity is right-aligned in the reserved band above the hand and stays clear of the outer tile. |
| Ting helper with mixed hard/soft waits | `/private/tmp/huanghuang-ting-card.png` | Compact warm-white overlay; hard waits precede soft waits; two visible rows contain no large blank gutter; the discard button stays in its normal position below the overlay. |

## Automated checks

- `pnpm lint` — passed.
- `pnpm --filter @huanghuang/miniprogram typecheck` — passed.
- `pnpm exec prettier --check "apps/miniprogram/src/**/*.{ts,tsx,scss}"` — passed.
- `pnpm --filter @huanghuang/miniprogram build:weapp` — passed.
- `pnpm typecheck` — all workspace packages passed.
- `pnpm test` — 21 files and 136 tests passed.
- `pnpm build` — protocol, game engine, web, server, and miniprogram production builds passed.
- Create-room protocol accepts only 20, 25, or 30 seconds; omitted legacy requests default to 20 seconds and invalid values are rejected.
- Room-service coverage verifies a 30-second choice is projected to clients and produces a server-authoritative human turn deadline of about 30 seconds.
- The compiled create-room page contains the native 20/25/30-second picker and submits the selected value.
- `apps/miniprogram/dist/common.js` contains `https://huanghuang.amazingzz.xyz`.
- `apps/miniprogram/dist/pages/index/index.wxml` and `apps/miniprogram/dist/pages/room/index.wxml` both exist.

## Production deployment

- A consistent SQLite backup was captured with `huanghuang-app` stopped:
  `/home/zhangzhiwei/backups/huanghuang-pre-turn-timeout-20260725-151839-safe.sqlite`.
- The previous `huanghuang-app:4267ffb` container remains on the server as
  `huanghuang-app-rollback-4267ffb-20260725-151839`.
- The deployed container uses the new server and web build outputs, keeps the
  existing `huanghuang_game_data` volume, and exposes the unchanged
  `127.0.0.1:13000` upstream.
- Both `http://127.0.0.1:13000/health/ready` and
  `https://huanghuang.amazingzz.xyz/health/ready` returned ready after cutover.
