import { z } from "zod";

/**
 * Input for updating the currently authenticated player's own profile
 * (nickname, and later avatar). Mirrors the nickname constraint used by
 * createRoomSchema / joinRoomSchema so server-side validation stays
 * consistent across every nickname entry path.
 */
export const updateProfileInputSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
