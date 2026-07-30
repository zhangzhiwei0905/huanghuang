import { describe, expect, it } from "vitest";
import {
  remainingRoundStartSeconds,
  ROUND_START_COUNTDOWN_SECONDS,
  shouldShowRoundStart,
} from "./roomTransitions";

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

describe("remainingRoundStartSeconds", () => {
  it("counts down from the total as time elapses", () => {
    const startedAt = 100_000;
    expect(remainingRoundStartSeconds(startedAt, startedAt, 3)).toBe(3);
    expect(remainingRoundStartSeconds(startedAt, startedAt + 1_000, 3)).toBe(2);
    expect(remainingRoundStartSeconds(startedAt, startedAt + 2_999, 3)).toBe(1);
  });

  it("floors at zero once the total has elapsed, never going negative", () => {
    const startedAt = 100_000;
    expect(remainingRoundStartSeconds(startedAt, startedAt + 3_000, 3)).toBe(0);
    // This is the backgrounded-app case: the app resumes long after the
    // countdown should have finished (a suspended interval, or the page
    // being hidden for a while) — recomputing from the timestamp must still
    // report "done", not a stale mid-countdown or negative value.
    expect(remainingRoundStartSeconds(startedAt, startedAt + 60_000, 3)).toBe(0);
  });
});
