import { z } from "zod";
import { baseScoreSchema } from "./game.js";

export const roomModeSchema = z.enum(["FRIEND", "BOT", "TEAM_MATCH", "MATCH"]);
export const creatableRoomModeSchema = z.enum(["FRIEND", "BOT", "TEAM_MATCH"]);
export const botDifficultySchema = z.enum(["LOW", "HIGH"]);
export type BotDifficulty = z.infer<typeof botDifficultySchema>;
export const BOT_DIFFICULTY_OPTIONS: readonly BotDifficulty[] = ["LOW", "HIGH"];
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "HIGH";

export const roomCodeSchema = z.string().regex(/^(?:[1-9]\d{3}|\d{6})$/u);

export const turnTimeoutSecondsSchema = z.union([z.literal(20), z.literal(25), z.literal(30)]);
export type TurnTimeoutSeconds = z.infer<typeof turnTimeoutSecondsSchema>;
export const TURN_TIMEOUT_SECONDS_OPTIONS: readonly TurnTimeoutSeconds[] = [20, 25, 30];
export const DEFAULT_TURN_TIMEOUT_SECONDS: TurnTimeoutSeconds = 20;

export const commandTypeSchema = z.enum([
  "SET_READY",
  "LEAVE_ROOM",
  "REQUEST_DISSOLVE_AFTER_ROUND",
  "DECLARE_WIN",
  "CONTINUE_TURN",
  "RELEASE_WILDCARD",
  "DISCARD_TILE",
  "CLAIM_PONG",
  "CLAIM_EXPOSED_KONG",
  "DECLARE_CONCEALED_KONG",
  "DECLARE_ADDED_KONG",
  "CLAIM_INDICATOR_PONG_KONG",
  "PASS_RESPONSE",
]);

export const commandEnvelopeSchema = z.object({
  type: commandTypeSchema,
  requestId: z.uuid(),
  roomId: z.string().min(1),
  roundId: z.string().min(1).nullable(),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});

export const createRoomSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
  baseScore: baseScoreSchema.default(2),
  mode: creatableRoomModeSchema,
  turnTimeoutSeconds: turnTimeoutSecondsSchema.default(DEFAULT_TURN_TIMEOUT_SECONDS),
  botDifficulty: botDifficultySchema.default(DEFAULT_BOT_DIFFICULTY),
});

export const joinRoomSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
  roomCode: roomCodeSchema,
});

export const readyRoomSchema = z.object({
  ready: z.boolean(),
});

export const teamMatchmakingInputSchema = z.object({
  allowBots: z.boolean().optional(),
});

export const updateRoomSettingsSchema = z
  .object({
    baseScore: baseScoreSchema.optional(),
    botDifficulty: botDifficultySchema.optional(),
  })
  .refine((settings) => settings.baseScore !== undefined || settings.botDifficulty !== undefined);

export const removeRoomBotSchema = z.object({
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * Owner-only kick in a team-ranked waiting room. Identifies the target by
 * seat (not session id): room projections intentionally never expose other
 * members' session ids — a session id is the bearer credential itself.
 */
export const kickMemberInputSchema = z.object({
  targetSeat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export const chatMessageInputSchema = z.object({
  roomCode: roomCodeSchema,
  message: z.string().trim().min(1).max(60),
});

export type CommandType = z.infer<typeof commandTypeSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type RoomMode = z.infer<typeof roomModeSchema>;
export type ReadyRoomInput = z.infer<typeof readyRoomSchema>;
export type TeamMatchmakingInput = z.infer<typeof teamMatchmakingInputSchema>;
export type UpdateRoomSettingsInput = z.infer<typeof updateRoomSettingsSchema>;
export type RemoveRoomBotInput = z.infer<typeof removeRoomBotSchema>;
export type KickMemberInput = z.infer<typeof kickMemberInputSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;

export type CommandResult = {
  accepted: boolean;
  requestId: string;
  serverVersion: number;
  errorCode: string | null;
  message: string | null;
};
