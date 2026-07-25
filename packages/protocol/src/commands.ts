import { z } from "zod";
import { baseScoreSchema } from "./game.js";

export const roomModeSchema = z.enum(["FRIEND", "BOT"]);

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
  mode: roomModeSchema,
  turnTimeoutSeconds: turnTimeoutSecondsSchema.default(DEFAULT_TURN_TIMEOUT_SECONDS),
});

export const joinRoomSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
  roomCode: z.string().regex(/^\d{6}$/u),
});

export const readyRoomSchema = z.object({
  ready: z.boolean(),
});

export const updateRoomSettingsSchema = z.object({
  baseScore: baseScoreSchema,
});

export const chatMessageInputSchema = z.object({
  roomCode: z.string().regex(/^\d{6}$/u),
  message: z.string().trim().min(1).max(60),
});

export type CommandType = z.infer<typeof commandTypeSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type RoomMode = z.infer<typeof roomModeSchema>;
export type ReadyRoomInput = z.infer<typeof readyRoomSchema>;
export type UpdateRoomSettingsInput = z.infer<typeof updateRoomSettingsSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;

export type CommandResult = {
  accepted: boolean;
  requestId: string;
  serverVersion: number;
  errorCode: string | null;
  message: string | null;
};
