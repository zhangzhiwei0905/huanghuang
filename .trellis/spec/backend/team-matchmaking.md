# Team Ranked Matchmaking Contract

## 1. Scope and Trigger

This contract applies whenever `TEAM_MATCH` rooms, party matchmaking queue
entries, team-ranked HTTP endpoints, or their client projections are changed.
It covers a party of 2–4 linked players entering ranked matchmaking as one
indivisible unit.

## 2. Signatures

- Protocol:
  - `RoomMode`: `TEAM_MATCH`
  - `RoomProjection.teamMatchmaking`: `IDLE | QUEUED | MATCHED`
  - queued competitive state may include `partyRoomId`
- Database:
  - `enqueueMatchmakingParty(partyId, players, enqueuedAt)`
  - `listMatchmakingPartyEntries(partyId)`
  - `cancelMatchmakingParty(partyId)`
  - queue rows persist `party_id` and `party_size`
- HTTP:
  - `POST /api/rooms/:code/team-matchmaking`
  - `DELETE /api/rooms/:code/team-matchmaking`

## 3. Contracts

- A `TEAM_MATCH` room is a waiting room, not a playable Mahjong room.
- The owner may start matchmaking only when 2–4 human members are present and
  every member is ready.
- Party queue entries are inserted and removed atomically. The matchmaker must
  consume exactly four versioned queue rows before creating a ranked match.
- A party is indivisible. Valid four-player compositions include `4`, `3+1`,
  `2+2`, `2+1+1`, and `1+1+1+1`; a party must never be partially selected.
- Rank-distance checks still apply between different parties. Members inside
  the same party do not reject one another because of rank distance.
- Any party member may cancel. Cancellation removes the whole party from the
  queue and resets every member to unready.
- Queue expiry or disconnect cleanup has the same party-wide reset semantics.
- `matchmaking_entries` is authoritative while queued. The room's
  `teamQueueStartedAt` is a recovery marker used to detect a queue that vanished
  after a restart or expiry. Clients consume only the room projection.
- Once matched, the party room projects `MATCHED` with the created match room
  code. The client then enters the formal `MATCH` room.

## 4. Validation and Error Matrix

| Condition | Required result |
| --- | --- |
| Missing authentication | `401` |
| Account is not linked to WeChat | `403 WECHAT_LINK_REQUIRED` |
| Non-owner starts matchmaking | Reject with owner-only error |
| Party has fewer than 2 or more than 4 members | Reject |
| Any member is not ready | Reject |
| Party is already queued | Return or recover the existing queue state |
| Any member already has a current match | Recover that match instead of enqueueing |
| Any party member cancels a queued party | Remove all party rows and reset all readiness |
| Cancellation arrives after a match was created | Do not destroy the created match |

## 5. Good, Base, and Bad Examples

Good:

- A three-player party and one compatible solo player are selected together.
- A cancel request from the second party member removes all three party rows.
- Reconnecting clients recover the party room through `partyRoomId`.

Base:

- Four solo players are matched using the same queue and rank compatibility
  rules.

Bad:

- Enqueueing each party member independently without a shared `party_id`.
- Selecting only two members from a three-player party.
- Resetting only the cancelling player's ready state.
- Treating the client timer as authoritative queue state.

## 6. Required Tests

- Database tests for atomic 2–4 member enqueue, party listing, cancellation, and
  disconnect expiry.
- Algorithm tests for every supported composition and explicit no-split
  behavior.
- Service tests for party recovery and cancellation.
- Room-service tests for owner start, all-ready validation, party-wide reset,
  matched projection, and profile projection in non-ranked rooms.
- Client tests for schema normalization and one-time promotion replay keys.

## 7. Wrong vs. Correct

Wrong:

```ts
for (const sessionId of partySessionIds) {
  enqueueMatchmaking(sessionId);
}
```

This loses party identity and lets the matchmaker split members across games.

Correct:

```ts
enqueueMatchmakingParty(partySessionIds, roomId, now);
```

The database writes one atomic party-shaped batch, and the algorithm selects
the complete batch or none of it.
