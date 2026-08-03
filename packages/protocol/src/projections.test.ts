import { describe, expect, it } from "vitest";
import type { RoundSettlementProjection } from "./projections.js";

describe("competitive settlement projection", () => {
  it("keeps personal multipliers capped at 16 while carrying effective 64x multipliers", () => {
    const settlement: RoundSettlementProjection = {
      roundId: "round-1",
      kind: "WIN",
      winnerSeat: 0,
      winType: "HARD",
      baseScore: 2,
      winBaseMultiplier: 2,
      winnerMultiplier: 64,
      laiyou: true,
      laiyouMultiplier: 2,
      nextDealerSeat: 0,
      payments: [{ payerSeat: 1, payerMultiplier: 16, payerEffectiveMultiplier: 64, amount: 128 }],
      finalHands: [],
      scoreChanges: [],
      competitiveSettlement: {
        matchId: "match-1",
        ruleVersion: 1,
        originRoomCode: null,
        beforeRankDisplay: {
          majorIndex: 6,
          majorName: "星耀",
          minorLabel: "Ⅰ",
          displayName: "星耀Ⅰ",
        },
        afterRankDisplay: {
          majorIndex: 7,
          majorName: "雀神",
          minorLabel: null,
          displayName: "雀神7级",
        },
        self: {
          outcome: { kind: "WIN", multiplier: 64 },
          beforeRankLevel: 34,
          afterRankLevel: 41,
          beforeHighestMajorIndex: 6,
          afterHighestMajorIndex: 7,
          rawDelta: 7,
          appliedDelta: 7,
          protectedLevels: 0,
          protectionCardsBefore: 0,
          protectionCardsConsumed: 0,
          protectionCardsGranted: 2,
          protectionCardsAfter: 2,
          winDoubleCardUsed: false,
          rankProtectionApplied: false,
        },
      },
    };

    expect(settlement.winnerMultiplier).toBe(64);
    expect(settlement.payments[0]).toMatchObject({
      payerMultiplier: 16,
      payerEffectiveMultiplier: 64,
    });
    expect(settlement.competitiveSettlement?.self.afterRankLevel).toBe(41);
  });

  it("represents a non-competitive draw without multiplier evidence", () => {
    const settlement: RoundSettlementProjection = {
      roundId: "round-2",
      kind: "DRAW",
      winnerSeat: null,
      winType: null,
      baseScore: 2,
      winBaseMultiplier: null,
      winnerMultiplier: null,
      laiyou: false,
      laiyouMultiplier: null,
      nextDealerSeat: 1,
      payments: [],
      finalHands: [],
      scoreChanges: [],
      competitiveSettlement: null,
    };

    expect(settlement).toMatchObject({
      kind: "DRAW",
      winnerMultiplier: null,
      payments: [],
      competitiveSettlement: null,
    });
  });
});
