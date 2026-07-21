# Mini-program friend room QA

Mini-program is the primary client; Web co-play is not required.

## Single device / one DevTools

1. Create friend room → note 6-digit code / tap **复制房号**.
2. Waiting lobby shows 4 seats from `lobbySeats`.
3. Ready / owner base score / dissolve / leave.

## Two clients (recommended)

Option A: two WeChat DevTools with different test accounts (or one simulator + one phone preview).  
Option B: two phones on same LAN with `TARO_APP_API_BASE=http://<lan-ip>:3000`.

Flow:

1. Client A: 创建房间 → 复制房号  
2. Client B: 加入房间 → 输入房号  
3. Both ready (and fill remaining seats with bots only if server mode allows—friend mode needs 4 humans per product rules)  
4. Play → leave/dissolve  

Server must be `miniprogram` branch with token auth.
