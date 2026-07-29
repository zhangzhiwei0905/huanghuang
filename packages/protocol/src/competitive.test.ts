import { describe, expect, it } from "vitest";
import {
  COMPETITIVE_MULTIPLIERS,
  competitiveAchievementActionSchema,
  competitiveMultiplierSchema,
  competitiveRankStateSchema,
  competitiveRankTransitionSchema,
  matchmakingQueueInputSchema,
  matchmakingStateSchema,
  publicCompetitiveProfileSchema,
  selfCompetitiveProfileSchema,
  teamMatchmakingProjectionSchema,
} from "./competitive.js";

const rankDisplay = {
  majorIndex: 3,
  majorName: "黄金",
  minorLabel: "Ⅴ",
  displayName: "黄金Ⅴ",
} as const;

const achievements = {
  exposedKong: 1,
  indicatorPongKong: 2,
  addedKong: 3,
  concealedKong: 4,
  releaseWildcard: 5,
};

describe("competitive protocol", () => {
  it("accepts every rank multiplier and rejects unsupported effective multipliers", () => {
    for (const multiplier of COMPETITIVE_MULTIPLIERS) {
      expect(competitiveMultiplierSchema.parse(multiplier)).toBe(multiplier);
    }
    for (const multiplier of [0, 3, 24, 65, 128]) {
      expect(competitiveMultiplierSchema.safeParse(multiplier).success).toBe(false);
    }
  });

  it("accepts exactly the five competitive achievement actions", () => {
    for (const action of [
      "EXPOSED_KONG",
      "INDICATOR_PONG_KONG",
      "ADDED_KONG",
      "CONCEALED_KONG",
      "RELEASE_WILDCARD",
    ]) {
      expect(competitiveAchievementActionSchema.safeParse(action).success).toBe(true);
    }
    expect(competitiveAchievementActionSchema.safeParse("PONG").success).toBe(false);
  });

  it("keeps protection cards out of public profiles", () => {
    const publicProfile = publicCompetitiveProfileSchema.parse({
      rankDisplay,
      achievements,
    });
    expect(publicProfile).toEqual({ rankDisplay, achievements });
    expect("protectionCards" in publicProfile).toBe(false);

    expect(
      selfCompetitiveProfileSchema.parse({
        rankDisplay,
        achievements,
        rankLevel: 15,
        protectionCards: 2,
      }),
    ).toEqual({ rankDisplay, achievements, rankLevel: 15, protectionCards: 2 });
  });

  it("rejects invalid rank profile state", () => {
    expect(
      competitiveRankStateSchema.parse({
        rankLevel: 35,
        highestMajorIndex: 7,
        protectionCards: 0,
      }),
    ).toEqual({ rankLevel: 35, highestMajorIndex: 7, protectionCards: 0 });
    expect(
      competitiveRankStateSchema.safeParse({
        rankLevel: 35,
        highestMajorIndex: 6,
        protectionCards: 0,
      }).success,
    ).toBe(false);
    expect(
      competitiveRankStateSchema.safeParse({
        rankLevel: 0,
        highestMajorIndex: 0,
        protectionCards: -1,
      }).success,
    ).toBe(false);
  });

  it("decodes new and continue-matchmaking queue intents", () => {
    expect(matchmakingQueueInputSchema.parse({})).toEqual({});
    expect(matchmakingQueueInputSchema.parse({ previousMatchId: "match-1" })).toEqual({
      previousMatchId: "match-1",
    });
    expect(matchmakingQueueInputSchema.safeParse({ previousMatchId: "" }).success).toBe(false);
  });

  it("decodes idle, queued, and matched matchmaking states", () => {
    expect(matchmakingStateSchema.parse({ status: "IDLE" })).toEqual({ status: "IDLE" });
    expect(
      matchmakingStateSchema.parse({
        status: "QUEUED",
        enqueuedAt: "2026-07-28T10:00:00.000Z",
        disconnectedAt: null,
        rankLevelSnapshot: 12,
        partyRoomId: "team-room-1",
      }),
    ).toEqual({
      status: "QUEUED",
      enqueuedAt: "2026-07-28T10:00:00.000Z",
      disconnectedAt: null,
      rankLevelSnapshot: 12,
      partyRoomId: "team-room-1",
    });
    expect(
      matchmakingStateSchema.parse({ status: "MATCHED", matchId: "match-1", roomId: "room-1" }),
    ).toEqual({ status: "MATCHED", matchId: "match-1", roomId: "room-1" });
    expect(
      matchmakingStateSchema.safeParse({
        status: "QUEUED",
        enqueuedAt: "not-a-date",
        disconnectedAt: null,
        rankLevelSnapshot: 12,
      }).success,
    ).toBe(false);

    expect(
      teamMatchmakingProjectionSchema.parse({
        status: "QUEUED",
        enqueuedAt: "2026-07-28T10:00:00.000Z",
        memberCount: 3,
      }),
    ).toEqual({
      status: "QUEUED",
      enqueuedAt: "2026-07-28T10:00:00.000Z",
      memberCount: 3,
    });
    expect(
      teamMatchmakingProjectionSchema.safeParse({
        status: "QUEUED",
        enqueuedAt: "2026-07-28T10:00:00.000Z",
        memberCount: 1,
      }).success,
    ).toBe(true);
    expect(
      teamMatchmakingProjectionSchema.safeParse({
        status: "QUEUED",
        enqueuedAt: "2026-07-28T10:00:00.000Z",
        memberCount: 0,
      }).success,
    ).toBe(false);
  });

  it("decodes a complete authoritative rank transition", () => {
    expect(
      competitiveRankTransitionSchema.parse({
        outcome: { kind: "LOSS", multiplier: 16 },
        beforeRankLevel: 20,
        afterRankLevel: 17,
        beforeHighestMajorIndex: 4,
        afterHighestMajorIndex: 4,
        rawDelta: -5,
        appliedDelta: -3,
        protectedLevels: 2,
        protectionCardsBefore: 2,
        protectionCardsConsumed: 2,
        protectionCardsGranted: 0,
        protectionCardsAfter: 0,
      }),
    ).toMatchObject({
      outcome: { kind: "LOSS", multiplier: 16 },
      rawDelta: -5,
      appliedDelta: -3,
      protectedLevels: 2,
    });

    expect(
      competitiveRankTransitionSchema.safeParse({
        outcome: { kind: "LOSS", multiplier: 3 },
        beforeRankLevel: 20,
        afterRankLevel: 17,
        beforeHighestMajorIndex: 4,
        afterHighestMajorIndex: 4,
        rawDelta: -5,
        appliedDelta: -3,
        protectedLevels: 2,
        protectionCardsBefore: 2,
        protectionCardsConsumed: 2,
        protectionCardsGranted: 0,
        protectionCardsAfter: 0,
      }).success,
    ).toBe(false);
  });
});
