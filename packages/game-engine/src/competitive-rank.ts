import {
  COMPETITIVE_MULTIPLIERS,
  type CompetitiveMajorIndex,
  type CompetitiveMultiplier,
  type CompetitiveRankDisplay,
  type CompetitiveRankOutcome,
  type CompetitiveRankState,
  type CompetitiveRankTransition,
} from "@huanghuang/protocol";

export const COMPETITIVE_RULE_VERSION = 1;
export const INITIAL_COMPETITIVE_RANK_STATE: Readonly<CompetitiveRankState> = {
  rankLevel: 0,
  highestMajorIndex: 0,
  protectionCards: 0,
};

const RANK_MAJOR_NAMES = ["黑铁", "青铜", "白银", "黄金", "铂金", "钻石", "星耀", "雀神"] as const;
const RANK_MINOR_LABELS = ["Ⅴ", "Ⅳ", "Ⅲ", "Ⅱ", "Ⅰ"] as const;
const LOW_RANK_IMMUNITY_MAX_MAJOR_INDEX = 2;
const PROTECTION_CARDS_PER_NEW_MAJOR = 2;
const DEITY_START_LEVEL = 35;
const DEITY_MAJOR_INDEX = 7;

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function assertRankState(state: CompetitiveRankState): void {
  assertNonnegativeInteger(state.rankLevel, "rankLevel");
  assertNonnegativeInteger(state.highestMajorIndex, "highestMajorIndex");
  assertNonnegativeInteger(state.protectionCards, "protectionCards");

  const currentMajorIndex = majorIndexForRankLevel(state.rankLevel);
  if (state.highestMajorIndex < currentMajorIndex || state.highestMajorIndex > DEITY_MAJOR_INDEX) {
    throw new RangeError(
      "highestMajorIndex must include the current major index and cannot exceed 7",
    );
  }
}

export function majorIndexForRankLevel(rankLevel: number): CompetitiveMajorIndex {
  assertNonnegativeInteger(rankLevel, "rankLevel");
  return Math.min(
    Math.floor(rankLevel / RANK_MINOR_LABELS.length),
    DEITY_MAJOR_INDEX,
  ) as CompetitiveMajorIndex;
}

export function formatRankLevel(rankLevel: number): CompetitiveRankDisplay {
  const majorIndex = majorIndexForRankLevel(rankLevel);
  const majorName = RANK_MAJOR_NAMES[majorIndex];

  if (rankLevel >= DEITY_START_LEVEL) {
    const displayName = `${majorName}${rankLevel - DEITY_START_LEVEL + 1}级`;
    return { majorIndex, majorName, minorLabel: null, displayName };
  }

  const minorIndex = rankLevel % RANK_MINOR_LABELS.length;
  const minorLabel = RANK_MINOR_LABELS[minorIndex];
  if (minorLabel === undefined) {
    throw new Error(`Missing rank label for minor index ${minorIndex}`);
  }
  return {
    majorIndex,
    majorName,
    minorLabel,
    displayName: `${majorName}${minorLabel}`,
  };
}

export function competitiveMultiplierToLevel(multiplier: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const index = COMPETITIVE_MULTIPLIERS.indexOf(multiplier as CompetitiveMultiplier);
  if (index < 0) {
    throw new RangeError("competitive multiplier must be one of 1, 2, 4, 8, 16, 32, or 64");
  }
  return (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function applyCompetitiveRankTransition(
  profile: CompetitiveRankState,
  outcome: CompetitiveRankOutcome,
): CompetitiveRankTransition {
  assertRankState(profile);

  const cardsBefore = profile.protectionCards;
  if (outcome.kind === "DRAW") {
    return {
      outcome,
      beforeRankLevel: profile.rankLevel,
      afterRankLevel: profile.rankLevel,
      beforeHighestMajorIndex: profile.highestMajorIndex,
      afterHighestMajorIndex: profile.highestMajorIndex,
      rawDelta: 0,
      appliedDelta: 0,
      protectedLevels: 0,
      protectionCardsBefore: cardsBefore,
      protectionCardsConsumed: 0,
      protectionCardsGranted: 0,
      protectionCardsAfter: cardsBefore,
    };
  }

  const magnitude = competitiveMultiplierToLevel(outcome.multiplier);
  if (outcome.kind === "LOSS") {
    const immune = majorIndexForRankLevel(profile.rankLevel) <= LOW_RANK_IMMUNITY_MAX_MAJOR_INDEX;
    const protectionCardsConsumed = immune ? 0 : Math.min(cardsBefore, magnitude);
    const protectedLevels = immune ? magnitude : protectionCardsConsumed;
    const unprotectedLoss = immune ? 0 : magnitude - protectionCardsConsumed;
    const afterRankLevel = Math.max(0, profile.rankLevel - unprotectedLoss);

    return {
      outcome,
      beforeRankLevel: profile.rankLevel,
      afterRankLevel,
      beforeHighestMajorIndex: profile.highestMajorIndex,
      afterHighestMajorIndex: profile.highestMajorIndex,
      rawDelta: -magnitude,
      appliedDelta: afterRankLevel - profile.rankLevel,
      protectedLevels,
      protectionCardsBefore: cardsBefore,
      protectionCardsConsumed,
      protectionCardsGranted: 0,
      protectionCardsAfter: cardsBefore - protectionCardsConsumed,
    };
  }

  const afterRankLevel = profile.rankLevel + magnitude;
  const afterMajorIndex = majorIndexForRankLevel(afterRankLevel);
  const newlyReachedMajorCount = Math.max(0, afterMajorIndex - profile.highestMajorIndex);
  const protectionCardsGranted = newlyReachedMajorCount * PROTECTION_CARDS_PER_NEW_MAJOR;

  return {
    outcome,
    beforeRankLevel: profile.rankLevel,
    afterRankLevel,
    beforeHighestMajorIndex: profile.highestMajorIndex,
    afterHighestMajorIndex:
      afterMajorIndex > profile.highestMajorIndex ? afterMajorIndex : profile.highestMajorIndex,
    rawDelta: magnitude,
    appliedDelta: magnitude,
    protectedLevels: 0,
    protectionCardsBefore: cardsBefore,
    protectionCardsConsumed: 0,
    protectionCardsGranted,
    protectionCardsAfter: cardsBefore + protectionCardsGranted,
  };
}
