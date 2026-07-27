import { describe, expect, it } from "vitest";
import { calculateKongSettlement, calculateSelfDrawSettlement } from "./settlement.js";

describe("settlement", () => {
  it("multiplies hard win, winner and each payer independently", () => {
    const deltas = calculateSelfDrawSettlement({
      baseScore: 2,
      winnerSeat: 0,
      winType: "HARD",
      laiyou: false,
      personalMultipliers: { 0: 2, 1: 1, 2: 2, 3: 4 },
    });
    expect(deltas).toEqual([
      { seat: 0, delta: 56, reason: "SELF_DRAW" },
      { seat: 1, delta: -8, reason: "SELF_DRAW" },
      { seat: 2, delta: -16, reason: "SELF_DRAW" },
      { seat: 3, delta: -32, reason: "SELF_DRAW" },
    ]);
  });

  it("doubles every self-draw payment for a laiyou win", () => {
    const options = {
      baseScore: 2 as const,
      winnerSeat: 0 as const,
      winType: "HARD" as const,
      personalMultipliers: { 0: 2, 1: 1, 2: 2, 3: 4 } as const,
    };
    const plain = calculateSelfDrawSettlement({ ...options, laiyou: false });
    const laiyou = calculateSelfDrawSettlement({ ...options, laiyou: true });

    for (const [index, delta] of laiyou.entries()) {
      expect(delta.delta).toBe((plain[index]?.delta ?? Number.NaN) * 2);
    }
    expect(laiyou.reduce((sum, item) => sum + item.delta, 0)).toBe(0);
  });

  it("caps the laiyou self-draw multiplier at 64 times the base score per payer", () => {
    const deltas = calculateSelfDrawSettlement({
      baseScore: 2,
      winnerSeat: 0,
      winType: "HARD",
      laiyou: true,
      personalMultipliers: { 0: 16, 1: 1, 2: 1, 3: 1 },
    });

    // hard win (2) * laiyou (2) * winner multiplier (16) * payer multiplier (1)
    expect(deltas.filter((delta) => delta.seat !== 0).map((delta) => delta.delta)).toEqual([
      -128, -128, -128,
    ]);
    expect(deltas[0]?.delta).toBe(384);
    expect(deltas.reduce((sum, item) => sum + item.delta, 0)).toBe(0);
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

  it("charges the discarder three times the base score for an indicator pong-kong", () => {
    expect(
      calculateKongSettlement({
        baseScore: 5,
        actorSeat: 3,
        sourceSeat: 0,
        kind: "INDICATOR_PONG_KONG",
      }),
    ).toEqual([
      { seat: 3, delta: 15, reason: "INDICATOR_PONG_KONG" },
      { seat: 0, delta: -15, reason: "INDICATOR_PONG_KONG" },
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

  it("charges all opponents one base score for an added kong", () => {
    expect(
      calculateKongSettlement({
        baseScore: 2,
        actorSeat: 0,
        sourceSeat: null,
        kind: "ADDED_KONG",
      }),
    ).toEqual([
      { seat: 0, delta: 6, reason: "ADDED_KONG" },
      { seat: 1, delta: -2, reason: "ADDED_KONG" },
      { seat: 2, delta: -2, reason: "ADDED_KONG" },
      { seat: 3, delta: -2, reason: "ADDED_KONG" },
    ]);
  });

  it("keeps every kong transfer zero-sum", () => {
    for (const options of [
      { baseScore: 2 as const, actorSeat: 0 as const, sourceSeat: 1 as const, kind: "EXPOSED_KONG" as const },
      { baseScore: 2 as const, actorSeat: 0 as const, sourceSeat: null, kind: "CONCEALED_KONG" as const },
      { baseScore: 2 as const, actorSeat: 0 as const, sourceSeat: null, kind: "ADDED_KONG" as const },
      { baseScore: 2 as const, actorSeat: 0 as const, sourceSeat: 1 as const, kind: "INDICATOR_PONG_KONG" as const },
    ]) {
      expect(calculateKongSettlement(options).reduce((sum, item) => sum + item.delta, 0)).toBe(0);
    }
  });
});
