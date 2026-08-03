import { z } from "zod";

export const COMPETITIVE_MULTIPLIERS = [1, 2, 4, 8, 16, 32, 64] as const;

export const competitiveMultiplierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(16),
  z.literal(32),
  z.literal(64),
]);

export const effectiveMultiplierSchema = competitiveMultiplierSchema;

export const competitiveRankLevelSchema = z.number().int().nonnegative();
export const competitiveMajorIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
export const protectionCardCountSchema = z.number().int().nonnegative();

export const competitiveRankDisplaySchema = z.object({
  majorIndex: competitiveMajorIndexSchema,
  majorName: z.enum(["黑铁", "青铜", "白银", "黄金", "铂金", "钻石", "星耀", "雀神"]),
  minorLabel: z.enum(["Ⅴ", "Ⅳ", "Ⅲ", "Ⅱ", "Ⅰ"]).nullable(),
  displayName: z.string().min(1),
});

export const competitiveAchievementActionSchema = z.enum([
  "EXPOSED_KONG",
  "INDICATOR_PONG_KONG",
  "ADDED_KONG",
  "CONCEALED_KONG",
  "RELEASE_WILDCARD",
  "HARD_LAIYOU",
  "SOFT_LAIYOU",
]);

export const competitiveAchievementTotalsSchema = z.object({
  exposedKong: z.number().int().nonnegative(),
  indicatorPongKong: z.number().int().nonnegative(),
  addedKong: z.number().int().nonnegative(),
  concealedKong: z.number().int().nonnegative(),
  releaseWildcard: z.number().int().nonnegative(),
  hardLaiyou: z.number().int().nonnegative(),
  softLaiyou: z.number().int().nonnegative(),
});

export const publicCompetitiveProfileSchema = z.object({
  rankDisplay: competitiveRankDisplaySchema,
  achievements: competitiveAchievementTotalsSchema,
});

export const selfCompetitiveProfileSchema = publicCompetitiveProfileSchema.extend({
  rankLevel: competitiveRankLevelSchema,
  protectionCards: protectionCardCountSchema,
  /** 胡牌加倍卡剩余张数：胡牌结算前可选择使用一张，加星翻倍。 */
  winDoubleCards: protectionCardCountSchema,
  /** 排位保护卡剩余张数：在背包中使用，每张延长生效期 2 小时。 */
  rankProtectionCards: protectionCardCountSchema,
  /** 排位保护卡生效截止时间；null 表示未生效。 */
  rankProtectionActiveUntil: z.iso.datetime({ offset: true }).nullable(),
});

export const competitiveRankStateSchema = z
  .object({
    rankLevel: competitiveRankLevelSchema,
    highestMajorIndex: competitiveMajorIndexSchema,
    protectionCards: protectionCardCountSchema,
  })
  .refine((state) => state.highestMajorIndex >= Math.min(Math.floor(state.rankLevel / 5), 7), {
    message: "highestMajorIndex cannot be below the current major index",
    path: ["highestMajorIndex"],
  });

export const competitiveRankOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("WIN"),
    multiplier: competitiveMultiplierSchema,
    /** 赢家使用了胡牌加倍卡：加星在 magnitude 基础上翻倍。 */
    doubleCard: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("LOSS"),
    multiplier: competitiveMultiplierSchema,
    /** 结算时排位保护卡生效：扣星先减半（向下取整）再抵保星卡。 */
    protectionHalved: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("DRAW") }),
]);

export const competitiveRankTransitionSchema = z.object({
  outcome: competitiveRankOutcomeSchema,
  beforeRankLevel: competitiveRankLevelSchema,
  afterRankLevel: competitiveRankLevelSchema,
  beforeHighestMajorIndex: competitiveMajorIndexSchema,
  afterHighestMajorIndex: competitiveMajorIndexSchema,
  rawDelta: z.number().int(),
  appliedDelta: z.number().int(),
  protectedLevels: z.number().int().nonnegative(),
  protectionCardsBefore: protectionCardCountSchema,
  protectionCardsConsumed: protectionCardCountSchema,
  protectionCardsGranted: protectionCardCountSchema,
  protectionCardsAfter: protectionCardCountSchema,
  /** 该次转场是否消耗了胡牌加倍卡（仅赢家可能为 true）。 */
  winDoubleCardUsed: z.boolean().default(false),
  /** 该次转场是否应用了排位保护卡的扣星减半（仅输家可能为 true）。 */
  rankProtectionApplied: z.boolean().default(false),
});

export const competitiveMatchProjectionSchema = z.object({
  matchId: z.string().min(1),
  ruleVersion: z.number().int().positive(),
  /**
   * Room code of the team-ranked staging room this player queued from as
   * part of a pre-made party, if any and if that room still exists. Lets
   * "continue" send the player back to regroup with their original party
   * instead of silently re-queueing them solo.
   */
  originRoomCode: z.string().min(1).nullable(),
});

export const competitiveSettlementProjectionSchema = competitiveMatchProjectionSchema.extend({
  self: competitiveRankTransitionSchema,
  beforeRankDisplay: competitiveRankDisplaySchema,
  afterRankDisplay: competitiveRankDisplaySchema,
});

export const competitiveMatchOutcomeSchema = z.enum(["WIN", "LOSS", "DRAW"]);

export const competitiveMatchHistoryEntrySchema = z.object({
  matchId: z.string().min(1),
  settledAt: z.iso.datetime({ offset: true }),
  outcome: competitiveMatchOutcomeSchema,
  /** The querying player's own multiplier for this match; null for a draw. */
  multiplier: competitiveMultiplierSchema.nullable(),
  finalRankDelta: z.number().int(),
  /** Set only when the match's rank change crossed a major-tier boundary. */
  crossedMajor: z.enum(["UP", "DOWN"]).nullable(),
});

export const competitiveMatchHistoryPageSchema = z.object({
  entries: z.array(competitiveMatchHistoryEntrySchema),
  nextCursor: z.string().nullable(),
});

export const matchmakingQueueInputSchema = z.object({
  previousMatchId: z.string().min(1).optional(),
  // Experience-phase toggle: when true and the server has ranked bots
  // enabled, the queued player is matched immediately against three preset
  // ranked bot accounts instead of waiting for four real humans. The server
  // ignores this flag when its bot switch is off, so the same client build is
  // safe to ship after launch.
  allowBots: z.boolean().optional(),
});

export const matchmakingStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("IDLE") }),
  z.object({
    status: z.literal("QUEUED"),
    enqueuedAt: z.iso.datetime({ offset: true }),
    disconnectedAt: z.iso.datetime({ offset: true }).nullable(),
    rankLevelSnapshot: competitiveRankLevelSchema,
    partyRoomId: z.string().min(1).optional(),
  }),
  z.object({
    status: z.literal("MATCHED"),
    matchId: z.string().min(1),
    roomId: z.string().min(1),
  }),
]);

export const teamMatchmakingProjectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("IDLE") }),
  z.object({
    status: z.literal("QUEUED"),
    enqueuedAt: z.iso.datetime({ offset: true }),
    memberCount: z.number().int().min(1).max(4),
  }),
  z.object({
    status: z.literal("MATCHED"),
    matchId: z.string().min(1),
    roomId: z.string().min(1),
  }),
]);

export type CompetitiveMultiplier = z.infer<typeof competitiveMultiplierSchema>;
export type EffectiveMultiplier = CompetitiveMultiplier;
export type CompetitiveMajorIndex = z.infer<typeof competitiveMajorIndexSchema>;
export type CompetitiveAchievementAction = z.infer<typeof competitiveAchievementActionSchema>;
export type CompetitiveRankDisplay = z.infer<typeof competitiveRankDisplaySchema>;
export type CompetitiveAchievementTotals = z.infer<typeof competitiveAchievementTotalsSchema>;
export type PublicCompetitiveProfile = z.infer<typeof publicCompetitiveProfileSchema>;
export type SelfCompetitiveProfile = z.infer<typeof selfCompetitiveProfileSchema>;
export type CompetitiveRankState = z.infer<typeof competitiveRankStateSchema>;
export type CompetitiveRankOutcome = z.infer<typeof competitiveRankOutcomeSchema>;
export type CompetitiveRankTransition = z.infer<typeof competitiveRankTransitionSchema>;
export type CompetitiveMatchProjection = z.infer<typeof competitiveMatchProjectionSchema>;
export type CompetitiveSettlementProjection = z.infer<typeof competitiveSettlementProjectionSchema>;
export type CompetitiveMatchOutcome = z.infer<typeof competitiveMatchOutcomeSchema>;
export type CompetitiveMatchHistoryEntry = z.infer<typeof competitiveMatchHistoryEntrySchema>;
export type CompetitiveMatchHistoryPage = z.infer<typeof competitiveMatchHistoryPageSchema>;
export type MatchmakingQueueInput = z.infer<typeof matchmakingQueueInputSchema>;
export type MatchmakingState = z.infer<typeof matchmakingStateSchema>;
export type TeamMatchmakingProjection = z.infer<typeof teamMatchmakingProjectionSchema>;
