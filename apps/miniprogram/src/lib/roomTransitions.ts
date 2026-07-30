import type { RoomStage } from "@huanghuang/protocol";

export const ROUND_START_COUNTDOWN_SECONDS = 3;

export function shouldShowRoundStart(
  previousStage: RoomStage | null,
  nextStage: RoomStage | null,
): boolean {
  return previousStage === "WAITING" && nextStage === "PLAYING";
}

/**
 * Seconds remaining in a RoundStartOverlay countdown, given the wall-clock
 * time it started. Deriving this from a timestamp (rather than a
 * decrementing counter) is what lets a countdown recover correctly after the
 * app is backgrounded and resumed mid-countdown: the next read always
 * reflects true elapsed time instead of restarting or drifting.
 */
export function remainingRoundStartSeconds(
  startedAt: number,
  now: number,
  totalSeconds: number,
): number {
  return Math.max(0, totalSeconds - Math.floor((now - startedAt) / 1_000));
}
