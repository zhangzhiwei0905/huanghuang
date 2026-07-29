import type {
  CompetitiveMatchProjection,
  RoomProjection,
  RoundSettlementProjection,
} from "@huanghuang/protocol";

// Captured from a MATCH room's final CLOSED projection so the empty-shell
// page (rendered once `room` goes back to null) can still offer a working
// "continue matching" / "return home" pair instead of losing the matchId the
// instant the settlement modal's backing room disappears.
export type LastCompetitiveSettlement = {
  competitiveMatch: CompetitiveMatchProjection;
  roundSettlement: RoundSettlementProjection;
};

/**
 * The server keeps a CLOSED room's final round's competitiveMatch and
 * roundSettlement populated — `closeRoom()` server-side never clears them —
 * so this pulls that snapshot out of an incoming CLOSED projection. useRoom
 * preserves the result across clearing `room`; without it the settlement
 * modal's matchId disappears the instant the room closes and the
 * empty-shell page has nothing left to act on.
 */
export function deriveLastSettlementFromClosedProjection(
  projection: RoomProjection,
): LastCompetitiveSettlement | null {
  if (projection.mode !== "MATCH") return null;
  if (projection.competitiveMatch === null || projection.roundSettlement === null) return null;
  return {
    competitiveMatch: projection.competitiveMatch,
    roundSettlement: projection.roundSettlement,
  };
}
