import { describe, expect, it } from "vitest";
import {
  selectBotFillGroup,
  selectMatchmakingGroup,
  type MatchmakingCandidate,
} from "./matchmaking-algorithm.js";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");

function candidate(
  sessionId: string,
  rankLevel: number,
  waitMs: number,
  recentOpponentSessionIds?: readonly string[],
  party?: { id: string; size: number },
): MatchmakingCandidate {
  return {
    sessionId,
    rankLevel,
    enqueuedAt: new Date(NOW - waitMs).toISOString(),
    ...(recentOpponentSessionIds === undefined ? {} : { recentOpponentSessionIds }),
    ...(party === undefined ? {} : { partyId: party.id, partySize: party.size }),
  };
}

describe("selectBotFillGroup", () => {
  const bots = Array.from({ length: 10 }, (_, index) => ({
    sessionId: `bot-${index}`,
    rankLevel: index < 7 ? 0 : 9 + (index - 7) * 4,
    lastMatchedAt: index < 3 ? `2026-07-28T11:5${index}:00.000Z` : null,
  }));

  it("does not fill before the minimum wait has elapsed", () => {
    expect(selectBotFillGroup([candidate("human", 0, 4_999)], bots, NOW)).toBeNull();
  });

  it("fills a solo room after the minimum wait, ignoring rank entirely", () => {
    // Pool sized to exactly the number of seats needed so the random
    // selection is deterministic (every idle bot must be used).
    const threeBots = bots.slice(0, 3);
    const selected = selectBotFillGroup([candidate("human", 0, 5_001)], threeBots, NOW);

    expect(selected?.humans.map((item) => item.sessionId)).toEqual(["human"]);
    expect(selected?.bots.map((item) => item.sessionId).sort()).toEqual(["bot-0", "bot-1", "bot-2"]);
  });

  it("can pick a bot whose rank is wildly different from the humans", () => {
    const farBots = [
      { sessionId: "far-bot-1", rankLevel: 9_999, lastMatchedAt: null },
      { sessionId: "far-bot-2", rankLevel: 9_999, lastMatchedAt: null },
      { sessionId: "far-bot-3", rankLevel: 9_999, lastMatchedAt: null },
    ];
    const selected = selectBotFillGroup([candidate("human", 0, 5_001)], farBots, NOW);

    expect(selected?.bots.map((item) => item.sessionId).sort()).toEqual([
      "far-bot-1",
      "far-bot-2",
      "far-bot-3",
    ]);
  });

  it("keeps a complete party together and maximizes humans before bots", () => {
    const selected = selectBotFillGroup(
      [
        candidate("party-a", 0, 6_000, undefined, { id: "party", size: 2 }),
        candidate("party-b", 1, 6_000, undefined, { id: "party", size: 2 }),
        candidate("solo", 2, 5_500),
      ],
      bots,
      NOW,
    );

    expect(selected?.humans.map((item) => item.sessionId)).toEqual(["party-a", "party-b", "solo"]);
    expect(selected?.bots).toHaveLength(1);
  });

  it("does not split an incomplete party roster", () => {
    const selected = selectBotFillGroup(
      [
        candidate("party-a", 0, 6_000, undefined, { id: "party", size: 2 }),
        candidate("solo", 0, 6_000),
      ],
      bots,
      NOW,
    );

    expect(selected?.humans.map((item) => item.sessionId)).toEqual(["solo"]);
  });

  it("refuses to fill when there are not enough idle bots for the remaining seats", () => {
    expect(selectBotFillGroup([candidate("human", 0, 5_001)], bots.slice(0, 2), NOW)).toBeNull();
  });
});

describe("selectMatchmakingGroup", () => {
  it("requires four candidates", () => {
    expect(
      selectMatchmakingGroup(
        [candidate("a", 0, 0), candidate("b", 0, 0), candidate("c", 0, 0)],
        NOW,
      ),
    ).toBeNull();
  });

  it("matches candidates regardless of rank distance, even with no wait at all", () => {
    // Rank is no longer a matching criterion, so wildly different ranks
    // (and zero wait time) must still form a table.
    const group = selectMatchmakingGroup(
      [candidate("a", 0, 0), candidate("b", 50, 0), candidate("c", 500, 0), candidate("d", 9_999, 0)],
      NOW,
    );
    expect(group?.map((item) => item.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("starts from the oldest candidate that can form a complete-party group", () => {
    // "blocked" can't be seated because it would split its own party (the
    // rest of its roster isn't in the queue), so the anchor search must
    // move on to the next oldest candidate instead of rejecting outright.
    const group = selectMatchmakingGroup(
      [
        candidate("blocked", 0, 1_000, undefined, { id: "away-party", size: 2 }),
        candidate("oldest-valid", 10, 900),
        candidate("b", 10, 800),
        candidate("c", 11, 700),
        candidate("d", 12, 600),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual(["oldest-valid", "b", "c", "d"]);
  });

  it("prefers the earliest-enqueued group when multiple valid combinations exist", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("anchor", 10, 5_000),
        candidate("early-1", 10, 4_000),
        candidate("early-2", 11, 3_000),
        candidate("early-3", 12, 2_000),
        candidate("late", 8, 1_000),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual([
      "anchor",
      "early-1",
      "early-2",
      "early-3",
    ]);
  });

  it("softly avoids recent opponents when another valid group exists", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("anchor", 10, 5_000, ["recent"]),
        candidate("recent", 10, 4_000),
        candidate("fresh-1", 10, 3_000),
        candidate("fresh-2", 11, 2_000),
        candidate("fresh-3", 12, 1_000),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual([
      "anchor",
      "fresh-1",
      "fresh-2",
      "fresh-3",
    ]);
  });

  it("still matches recent opponents when they are the only valid group", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("anchor", 10, 5_000, ["recent"]),
        candidate("recent", 10, 4_000),
        candidate("b", 11, 3_000),
        candidate("c", 12, 2_000),
      ],
      NOW,
    );

    expect(group).not.toBeNull();
  });

  it.each([
    [
      "2+1+1",
      [
        candidate("a", 10, 5_000, undefined, { id: "party-a", size: 2 }),
        candidate("b", 11, 5_000, undefined, { id: "party-a", size: 2 }),
        candidate("c", 11, 4_000),
        candidate("d", 12, 3_000),
      ],
    ],
    [
      "2+2",
      [
        candidate("a", 10, 5_000, undefined, { id: "party-a", size: 2 }),
        candidate("b", 11, 5_000, undefined, { id: "party-a", size: 2 }),
        candidate("c", 10, 4_000, undefined, { id: "party-b", size: 2 }),
        candidate("d", 11, 4_000, undefined, { id: "party-b", size: 2 }),
      ],
    ],
    [
      "3+1",
      [
        candidate("a", 10, 5_000, undefined, { id: "party-a", size: 3 }),
        candidate("b", 10, 5_000, undefined, { id: "party-a", size: 3 }),
        candidate("c", 11, 5_000, undefined, { id: "party-a", size: 3 }),
        candidate("d", 12, 4_000),
      ],
    ],
    [
      "4",
      [
        candidate("a", 0, 5_000, undefined, { id: "party-a", size: 4 }),
        candidate("b", 10, 5_000, undefined, { id: "party-a", size: 4 }),
        candidate("c", 20, 5_000, undefined, { id: "party-a", size: 4 }),
        candidate("d", 30, 5_000, undefined, { id: "party-a", size: 4 }),
      ],
    ],
  ])("keeps a valid %s party composition together", (_label, candidates) => {
    expect(selectMatchmakingGroup(candidates, NOW)?.map((item) => item.sessionId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("does not split a party when only part of its frozen roster is online", () => {
    expect(
      selectMatchmakingGroup(
        [
          candidate("party-a", 10, 5_000, undefined, { id: "party", size: 2 }),
          candidate("solo-a", 10, 4_000),
          candidate("solo-b", 10, 3_000),
          candidate("solo-c", 10, 2_000),
          candidate("solo-d", 10, 1_000),
        ],
        NOW,
      )?.map((item) => item.sessionId),
    ).toEqual(["solo-a", "solo-b", "solo-c", "solo-d"]);
  });
});
