import type { MatchmakingState } from "@huanghuang/protocol";
import type { MatchmakingResponse } from "../api/http";

/**
 * Pure decision for the home page's `returnToCompetitiveMatch` action: given
 * the freshly-fetched matchmaking status, either hand back the room to
 * navigate into, or the matchmaking state that must be applied to the UI.
 *
 * Previously the room-missing case only ever threw an Error and the response
 * was discarded — `matchmaking` stayed at its stale MATCHED value forever, so
 * the "返回对局" button was stuck and every retry re-failed the same way.
 * Surfacing the response's state here lets the caller re-sync the UI (and,
 * once the server-side match is actually resolved, fall back to a state the
 * player can act on again) instead of silently dropping it.
 */
export type ReturnToMatchOutcome =
  | { kind: "ready"; room: NonNullable<MatchmakingResponse["room"]> }
  | { kind: "recovered"; state: MatchmakingState };

export function resolveReturnToCompetitiveMatch(
  response: MatchmakingResponse,
): ReturnToMatchOutcome {
  if (response.room !== null) return { kind: "ready", room: response.room };
  return { kind: "recovered", state: response.state };
}

/**
 * Whether the home page's matchmaking-status polling loop should run at all
 * for the given status. MATCHED is included (not just QUEUED) so a stale
 * MATCHED state — the state that leaves the "返回对局" button stuck if the
 * server and client ever disagree about whether the match room still exists
 * — gets periodically re-checked instead of only refreshing on user action.
 */
export function shouldPollMatchmakingStatus(status: MatchmakingState["status"]): boolean {
  return status === "QUEUED" || status === "MATCHED";
}

/**
 * How long to wait before the next poll, given the just-fetched state.
 * Returns null when polling should stop (IDLE — nothing left to track).
 * QUEUED and an active trustee-handoff match poll aggressively since the
 * player is actively waiting on those; a plain MATCHED poll is just
 * periodic reconciliation, so it can run much less often.
 */
export function nextMatchmakingPollDelayMs(
  state: MatchmakingState,
  isTrusteeMatch: boolean,
): number | null {
  if (state.status === "QUEUED") return 1_000;
  if (state.status === "MATCHED") return isTrusteeMatch ? 2_000 : 5_000;
  return null;
}
