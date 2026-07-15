import { z } from "zod";

export const TILE_SUITS = ["WAN", "TIAO", "TONG"] as const;
export const TILE_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const BASE_SCORES = [1, 2, 5, 10] as const;

export const tileSuitSchema = z.enum(TILE_SUITS);
export const tileRankSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);

export const tileKindSchema = z.object({
  suit: tileSuitSchema,
  rank: tileRankSchema,
});

export const tileSchema = tileKindSchema.extend({
  id: z.string().min(1),
});

export const baseScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(10)]);

export type TileSuit = z.infer<typeof tileSuitSchema>;
export type TileRank = z.infer<typeof tileRankSchema>;
export type TileKind = z.infer<typeof tileKindSchema>;
export type Tile = z.infer<typeof tileSchema>;
export type BaseScore = z.infer<typeof baseScoreSchema>;

export type Seat = 0 | 1 | 2 | 3;
export type WinType = "HARD" | "SOFT";
export type PersonalMultiplier = 1 | 2 | 4 | 8 | 16;

export type MeldKind =
  "PONG" | "EXPOSED_KONG" | "CONCEALED_KONG" | "ADDED_KONG" | "INDICATOR_PONG_KONG";

export type Meld = {
  id: string;
  kind: MeldKind;
  tileIds: string[];
  tileKind: TileKind;
  sourcePlayerId: string | null;
  sourceDiscardId: string | null;
  createdAtVersion: number;
};
