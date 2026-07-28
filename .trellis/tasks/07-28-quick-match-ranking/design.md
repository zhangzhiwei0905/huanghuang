# Technical Design

## Architecture

```text
Mini-program matchmaking UI
  -> REST intents + Socket member events
  -> MatchmakingService
  -> GameDatabase queue/match transactions
  -> RoomService MATCH room + authoritative engine
  -> GameDatabase accepted-transition transaction
  -> member-specific RoomProjection / CompetitiveProfileProjection
```

`packages/protocol` owns shared contracts. A pure competitive-rank module owns every rank formula. `MatchmakingService` owns queue selection and connection grace. `RoomService` remains the only room/game authority. `GameDatabase` owns all SQL and atomic persistence.

## Domain Contracts

### Rank representation

Store `rankLevel: integer >= 0`:

- levels 0–34: `majorIndex = floor(level / 5)`, minor labels `Ⅴ,Ⅳ,Ⅲ,Ⅱ,Ⅰ`;
- levels >= 35: display `雀神${level - 34}级`.

Store `highestMajorIndex` for one-time promotion rewards and `protectionCards` as an integer balance. The rank transition function consumes only a current profile and authoritative multiplier/outcome, and returns a complete immutable result including before/after levels, raw delta, protected amount, cards before/after and newly granted cards.

### Rank settlement

For a win:

```text
winner multiplier = winBaseMultiplier * laiyouMultiplier * winnerPersonalMultiplier
payer multiplier  = paymentAmount / baseScore
level magnitude   = log2(multiplier) + 1
```

The server validates multipliers against `1|2|4|8|16|32|64`. Draw produces zero changes. Settlement uses `COMPETITIVE_RULE_VERSION = 1` and persists evidence with the result.

### Public profile

A public competitive profile contains display rank and four achievement totals. A self profile additionally contains numeric level and protection-card balance. Room projections embed public profiles for occupied real-account seats and `null` for robots.

## Persistence

Add additive tables:

- `competitive_profiles(session_id PK/FK, rank_level, highest_major_index, protection_cards, four counters, created_at, updated_at)`
- `matchmaking_entries(session_id PK/FK, rank_level_snapshot, enqueued_at, disconnected_at, version)`
- `competitive_matches(id PK, room_id UNIQUE, round_id, rule_version, status, result_json, created_at, settled_at)`
- `competitive_match_players(match_id, session_id, seat, pre/post rank, raw/final delta, protection details, multiplier, acknowledged_at, PK(match_id, session_id))`
- `competitive_action_events(event_key PK, match_id, session_id, round_id, round_version, action, created_at)`

Foreign keys use stable `anonymous_sessions.id`. Queue/match/profile methods remain inside `GameDatabase`.

### Atomic operations

1. `createCompetitiveMatch`: insert match and players, delete exactly four queue rows, save room snapshot in one transaction.
2. `saveAcceptedTransition`: save room, optional processed request, optional unique achievement event + counter increment, optional first terminal rank settlement in one transaction.
3. Facts drive counters: only an actually inserted `competitive_action_events` row increments a profile count.
4. Persist terminal settlement before updating the in-memory room and before any success projection is emitted.

## Matchmaking

`MatchmakingService` uses persisted entries plus an in-memory set of online socket counts. Each scheduler tick:

1. expire entries disconnected for at least 10 seconds;
2. order entries by `enqueuedAt`;
3. anchor at the oldest entry and enumerate eligible triples;
4. require every pair's level distance to be within both players' wait-derived windows;
5. rank groups by recent-opponent penalty, maximum level spread, total distance, then enqueue order;
6. ask `RoomService` to build a random-seat `MATCH` room and commit it through `createCompetitiveMatch`;
7. emit member-specific `MATCHED` states/projections.

The queue is single-instance by contract. Startup removes disconnected/stale queue entries; active matches survive through room snapshots and match rows.

## MATCH Room Lifecycle

Extend `RoomMode` with `MATCH`. A competitive room:

- contains four `humanSeat` entries and fixed score/timeout settings;
- calls the existing `startRound` immediately;
- rejects friend-room lifecycle operations;
- treats page exit/disconnect as `TRUSTEE` without removing the session;
- stops at `ROUND_RESULT` after one outcome;
- is closed after all members acknowledge or a bounded settlement-retention timeout.

`leaveRoom` must branch for `MATCH`: during play it marks the member disconnected/trustee but retains membership; after settlement it acknowledges/returns the member without invalidating the other players' result.

## Accepted Action and Terminal Detection

Compare the previous round to the accepted result before `acceptRule`. The effect descriptor provides the actor and one of the four achievement actions. Create an achievement fact only for `MATCH` and a non-null seat session.

When an accepted result contains a terminal outcome, calculate and persist the competitive settlement in the same transaction as the pending effect snapshot. Effect completion later exposes the already-persisted outcome and never applies rank again. Automatic trustee actions use the same clone -> derive facts -> transaction -> in-memory replace path as human commands.

## Transport

REST routes:

- `GET /api/competitive/profile`
- `GET /api/matchmaking/status`
- `POST /api/matchmaking/queue`
- `DELETE /api/matchmaking/queue`
- `POST /api/competitive/matches/:id/acknowledge`

All require an authenticated WeChat-linked session. Socket member events push matchmaking state and member-specific room projections. Socket presence is reference-counted per `sessionId`; only 0->1 and 1->0 transitions update queue/room connectivity.

## Mini-Program State

The home page loads self profile and matchmaking status after identity resolution. Queue state is server-owned; local state only controls the open matching panel. `MATCHED` writes the projection to the existing handoff storage and navigates to the room page.

The room page branches on `mode === MATCH`:

- no friend controls/share/chat;
- competitive start overlay;
- exit confirmation during play;
- terminal modal with rank result and `continue matchmaking` / `return lobby`;
- avatar and name both open the profile modal.

Room and settlement DTOs remain normalized at the boundary, and only newer projection versions replace local state.

## Compatibility and Rollout

- Increment the projection schema and normalize missing competitive fields for old snapshots.
- Existing FRIEND/BOT behavior and database rows remain valid.
- Web compiles against MATCH but does not expose matchmaking UI.
- Back up the SQLite volume before release. Rollback requires disabling new queue entries and draining MATCH rooms first because older code cannot interpret active MATCH snapshots.
