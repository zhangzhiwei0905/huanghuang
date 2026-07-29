import { describe, expect, it } from "vitest";
import {
  matchmakingRange,
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

describe("matchmakingRange", () => {
  it.each([
    [0, 2],
    [9_999, 2],
    [10_000, 5],
    [19_999, 5],
    [20_000, 10],
    [39_999, 10],
    [40_000, Number.POSITIVE_INFINITY],
  ])("maps %i milliseconds to %s levels", (waitMs, expected) => {
    expect(matchmakingRange(waitMs)).toBe(expected);
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
