import { describe, expect, it } from "vitest";
import {
  matchmakingMajorTierRange,
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

describe("matchmakingMajorTierRange", () => {
  it.each([
    [0, 0],
    [9_999, 0],
    [10_000, 1],
    [19_999, 1],
    [20_000, 2],
    [39_999, 2],
    [40_000, Number.POSITIVE_INFINITY],
  ])("maps %i milliseconds to %s major tiers", (waitMs, expected) => {
    expect(matchmakingMajorTierRange(waitMs)).toBe(expected);
  });
});

describe("selectBotFillGroup", () => {
  const bots = Array.from({ length: 10 }, (_, index) => ({
    sessionId: `bot-${index}`,
    rankLevel: index < 7 ? 0 : 9 + (index - 7) * 4,
    lastMatchedAt: index < 3 ? `2026-07-28T11:5${index}:00.000Z` : null,
  }));

  it("fills a solo room after five seconds with the least recently used compatible bots", () => {
    const selected = selectBotFillGroup([candidate("human", 0, 5_001)], bots, NOW);

    expect(selected?.humans.map((item) => item.sessionId)).toEqual(["human"]);
    expect(selected?.bots.map((item) => item.sessionId)).toEqual(["bot-3", "bot-4", "bot-5"]);
  });

  it("keeps a complete party together and maximizes compatible humans before bots", () => {
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

  it("expands bot eligibility with the same 10, 20 and 40 second rank windows", () => {
    expect(selectBotFillGroup([candidate("human", 17, 5_001)], bots, NOW)).toBeNull();
    expect(
      selectBotFillGroup([candidate("human", 17, 20_001)], bots, NOW)?.bots.map(
        (item) => item.sessionId,
      ),
    ).toEqual(["bot-7", "bot-8", "bot-9"]);
    expect(selectBotFillGroup([candidate("human", 30, 40_001)], bots, NOW)?.bots).toHaveLength(3);
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

  it("can reach every preset bot when rank range is fully expanded", () => {
    for (const target of bots) {
      const candidates = bots.map((bot) => ({
        ...bot,
        lastMatchedAt: bot.sessionId === target.sessionId ? null : "2026-07-28T11:59:00.000Z",
      }));
      const selectedIds =
        selectBotFillGroup([candidate("human", 0, 40_001)], candidates, NOW)?.bots.map(
          (bot) => bot.sessionId,
        ) ?? [];
      expect(selectedIds).toContain(target.sessionId);
    }
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

  it("requires every pair to accept the rank distance", () => {
    expect(
      selectMatchmakingGroup(
        [
          candidate("old", 0, 40_000),
          candidate("new-1", 20, 0),
          candidate("new-2", 20, 0),
          candidate("new-3", 20, 0),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("matches candidates in adjacent major tiers sooner than the old raw-level ladder allowed", () => {
    // rankLevel 0 is 黑铁 (major 0), rankLevel 9 is 青铜 (major 1) — one major
    // tier apart, but 9 raw levels apart. Under the old raw-rankLevel ladder
    // (2 / 5 / 10 / ∞ at 10s / 20s / 40s) this pair needed the 20-40s bucket
    // (9 <= 10) to be considered compatible. Under the major-tier ladder
    // (0 / 1 / 2 / ∞), adjacent tiers only need the 10-20s bucket (1 <= 1) —
    // this is the actual fix for "large rank gap waits far too long".
    const group = selectMatchmakingGroup(
      [
        candidate("a", 0, 15_000),
        candidate("b", 9, 15_000),
        candidate("c", 9, 15_000),
        candidate("d", 9, 15_000),
      ],
      NOW,
    );
    expect(group?.map((item) => item.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("still refuses candidates two major tiers apart until the range is fully open", () => {
    // rankLevel 0 (major 0) vs rankLevel 10 (major 2): two major tiers apart,
    // so the 10-20s bucket (major distance <= 1) must still refuse them.
    expect(
      selectMatchmakingGroup(
        [
          candidate("a", 0, 15_000),
          candidate("b", 10, 15_000),
          candidate("c", 10, 15_000),
          candidate("d", 10, 15_000),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("widens the mutual window over time", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("a", 0, 20_000),
        candidate("b", 8, 20_000),
        candidate("c", 9, 20_000),
        candidate("d", 10, 20_000),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("starts from the oldest candidate that can form a valid group", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("blocked", 0, 1_000),
        candidate("oldest-valid", 10, 900),
        candidate("b", 10, 800),
        candidate("c", 11, 700),
        candidate("d", 12, 600),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual(["oldest-valid", "b", "c", "d"]);
  });

  it("prefers the closest group for the same oldest candidate", () => {
    const group = selectMatchmakingGroup(
      [
        candidate("anchor", 10, 5_000),
        candidate("near-1", 10, 4_000),
        candidate("near-2", 11, 3_000),
        candidate("near-3", 12, 2_000),
        candidate("far", 8, 1_000),
      ],
      NOW,
    );

    expect(group?.map((item) => item.sessionId)).toEqual(["anchor", "near-1", "near-2", "near-3"]);
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
