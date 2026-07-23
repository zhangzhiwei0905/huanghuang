import type { RoomStage } from "@huanghuang/protocol";

export const ROUND_START_COUNTDOWN_SECONDS = 3;

export function shouldShowRoundStart(
  previousStage: RoomStage | null,
  nextStage: RoomStage | null,
): boolean {
  return previousStage === "WAITING" && nextStage === "PLAYING";
}
