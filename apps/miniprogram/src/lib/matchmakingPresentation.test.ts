import { describe, expect, it } from "vitest";
import { matchmakingRangeLabel, matchmakingWaitSeconds } from "./matchmakingPresentation.js";

const queued = {
  status: "QUEUED" as const,
  enqueuedAt: "2026-07-28T12:00:00.000Z",
  disconnectedAt: null,
  rankLevelSnapshot: 0,
};

describe("matchmaking presentation", () => {
  it("calculates nonnegative whole wait seconds", () => {
    expect(matchmakingWaitSeconds(queued, Date.parse(queued.enqueuedAt) - 1)).toBe(0);
    expect(matchmakingWaitSeconds(queued, Date.parse(queued.enqueuedAt) + 1_999)).toBe(1);
  });

  it.each([
    [0, "相差 2 级内"],
    [9, "相差 2 级内"],
    [10, "相差 5 级内"],
    [19, "相差 5 级内"],
    [20, "相差 10 级内"],
    [39, "相差 10 级内"],
    [40, "全服范围"],
  ])("maps %i seconds to %s", (seconds, label) => {
    expect(matchmakingRangeLabel(seconds)).toBe(label);
  });
});
