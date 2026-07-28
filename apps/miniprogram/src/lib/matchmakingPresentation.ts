import type { MatchmakingState } from "@huanghuang/protocol";

export function matchmakingWaitSeconds(
  state: Extract<MatchmakingState, { status: "QUEUED" }>,
  now = Date.now(),
): number {
  return Math.max(0, Math.floor((now - Date.parse(state.enqueuedAt)) / 1_000));
}

export function matchmakingRangeLabel(waitSeconds: number): string {
  if (waitSeconds < 10) return "相差 2 级内";
  if (waitSeconds < 20) return "相差 5 级内";
  if (waitSeconds < 40) return "相差 10 级内";
  return "全服范围";
}
