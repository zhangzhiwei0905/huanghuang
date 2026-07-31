import type { CompetitiveSettlementProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { rankPromotionKey, shouldShowRankPromotion } from "./rankPromotion.js";

function settlement(
  beforeRankLevel: number,
  afterRankLevel: number,
  beforeName: string,
  afterName: string,
): CompetitiveSettlementProjection {
  return {
    matchId: "match-1",
    ruleVersion: 1,
    originRoomCode: null,
    beforeRankDisplay: {
      majorIndex: 6,
      majorName: "星耀",
      minorLabel: "Ⅱ",
      displayName: beforeName,
    },
    afterRankDisplay: {
      majorIndex: 6,
      majorName: "星耀",
      minorLabel: "Ⅰ",
      displayName: afterName,
    },
    self: {
      outcome: { kind: "WIN", multiplier: 1 },
      beforeRankLevel,
      afterRankLevel,
      beforeHighestMajorIndex: 6,
      afterHighestMajorIndex: 6,
      rawDelta: afterRankLevel - beforeRankLevel,
      appliedDelta: afterRankLevel - beforeRankLevel,
      protectedLevels: 0,
      protectionCardsBefore: 0,
      protectionCardsConsumed: 0,
      protectionCardsGranted: 0,
      protectionCardsAfter: 0,
    },
  };
}

describe("rank promotion presentation", () => {
  it("shows only an actual upward display-name change", () => {
    expect(shouldShowRankPromotion(settlement(33, 34, "星耀Ⅱ", "星耀Ⅰ"))).toBe(true);
    expect(shouldShowRankPromotion(settlement(34, 34, "星耀Ⅰ", "星耀Ⅰ"))).toBe(false);
    expect(shouldShowRankPromotion(settlement(34, 33, "星耀Ⅰ", "星耀Ⅱ"))).toBe(false);
  });

  it("uses match and resulting level as the replay guard key", () => {
    expect(rankPromotionKey(settlement(33, 34, "星耀Ⅱ", "星耀Ⅰ"))).toBe("match-1:34");
  });
});
