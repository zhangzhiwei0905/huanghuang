import { describe, expect, it } from "vitest";
import {
  MATCH_FOUND_COUNTDOWN_SECONDS,
  remainingRoundStartSeconds,
  remainingSecondsUntilTarget,
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

describe("remainingSecondsUntilTarget", () => {
  it("counts the seconds left before a future target, rounding up", () => {
    const targetAt = 100_000;
    expect(remainingSecondsUntilTarget(targetAt, targetAt - 3_000, 3)).toBe(3);
    expect(remainingSecondsUntilTarget(targetAt, targetAt - 2_001, 3)).toBe(3);
    expect(remainingSecondsUntilTarget(targetAt, targetAt - 1_500, 3)).toBe(2);
    expect(remainingSecondsUntilTarget(targetAt, targetAt, 3)).toBe(0);
    expect(remainingSecondsUntilTarget(targetAt, targetAt + 5_000, 3)).toBe(0);
  });

  it("never displays more than the cap, even with clock skew or late delivery", () => {
    // The bug this guards against: a server-armed 3s target compared against
    // a lagging client clock used to render 11s countdowns.
    expect(MATCH_FOUND_COUNTDOWN_SECONDS).toBe(5);
    const targetAt = 100_000;
    expect(remainingSecondsUntilTarget(targetAt, targetAt - 8_000, 3)).toBe(3);
    expect(remainingSecondsUntilTarget(targetAt, targetAt - 60_000, 3)).toBe(3);
  });
});
