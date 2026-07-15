import { describe, expect, it } from "vitest";
import { calculateKongSettlement, calculateSelfDrawSettlement } from "./settlement.js";

describe("settlement", () => {
  it("multiplies hard win, winner and each payer independently", () => {
    const deltas = calculateSelfDrawSettlement({
      baseScore: 2,
      winnerSeat: 0,
      winType: "HARD",
      personalMultipliers: { 0: 2, 1: 1, 2: 2, 3: 4 },
    });
    expect(deltas).toEqual([
      { seat: 0, delta: 56, reason: "SELF_DRAW" },
      { seat: 1, delta: -8, reason: "SELF_DRAW" },
      { seat: 2, delta: -16, reason: "SELF_DRAW" },
      { seat: 3, delta: -32, reason: "SELF_DRAW" },
    ]);
  });

  it("charges only the discarder three times the base score for an exposed kong", () => {
    expect(
      calculateKongSettlement({
        baseScore: 2,
        actorSeat: 2,
        sourceSeat: 1,
        kind: "EXPOSED_KONG",
      }),
    ).toEqual([
      { seat: 2, delta: 6, reason: "EXPOSED_KONG" },
      { seat: 1, delta: -6, reason: "EXPOSED_KONG" },
    ]);
  });

  it("charges all opponents two times the base score for a concealed kong", () => {
    expect(
      calculateKongSettlement({
        baseScore: 5,
        actorSeat: 1,
        sourceSeat: null,
        kind: "CONCEALED_KONG",
      }),
    ).toEqual([
      { seat: 1, delta: 30, reason: "CONCEALED_KONG" },
      { seat: 0, delta: -10, reason: "CONCEALED_KONG" },
      { seat: 2, delta: -10, reason: "CONCEALED_KONG" },
      { seat: 3, delta: -10, reason: "CONCEALED_KONG" },
    ]);
  });
});
