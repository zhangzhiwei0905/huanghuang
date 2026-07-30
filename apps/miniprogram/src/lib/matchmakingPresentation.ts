import type { MatchmakingState } from "@huanghuang/protocol";

export function matchmakingWaitSeconds(
  state: Extract<MatchmakingState, { status: "QUEUED" }>,
  now = Date.now(),
): number {
  return Math.max(0, Math.floor((now - Date.parse(state.enqueuedAt)) / 1_000));
}

// Thresholds must stay in sync with matchmakingMajorTierRange in
// apps/server/src/matchmaking-algorithm.ts (0 / 1 / 2 / ∞ major tiers at
// 10s / 20s / 40s) — this is purely a display mirror, not authoritative.
export function matchmakingRangeLabel(waitSeconds: number): string {
  if (waitSeconds < 10) return "同大段内";
  if (waitSeconds < 20) return "相邻大段内";
  if (waitSeconds < 40) return "2 个大段内";
  return "全服范围";
}
