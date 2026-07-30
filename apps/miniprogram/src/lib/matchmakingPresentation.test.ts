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
    [0, "同大段内"],
    [9, "同大段内"],
    [10, "相邻大段内"],
    [19, "相邻大段内"],
    [20, "2 个大段内"],
    [39, "2 个大段内"],
    [40, "全服范围"],
  ])("maps %i seconds to %s", (seconds, label) => {
    expect(matchmakingRangeLabel(seconds)).toBe(label);
  });
});
