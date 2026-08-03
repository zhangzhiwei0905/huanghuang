import type { CompetitiveRankState } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  COMPETITIVE_RULE_VERSION,
  INITIAL_COMPETITIVE_RANK_STATE,
  applyCompetitiveRankTransition,
  competitiveMultiplierToLevel,
  formatRankLevel,
  majorIndexForRankLevel,
} from "./competitive-rank.js";

describe("competitive rank formatting", () => {
  it.each([
    [0, 0, "黑铁", "Ⅴ", "黑铁Ⅴ"],
    [4, 0, "黑铁", "Ⅰ", "黑铁Ⅰ"],
    [5, 1, "青铜", "Ⅴ", "青铜Ⅴ"],
    [9, 1, "青铜", "Ⅰ", "青铜Ⅰ"],
    [10, 2, "白银", "Ⅴ", "白银Ⅴ"],
    [14, 2, "白银", "Ⅰ", "白银Ⅰ"],
    [15, 3, "黄金", "Ⅴ", "黄金Ⅴ"],
    [34, 6, "星耀", "Ⅰ", "星耀Ⅰ"],
    [35, 7, "雀神", null, "雀神1级"],
    [36, 7, "雀神", null, "雀神2级"],
    [99, 7, "雀神", null, "雀神65级"],
  ] as const)(
    "formats rank level %i",
    (rankLevel, majorIndex, majorName, minorLabel, displayName) => {
      expect(formatRankLevel(rankLevel)).toEqual({
        majorIndex,
        majorName,
        minorLabel,
        displayName,
      });
      expect(majorIndexForRankLevel(rankLevel)).toBe(majorIndex);
    },
  );

  it("maps every finite rank level continuously through star glory", () => {
    const majorNames = ["黑铁", "青铜", "白银", "黄金", "铂金", "钻石", "星耀"];
    const minorLabels = ["Ⅴ", "Ⅳ", "Ⅲ", "Ⅱ", "Ⅰ"];

    for (let rankLevel = 0; rankLevel <= 34; rankLevel += 1) {
      const majorIndex = Math.floor(rankLevel / 5);
      const minorLabel = minorLabels[rankLevel % 5];
      expect(formatRankLevel(rankLevel)).toEqual({
        majorIndex,
        majorName: majorNames[majorIndex],
        minorLabel,
        displayName: `${majorNames[majorIndex]}${minorLabel}`,
      });
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "rejects invalid rank level %s",
    (rankLevel) => {
      expect(() => formatRankLevel(rankLevel)).toThrow(RangeError);
      expect(() => majorIndexForRankLevel(rankLevel)).toThrow(RangeError);
    },
  );

  it("publishes the initial state and rule version", () => {
    expect(COMPETITIVE_RULE_VERSION).toBe(1);
    expect(INITIAL_COMPETITIVE_RANK_STATE).toEqual({
      rankLevel: 0,
      highestMajorIndex: 0,
      protectionCards: 0,
    });
  });
});

describe("competitive multiplier levels", () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 3],
    [8, 4],
    [16, 5],
    [32, 6],
    [64, 7],
  ] as const)("maps %ix to level %i", (multiplier, level) => {
    expect(competitiveMultiplierToLevel(multiplier)).toBe(level);
  });

  it.each([0, 3, 63, 128, Number.NaN])("rejects illegal multiplier %s", (multiplier) => {
    expect(() => competitiveMultiplierToLevel(multiplier)).toThrow(RangeError);
  });
});

describe("competitive rank transitions", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 32],
    [7, 64],
  ] as const)("raises the winner by %i levels for %ix", (expectedDelta, multiplier) => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 20, highestMajorIndex: 4, protectionCards: 3 },
      { kind: "WIN", multiplier },
    );

    expect(result.rawDelta).toBe(expectedDelta);
    expect(result.appliedDelta).toBe(expectedDelta);
    expect(result.afterRankLevel).toBe(20 + expectedDelta);
    expect(result.protectionCardsConsumed).toBe(0);
  });

  it.each([0, 5, 10, 14])(
    "makes a loss at low rank level %i immune without consuming cards",
    (rankLevel) => {
      const result = applyCompetitiveRankTransition(
        { rankLevel, highestMajorIndex: majorIndexForRankLevel(rankLevel), protectionCards: 5 },
        { kind: "LOSS", multiplier: 64 },
      );

      expect(result).toMatchObject({
        beforeRankLevel: rankLevel,
        afterRankLevel: rankLevel,
        rawDelta: -7,
        appliedDelta: 0,
        protectedLevels: 7,
        protectionCardsBefore: 5,
        protectionCardsConsumed: 0,
        protectionCardsAfter: 5,
      });
    },
  );

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 32],
    [7, 64],
  ] as const)("lowers an unprotected high-rank loser by %i levels for %ix", (delta, multiplier) => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 0 },
      { kind: "LOSS", multiplier },
    );
    expect(result).toMatchObject({
      afterRankLevel: 30 - delta,
      rawDelta: -delta,
      appliedDelta: -delta,
      protectedLevels: 0,
      protectionCardsConsumed: 0,
    });
  });

  it("uses protection cards before applying the remaining loss", () => {
    expect(
      applyCompetitiveRankTransition(
        { rankLevel: 20, highestMajorIndex: 4, protectionCards: 2 },
        { kind: "LOSS", multiplier: 16 },
      ),
    ).toMatchObject({
      beforeRankLevel: 20,
      afterRankLevel: 17,
      rawDelta: -5,
      appliedDelta: -3,
      protectedLevels: 2,
      protectionCardsConsumed: 2,
      protectionCardsAfter: 0,
    });
  });

  it("fully protects a loss when enough cards are available", () => {
    expect(
      applyCompetitiveRankTransition(
        { rankLevel: 15, highestMajorIndex: 3, protectionCards: 7 },
        { kind: "LOSS", multiplier: 64 },
      ),
    ).toMatchObject({
      afterRankLevel: 15,
      appliedDelta: 0,
      protectedLevels: 7,
      protectionCardsConsumed: 7,
      protectionCardsAfter: 0,
    });
  });

  it("keeps black iron V as the absolute lower bound", () => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 0, highestMajorIndex: 0, protectionCards: 0 },
      { kind: "LOSS", multiplier: 64 },
    );
    expect(result.afterRankLevel).toBe(0);
    expect(result.appliedDelta).toBe(0);
  });

  it("grants two cards the first time each higher major is reached", () => {
    const firstPromotion = applyCompetitiveRankTransition(
      { rankLevel: 4, highestMajorIndex: 0, protectionCards: 1 },
      { kind: "WIN", multiplier: 1 },
    );
    expect(firstPromotion).toMatchObject({
      afterRankLevel: 5,
      afterHighestMajorIndex: 1,
      protectionCardsGranted: 2,
      protectionCardsAfter: 3,
    });

    const repeatedPromotion = applyCompetitiveRankTransition(
      { rankLevel: 4, highestMajorIndex: 1, protectionCards: 0 },
      { kind: "WIN", multiplier: 1 },
    );
    expect(repeatedPromotion).toMatchObject({
      afterRankLevel: 5,
      afterHighestMajorIndex: 1,
      protectionCardsGranted: 0,
      protectionCardsAfter: 0,
    });
  });

  it.each([5, 10, 15, 20, 25, 30, 35])(
    "grants exactly two cards on the first promotion to level %i",
    (promotionLevel) => {
      const previousLevel = promotionLevel - 1;
      const previousMajor = majorIndexForRankLevel(previousLevel);
      const result = applyCompetitiveRankTransition(
        {
          rankLevel: previousLevel,
          highestMajorIndex: previousMajor,
          protectionCards: 0,
        },
        { kind: "WIN", multiplier: 1 },
      );
      expect(result).toMatchObject({
        afterRankLevel: promotionLevel,
        afterHighestMajorIndex: previousMajor + 1,
        protectionCardsGranted: 2,
        protectionCardsAfter: 2,
      });
    },
  );

  it("grants cards for every newly crossed major", () => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 4, highestMajorIndex: 0, protectionCards: 0 },
      { kind: "WIN", multiplier: 64 },
    );
    expect(result).toMatchObject({
      afterRankLevel: 11,
      afterHighestMajorIndex: 2,
      protectionCardsGranted: 4,
      protectionCardsAfter: 4,
    });
  });

  it("grants the deity reward once and supports unlimited deity levels", () => {
    const promotion = applyCompetitiveRankTransition(
      { rankLevel: 34, highestMajorIndex: 6, protectionCards: 0 },
      { kind: "WIN", multiplier: 1 },
    );
    expect(promotion).toMatchObject({
      afterRankLevel: 35,
      afterHighestMajorIndex: 7,
      protectionCardsGranted: 2,
    });

    const higherDeity = applyCompetitiveRankTransition(
      { rankLevel: 35, highestMajorIndex: 7, protectionCards: 0 },
      { kind: "WIN", multiplier: 64 },
    );
    expect(higherDeity).toMatchObject({
      afterRankLevel: 42,
      afterHighestMajorIndex: 7,
      protectionCardsGranted: 0,
    });
    expect(formatRankLevel(higherDeity.afterRankLevel).displayName).toBe("雀神8级");
  });

  it("allows deity level 1 to fall back to star glory I", () => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 35, highestMajorIndex: 7, protectionCards: 0 },
      { kind: "LOSS", multiplier: 1 },
    );
    expect(result).toMatchObject({
      afterRankLevel: 34,
      afterHighestMajorIndex: 7,
      appliedDelta: -1,
    });
    expect(formatRankLevel(result.afterRankLevel).displayName).toBe("星耀Ⅰ");
  });

  it("leaves rank and protection untouched on a draw", () => {
    expect(
      applyCompetitiveRankTransition(
        { rankLevel: 35, highestMajorIndex: 7, protectionCards: 3 },
        { kind: "DRAW" },
      ),
    ).toEqual({
      outcome: { kind: "DRAW" },
      beforeRankLevel: 35,
      afterRankLevel: 35,
      beforeHighestMajorIndex: 7,
      afterHighestMajorIndex: 7,
      rawDelta: 0,
      appliedDelta: 0,
      protectedLevels: 0,
      protectionCardsBefore: 3,
      protectionCardsConsumed: 0,
      protectionCardsGranted: 0,
      protectionCardsAfter: 3,
      winDoubleCardUsed: false,
      rankProtectionApplied: false,
    });
  });

  it("does not mutate the input profile", () => {
    const profile = { rankLevel: 19, highestMajorIndex: 3, protectionCards: 1 } as const;
    applyCompetitiveRankTransition(profile, { kind: "LOSS", multiplier: 4 });
    expect(profile).toEqual({ rankLevel: 19, highestMajorIndex: 3, protectionCards: 1 });
  });

  it.each([
    { rankLevel: -1, highestMajorIndex: 0, protectionCards: 0 },
    { rankLevel: 5, highestMajorIndex: 0, protectionCards: 0 },
    { rankLevel: 0, highestMajorIndex: 8, protectionCards: 0 },
    { rankLevel: 0, highestMajorIndex: 0, protectionCards: -1 },
  ])("rejects invalid profile state $rankLevel/$highestMajorIndex/$protectionCards", (profile) => {
    expect(() =>
      applyCompetitiveRankTransition(profile as CompetitiveRankState, {
        kind: "WIN",
        multiplier: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("win double card", () => {
  it.each([
    [1, 2],
    [4, 8],
    [7, 14],
  ] as const)("doubles a %i-level win to %i levels", (delta, doubled) => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 20, highestMajorIndex: 4, protectionCards: 0 },
      { kind: "WIN", multiplier: [1, 2, 4, 8, 16, 32, 64][delta - 1] as 1, doubleCard: true },
    );
    expect(result).toMatchObject({
      afterRankLevel: 20 + doubled,
      rawDelta: doubled,
      appliedDelta: doubled,
      winDoubleCardUsed: true,
      rankProtectionApplied: false,
    });
  });

  it("keeps the normal delta when doubleCard is omitted or false", () => {
    const omitted = applyCompetitiveRankTransition(
      { rankLevel: 20, highestMajorIndex: 4, protectionCards: 0 },
      { kind: "WIN", multiplier: 8 },
    );
    expect(omitted).toMatchObject({ appliedDelta: 4, winDoubleCardUsed: false });

    const declined = applyCompetitiveRankTransition(
      { rankLevel: 20, highestMajorIndex: 4, protectionCards: 0 },
      { kind: "WIN", multiplier: 8, doubleCard: false },
    );
    expect(declined).toMatchObject({ appliedDelta: 4, winDoubleCardUsed: false });
  });

  it("grants tier cards based on the doubled destination level", () => {
    // 4 + 2*2 = 8 crosses 青铜V(5) — exactly what a plain 4x win would do,
    // but a 1x doubled win from level 3 must cross too.
    const result = applyCompetitiveRankTransition(
      { rankLevel: 3, highestMajorIndex: 0, protectionCards: 0 },
      { kind: "WIN", multiplier: 1, doubleCard: true },
    );
    expect(result).toMatchObject({
      afterRankLevel: 5,
      afterHighestMajorIndex: 1,
      protectionCardsGranted: 2,
      winDoubleCardUsed: true,
    });
  });
});

describe("rank protection card halving", () => {
  it.each([
    [4, 2],
    [5, 2],
    [6, 3],
    [7, 3],
  ] as const)("halves an unprotected %i-level loss (floor) to %i", (delta, halved) => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 0 },
      {
        kind: "LOSS",
        multiplier: [1, 2, 4, 8, 16, 32, 64][delta - 1] as 1,
        protectionHalved: true,
      },
    );
    expect(result).toMatchObject({
      afterRankLevel: 30 - halved,
      rawDelta: -delta,
      appliedDelta: -halved,
      protectedLevels: 0,
      protectionCardsConsumed: 0,
      winDoubleCardUsed: false,
      rankProtectionApplied: true,
    });
  });

  it("floors a 1-level loss to zero deduction", () => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 0 },
      { kind: "LOSS", multiplier: 1, protectionHalved: true },
    );
    expect(result).toMatchObject({
      afterRankLevel: 30,
      rawDelta: -1,
      appliedDelta: 0,
      rankProtectionApplied: true,
    });
  });

  it("deducts protection cards after halving", () => {
    // 4x loss = 5 levels -> halved to 2 -> 3 cards cover both levels.
    const covered = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 3 },
      { kind: "LOSS", multiplier: 16, protectionHalved: true },
    );
    expect(covered).toMatchObject({
      afterRankLevel: 30,
      appliedDelta: 0,
      protectedLevels: 2,
      protectionCardsConsumed: 2,
      protectionCardsAfter: 1,
      rankProtectionApplied: true,
    });

    // 6x loss = 6 levels -> halved to 3 -> 2 cards cover two, one applied.
    const partial = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 2 },
      { kind: "LOSS", multiplier: 32, protectionHalved: true },
    );
    expect(partial).toMatchObject({
      afterRankLevel: 29,
      rawDelta: -6,
      appliedDelta: -1,
      protectedLevels: 2,
      protectionCardsConsumed: 2,
      protectionCardsAfter: 0,
      rankProtectionApplied: true,
    });
  });

  it("keeps low-rank immunity priority over halving", () => {
    const result = applyCompetitiveRankTransition(
      { rankLevel: 14, highestMajorIndex: 2, protectionCards: 5 },
      { kind: "LOSS", multiplier: 64, protectionHalved: true },
    );
    expect(result).toMatchObject({
      afterRankLevel: 14,
      rawDelta: -7,
      appliedDelta: 0,
      protectedLevels: 3,
      protectionCardsConsumed: 0,
      protectionCardsAfter: 5,
      rankProtectionApplied: true,
    });
  });

  it("keeps the normal deduction when protectionHalved is omitted or false", () => {
    const omitted = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 0 },
      { kind: "LOSS", multiplier: 8 },
    );
    expect(omitted).toMatchObject({ appliedDelta: -4, rankProtectionApplied: false });

    const inactive = applyCompetitiveRankTransition(
      { rankLevel: 30, highestMajorIndex: 6, protectionCards: 0 },
      { kind: "LOSS", multiplier: 8, protectionHalved: false },
    );
    expect(inactive).toMatchObject({ appliedDelta: -4, rankProtectionApplied: false });
  });
});
