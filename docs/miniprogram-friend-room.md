# Mini-program friend room QA

Mini-program is the primary client; Web co-play is not required.

## Single device / one DevTools

1. Create friend room → note the new 4-digit code / tap **复制房号**.
2. Waiting lobby shows 4 seats from `lobbySeats`.
3. Owner adds/removes bots, changes the shared bot difficulty, then readies.
4. Ready / owner base score / dissolve / leave.

## Two clients (recommended)

Option A: two WeChat DevTools with different test accounts (or one simulator + one phone preview).  
Option B: two phones on same LAN with `TARO_APP_API_BASE=http://<lan-ip>:3000`.

Flow:

1. Client A: 创建房间 → 复制房号
2. Client B: 加入房间 → 输入房号
3. Owner fills remaining seats with bots; both humans ready (bots are auto-ready).
4. A third client joining during play enters spectator mode, sees no private hands, and replaces a bot after settlement.
5. All seated humans ready again before the next round → play / leave / dissolve.

Server must be `miniprogram` branch with token auth.

## Sharing an invite to a real friend (not a DevTools test account)

The in-room **分享邀请** button (`Button openType="share"`, wired via
`RoomPage`'s `useShareAppMessage`) shares a card whose `path` carries the
room code (`/pages/index/index?code=1234`) so the recipient's home page
opens straight into the "加入房间" form with the code pre-filled. This is a
client-side improvement only — whether the recipient can open the
mini-program **at all** depends on which of WeChat's three distribution
tiers the AppID is currently in, and that tier is configured entirely on
mp.weixin.qq.com, not in this repo:

| Tier                | Who can open it                                                                           | Where to configure                                             |
| ------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 开发版 (dev)        | Only accounts added as **项目成员** (need their WeChat account)                           | mp.weixin.qq.com → 管理 → 成员管理 → 添加项目成员              |
| 体验版 (trial)      | Only accounts added as **体验成员** (capped headcount, same "add by WeChat account" flow) | mp.weixin.qq.com → 管理 → 版本管理 → 设为体验版 → 添加体验成员 |
| 正式版 (production) | Anyone — search, scan, or open a shared card                                              | mp.weixin.qq.com → 版本管理 → 提交审核 → 审核通过后发布        |

The AppID here is already a properly registered mini-program (not a 测试号
sandbox account) with server domains whitelisted — see the "Production
Rollout" section in `.trellis/spec/frontend/miniprogram.md`. So if a real
friend's scan/share-card tap fails to open the mini-program at all (as
opposed to opening but failing to join), the fix is **not** in this
codebase: either add that friend's WeChat account as a member/tester in the
tables above, or submit for review to go fully public.
