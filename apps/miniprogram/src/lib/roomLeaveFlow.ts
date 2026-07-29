import type { RoomMode, RoomStage } from "@huanghuang/protocol";

/**
 * Whether leaving a room must acknowledge the competitive match first.
 *
 * The floating leave-fab is shown for any stage other than WAITING —
 * including ROUND_RESULT, where RoundSettlementModal's own "离开" button
 * already routes through `returnFromCompetitiveMatch` (which acks). The
 * leave-fab previously skipped that ack entirely: the server kept
 * `hasActiveCompetitiveMatch` true for the session, so when the player
 * landed back on the home page its MATCHED state bounced them straight back
 * into this room, forming a stuck loop with no way out.
 */
export function shouldAcknowledgeMatchBeforeLeaving(mode: RoomMode, stage: RoomStage): boolean {
  return mode === "MATCH" && stage === "ROUND_RESULT";
}

/**
 * Whether leaving mid-round should first confirm the trusteeship handoff
 * with the player. Only applies to an in-progress competitive round — a
 * friend/bot room, or a competitive round that has already reached
 * settlement, leaves without this confirmation step.
 */
export function shouldConfirmTrusteeHandoffBeforeLeaving(
  mode: RoomMode,
  stage: RoomStage,
): boolean {
  return mode === "MATCH" && stage === "PLAYING";
}
