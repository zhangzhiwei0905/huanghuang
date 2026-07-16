import { z } from "zod";
import { baseScoreSchema } from "./game.js";

export const roomModeSchema = z.enum(["FRIEND", "BOT"]);

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
});

export const joinRoomSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
  roomCode: z.string().regex(/^\d{6}$/u),
});

export type CommandType = z.infer<typeof commandTypeSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type RoomMode = z.infer<typeof roomModeSchema>;

export type CommandResult = {
  accepted: boolean;
  requestId: string;
  serverVersion: number;
  errorCode: string | null;
  message: string | null;
};
