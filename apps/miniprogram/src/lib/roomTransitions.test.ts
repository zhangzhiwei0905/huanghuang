import { describe, expect, it } from "vitest";
import { ROUND_START_COUNTDOWN_SECONDS, shouldShowRoundStart } from "./roomTransitions";

describe("shouldShowRoundStart", () => {
  it("starts a three-second overlay for a real waiting-to-playing transition", () => {
    expect(ROUND_START_COUNTDOWN_SECONDS).toBe(3);
    expect(shouldShowRoundStart("WAITING", "PLAYING")).toBe(true);
  });

  it.each([
    [null, "PLAYING"],
    ["PLAYING", "PLAYING"],
    ["ROUND_RESULT", "PLAYING"],
    ["ROUND_RESULT", "WAITING"],
    ["WAITING", "WAITING"],
    ["PLAYING", null],
  ] as const)("does not replay for %s → %s", (previousStage, nextStage) => {
    expect(shouldShowRoundStart(previousStage, nextStage)).toBe(false);
  });

  it("can trigger again after the next round returns to waiting", () => {
    expect(shouldShowRoundStart("ROUND_RESULT", "WAITING")).toBe(false);
    expect(shouldShowRoundStart("WAITING", "PLAYING")).toBe(true);
  });
});
