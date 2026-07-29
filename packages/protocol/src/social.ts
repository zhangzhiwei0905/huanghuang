import { z } from "zod";
import { publicCompetitiveProfileSchema } from "./competitive.js";
import { roomCodeSchema } from "./commands.js";

export const playerIdSchema = z.string().regex(/^[1-9]\d{3}$/u);

export const socialPlayerSchema = z.object({
  playerId: playerIdSchema,
  nickname: z.string().min(1).max(12),
  avatarUrl: z.string().nullable(),
  competitiveProfile: publicCompetitiveProfileSchema.nullable(),
});

export const friendSummarySchema = socialPlayerSchema.extend({
  online: z.boolean(),
  friendsSince: z.iso.datetime({ offset: true }),
});

export const friendRequestProjectionSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["INCOMING", "OUTGOING"]),
  player: socialPlayerSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const roomInviteProjectionSchema = z.object({
  id: z.string().min(1),
  roomCode: roomCodeSchema,
  inviter: socialPlayerSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});

export const socialSnapshotSchema = z.object({
  self: socialPlayerSchema,
  friends: z.array(friendSummarySchema),
  friendRequests: z.array(friendRequestProjectionSchema),
  roomInvites: z.array(roomInviteProjectionSchema),
});

export const playerSearchResultSchema = socialPlayerSchema.extend({
  relationship: z.enum(["SELF", "NONE", "FRIEND", "OUTGOING_PENDING", "INCOMING_PENDING"]),
  requestId: z.string().min(1).nullable(),
});

export const createFriendRequestInputSchema = z.object({ playerId: playerIdSchema });
export const createRoomInviteInputSchema = z.object({ playerId: playerIdSchema });

export type PlayerId = z.infer<typeof playerIdSchema>;
export type SocialPlayer = z.infer<typeof socialPlayerSchema>;
export type FriendSummary = z.infer<typeof friendSummarySchema>;
export type FriendRequestProjection = z.infer<typeof friendRequestProjectionSchema>;
export type RoomInviteProjection = z.infer<typeof roomInviteProjectionSchema>;
export type SocialSnapshot = z.infer<typeof socialSnapshotSchema>;
export type PlayerSearchResult = z.infer<typeof playerSearchResultSchema>;
export type CreateFriendRequestInput = z.infer<typeof createFriendRequestInputSchema>;
export type CreateRoomInviteInput = z.infer<typeof createRoomInviteInputSchema>;
