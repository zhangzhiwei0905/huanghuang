import { Text, View } from "@tarojs/components";
import type { CompetitiveSettlementProjection } from "@huanghuang/protocol";
import { RankBadge } from "./RankBadge";
import "./RankPromotionOverlay.scss";

export function RankPromotionOverlay({
  settlement,
}: {
  settlement: CompetitiveSettlementProjection;
}) {
  return (
    <View className="rank-promotion" catchMove>
      <View className="rank-promotion__aurora" />
      <View className="rank-promotion__flare rank-promotion__flare--a" />
      <View className="rank-promotion__flare rank-promotion__flare--b" />
      <View className="rank-promotion__content">
        <Text className="rank-promotion__eyebrow">RANK PROMOTED</Text>
        <Text className="rank-promotion__title">段位晋升</Text>
        <View className="rank-promotion__ranks">
          <RankBadge rank={settlement.beforeRankDisplay} size="large" />
          <View className="rank-promotion__arrow">
            <View />
            <Text>›</Text>
          </View>
          <RankBadge
            rank={settlement.afterRankDisplay}
            size="large"
            className="rank-promotion__new-rank"
          />
        </View>
        <Text className="rank-promotion__transition">
          {settlement.beforeRankDisplay.displayName}
          {" → "}
          {settlement.afterRankDisplay.displayName}
        </Text>
      </View>
    </View>
  );
}
