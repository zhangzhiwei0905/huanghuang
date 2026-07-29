import type { MatchmakingState, RoomProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  nextMatchmakingPollDelayMs,
  resolveReturnToCompetitiveMatch,
  shouldPollMatchmakingStatus,
} from "./matchmakingRecovery.js";

const matchedState: MatchmakingState = {
  status: "MATCHED",
  matchId: "match-1",
  roomId: "room-1",
};

const idleState: MatchmakingState = { status: "IDLE" };

describe("resolveReturnToCompetitiveMatch", () => {
  it("returns the room to navigate into when status() found one", () => {
    const room = { roomId: "room-1" } as unknown as RoomProjection;
    const outcome = resolveReturnToCompetitiveMatch({
      state: matchedState,
      room,
      botsEnabled: false,
    });
    expect(outcome).toEqual({ kind: "ready", room });
  });

  it("surfaces the fetched matchmaking state instead of discarding it when room is null", () => {
    // This is the exact bug scenario: matchmaking.status is MATCHED but the
    // server-side room lookup came back empty. Previously the caller threw
    // and never looked at `response` again, so the UI stayed stuck on
    // MATCHED forever. The fix requires this state to be handed back so the
    // caller can re-apply it (and let subsequent polling reconcile further).
    const outcome = resolveReturnToCompetitiveMatch({
      state: matchedState,
      room: null,
      botsEnabled: false,
    });
    expect(outcome).toEqual({ kind: "recovered", state: matchedState });
  });
});

describe("shouldPollMatchmakingStatus", () => {
  it("polls while queued", () => {
    expect(shouldPollMatchmakingStatus("QUEUED")).toBe(true);
  });

  it("polls while matched, not just while queued", () => {
    // The acceptance criterion this covers: MATCHED must also be polled so a
    // stale MATCHED state (room actually gone) doesn't require a manual
    // button tap to ever notice.
    expect(shouldPollMatchmakingStatus("MATCHED")).toBe(true);
  });

  it("does not poll while idle", () => {
    expect(shouldPollMatchmakingStatus("IDLE")).toBe(false);
  });
});

describe("nextMatchmakingPollDelayMs", () => {
  it("polls queued state every second", () => {
    expect(nextMatchmakingPollDelayMs({ status: "QUEUED" } as MatchmakingState, false)).toBe(1_000);
  });

  it("polls an active trustee handoff quickly", () => {
    expect(nextMatchmakingPollDelayMs(matchedState, true)).toBe(2_000);
  });

  it("polls a plain matched state slowly (periodic reconciliation only)", () => {
    expect(nextMatchmakingPollDelayMs(matchedState, false)).toBe(5_000);
  });

  it("stops polling once idle", () => {
    expect(nextMatchmakingPollDelayMs(idleState, false)).toBeNull();
  });
});
