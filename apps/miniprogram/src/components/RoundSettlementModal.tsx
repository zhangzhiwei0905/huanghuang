import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import type {
  PlayerProjection,
  RoomMode,
  RoundSettlementProjection,
  Seat,
  TileKind,
} from "@huanghuang/protocol";
import { sortHand } from "../lib/tiles";
import { MahjongTile } from "./MahjongTile";
import { RankBadge } from "./RankBadge";
import { RankPromotionOverlay } from "./RankPromotionOverlay";
import { rankPromotionKey, shouldShowRankPromotion } from "../lib/rankPromotion";
import "./RoundSettlementModal.scss";

type RoundSettlementModalProps = {
  settlement: RoundSettlementProjection;
  players: PlayerProjection[];
  wildcardKind: TileKind | null;
  mode: RoomMode;
  busy: boolean;
  onContinue: () => void;
  onLeave: () => void;
};

const playedPromotionKeys = new Set<string>();

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function RoundSettlementModal({
  settlement,
  players,
  wildcardKind,
  mode,
  busy,
  onContinue,
  onLeave,
}: RoundSettlementModalProps) {
  const playerName = (seat: Seat) => players[seat]?.nickname ?? `玩家 ${seat + 1}`;
  const winTypeLabel =
    settlement.winType === "HARD"
      ? settlement.laiyou
        ? "硬来由"
        : "硬胡"
      : settlement.laiyou
        ? "软来由"
        : "软胡";
  const outcomeLabel =
    settlement.kind === "DRAW"
      ? "本局流局"
      : `${playerName(settlement.winnerSeat ?? 0)} ${winTypeLabel}`;
  const outcomeClass = `${
    settlement.kind === "DRAW"
      ? "is-draw"
      : settlement.winType === "HARD"
        ? "is-hard-win"
        : "is-soft-win"
  }${settlement.kind === "WIN" && settlement.laiyou ? " is-laiyou" : ""}`;
  const competitiveSettlement = settlement.competitiveSettlement;
  const [showPromotion, setShowPromotion] = useState(() => {
    if (!shouldShowRankPromotion(competitiveSettlement)) return false;
    const key = rankPromotionKey(competitiveSettlement);
    if (playedPromotionKeys.has(key)) return false;
    playedPromotionKeys.add(key);
    return true;
  });

  useEffect(() => {
    if (!showPromotion) return;
    const timer = setTimeout(() => setShowPromotion(false), 2_200);
    return () => clearTimeout(timer);
  }, [showPromotion]);

  return (
    <>
      {showPromotion && competitiveSettlement !== null ? (
        <RankPromotionOverlay settlement={competitiveSettlement} />
      ) : null}
      <View className="settlement-backdrop">
        <View className={`settlement-modal ${outcomeClass}`}>
          <View className="settlement-header">
            <View>
              <Text className="settlement-eyebrow">本局结算</Text>
              <Text className="settlement-outcome">{outcomeLabel}</Text>
            </View>
            <View className="settlement-meta-group">
              {settlement.laiyou ? <Text className="settlement-laiyou-badge">来由 ×2</Text> : null}
              <Text className="settlement-meta">
                {mode === "BOT"
                  ? "等待你的选择"
                  : mode === "MATCH"
                    ? "竞技对局已结束"
                    : "即将返回房间准备"}
              </Text>
            </View>
          </View>

          <View className="settlement-list">
            {settlement.finalHands.map((finalHand) => {
              const change = settlement.scoreChanges.find((item) => item.seat === finalHand.seat);
              const winner = settlement.winnerSeat === finalHand.seat;
              const payment = settlement.payments.find((item) => item.payerSeat === finalHand.seat);
              const effectiveMultiplier = winner
                ? settlement.winnerMultiplier
                : (payment?.payerEffectiveMultiplier ?? null);
              return (
                <View
                  key={finalHand.seat}
                  className={`settlement-row${winner ? " is-winner" : ""}${
                    change !== undefined && change.roundDelta > 0 ? " is-gain" : ""
                  }`}
                >
                  <View className="settlement-identity">
                    <Text className="settlement-name">{playerName(finalHand.seat)}</Text>
                    <Text className="settlement-role">
                      {winner ? "本局赢家" : `座位 ${finalHand.seat + 1}`}
                    </Text>
                  </View>
                  <View className="settlement-hand">
                    {sortHand(finalHand.tiles).map((tile) => (
                      <MahjongTile key={tile.id} tile={tile} compact wildcardKind={wildcardKind} />
                    ))}
                  </View>
                  <View className="settlement-multiplier">
                    <Text className="settlement-multiplier__label">
                      {settlement.kind === "WIN" ? "结算倍率" : "个人倍率"}
                    </Text>
                    <Text className="settlement-multiplier__value">
                      {effectiveMultiplier ?? finalHand.personalMultiplier}×
                    </Text>
                  </View>
                  <View className="settlement-score">
                    <View className="settlement-score__item">
                      <Text className="settlement-score__label">本局</Text>
                      <Text className="settlement-score__value">
                        {change === undefined ? "0" : signedScore(change.roundDelta)}
                      </Text>
                    </View>
                    <View className="settlement-score__item">
                      <Text className="settlement-score__label">累计</Text>
                      <Text className="settlement-score__value settlement-score__value--total">
                        {change?.totalScore ?? 0}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {mode === "MATCH" && settlement.competitiveSettlement !== null ? (
            <View className="settlement-rank">
              <View className="settlement-rank__main">
                <View>
                  <Text className="settlement-rank__label">段位变化</Text>
                  <View className="settlement-rank__badges">
                    <RankBadge
                      rank={settlement.competitiveSettlement.beforeRankDisplay}
                      size="compact"
                    />
                    <Text className="settlement-rank__arrow">→</Text>
                    <RankBadge
                      rank={settlement.competitiveSettlement.afterRankDisplay}
                      size="compact"
                    />
                  </View>
                </View>
                <Text
                  className={`settlement-rank__delta${
                    settlement.competitiveSettlement.self.appliedDelta >= 0
                      ? " is-gain"
                      : " is-loss"
                  }`}
                >
                  {signedScore(settlement.competitiveSettlement.self.appliedDelta)} 级
                </Text>
              </View>
              <View className="settlement-rank__details">
                {settlement.competitiveSettlement.self.winDoubleCardUsed ? (
                  <Text>胡牌加倍 ×2</Text>
                ) : null}
                {settlement.competitiveSettlement.self.rankProtectionApplied ? (
                  <Text>排位保护生效 · 扣星减半</Text>
                ) : null}
                {settlement.competitiveSettlement.self.protectedLevels > 0 ? (
                  <Text>
                    已保护 {settlement.competitiveSettlement.self.protectedLevels} 级
                    {settlement.competitiveSettlement.self.protectionCardsConsumed > 0
                      ? ` · 消耗 ${settlement.competitiveSettlement.self.protectionCardsConsumed} 张保星卡`
                      : " · 低段免降"}
                  </Text>
                ) : null}
                {settlement.competitiveSettlement.self.protectionCardsGranted > 0 ? (
                  <Text>
                    晋升奖励 +{settlement.competitiveSettlement.self.protectionCardsGranted}{" "}
                    张保星卡
                  </Text>
                ) : null}
                <Text>
                  保星卡余额 {settlement.competitiveSettlement.self.protectionCardsAfter} 张
                </Text>
              </View>
            </View>
          ) : null}

          {mode === "BOT" || mode === "MATCH" ? (
            <View className="settlement-actions">
              <Button
                className="btn-ghost"
                hoverClass="is-pressed"
                disabled={busy}
                onClick={onLeave}
              >
                {mode === "MATCH" ? "返回房间" : "退出到主页"}
              </Button>
              <Button
                className="btn-accent"
                hoverClass="is-pressed"
                disabled={busy}
                onClick={onContinue}
              >
                继续游戏
              </Button>
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
}
