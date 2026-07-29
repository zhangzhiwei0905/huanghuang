import type { CompetitiveSettlementProjection } from "@huanghuang/protocol";

export function rankPromotionKey(settlement: CompetitiveSettlementProjection): string {
  return `${settlement.matchId}:${settlement.self.afterRankLevel}`;
}

export function shouldShowRankPromotion(
  settlement: CompetitiveSettlementProjection | null,
): settlement is CompetitiveSettlementProjection {
  return (
    settlement !== null &&
    settlement.self.afterRankLevel > settlement.self.beforeRankLevel &&
    settlement.afterRankDisplay.displayName !== settlement.beforeRankDisplay.displayName
  );
}
