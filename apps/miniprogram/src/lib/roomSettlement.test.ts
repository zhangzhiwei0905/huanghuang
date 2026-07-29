import type { RoomProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { deriveLastSettlementFromClosedProjection } from "./roomSettlement.js";

function matchProjection(overrides: Partial<RoomProjection> = {}): RoomProjection {
  return {
    mode: "MATCH",
    competitiveMatch: { matchId: "match-1", ruleVersion: 1 },
    roundSettlement: { roundId: "round-1" } as unknown as RoomProjection["roundSettlement"],
    ...overrides,
  } as RoomProjection;
}

describe("deriveLastSettlementFromClosedProjection", () => {
  it("preserves the competitiveMatch and roundSettlement from a closed MATCH room", () => {
    // This is the core of Fix C: the server keeps these fields populated on
    // a CLOSED projection (closeRoom() never clears them), so useRoom must
    // not discard them the instant it clears `room` to null.
    const projection = matchProjection();
    expect(deriveLastSettlementFromClosedProjection(projection)).toEqual({
      competitiveMatch: { matchId: "match-1", ruleVersion: 1 },
      roundSettlement: { roundId: "round-1" },
    });
  });

  it("returns null for a non-MATCH room (friend/bot rooms have nothing to preserve)", () => {
    const projection = matchProjection({ mode: "FRIEND" });
    expect(deriveLastSettlementFromClosedProjection(projection)).toBeNull();
  });

  it("returns null when the projection has no competitiveMatch", () => {
    const projection = matchProjection({ competitiveMatch: null });
    expect(deriveLastSettlementFromClosedProjection(projection)).toBeNull();
  });

  it("returns null when the projection has no roundSettlement (closed before a round finished)", () => {
    const projection = matchProjection({ roundSettlement: null });
    expect(deriveLastSettlementFromClosedProjection(projection)).toBeNull();
  });
});
