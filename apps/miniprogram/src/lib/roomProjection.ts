import type { RoomProjection } from "@huanghuang/protocol";

export function normalizeRoomProjection(projection: RoomProjection): RoomProjection {
  if (projection.effectCue !== undefined) return projection;
  return { ...projection, effectCue: null };
}
