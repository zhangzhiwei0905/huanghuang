import type { RoomStage } from "@huanghuang/protocol";

export const ROUND_START_COUNTDOWN_SECONDS = 3;
/**
 * The "匹配成功" transition shown after matchmaking finds a table. Kept
 * separate from ROUND_START_COUNTDOWN_SECONDS because it is purely cosmetic
 * — the server gates the actual round start on every player entering.
 */
export const MATCH_FOUND_COUNTDOWN_SECONDS = 5;

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
 * reflects true elapsed time instead of restarting or drifting. Elapsed
 * time is clamped at zero too: the driving "now" state can lag behind
 * startedAt for a render (stale interval tick, a suspended timer), and an
 * unclamped negative elapsed inflated the display past the total — players
 * saw 11s on a 5s countdown.
 */
export function remainingRoundStartSeconds(
  startedAt: number,
  now: number,
  totalSeconds: number,
): number {
  const elapsedSeconds = Math.floor(Math.max(0, now - startedAt) / 1_000);
  return Math.max(0, totalSeconds - elapsedSeconds);
}

/**
 * Seconds until a future target timestamp, clamped to [0, capSeconds].
 * Server-driven countdown targets (room.roundStartsAt) are compared against
 * the client clock here, so without the cap any clock skew or a late
 * projection inflated the display — players were seeing 11s on a 3s
 * countdown. Rounding up keeps "3" visible until the final second elapses.
 */
export function remainingSecondsUntilTarget(
  targetAt: number,
  now: number,
  capSeconds: number,
): number {
  return Math.max(0, Math.min(capSeconds, Math.ceil((targetAt - now) / 1_000)));
}
