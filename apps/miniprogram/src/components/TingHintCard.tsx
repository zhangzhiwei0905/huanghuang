import type { CSSProperties } from "react";
import { Text, View } from "@tarojs/components";
import type { Tile, TileKind, TingWaitProjection } from "@huanghuang/protocol";
import { orderTingWaits, type TingCardAnchor } from "../lib/tingHints";
import { MahjongTile } from "./MahjongTile";
import "./TingHintCard.scss";

type TingHintCardProps = {
  waits: readonly TingWaitProjection[];
  wildcardKind: TileKind | null;
  anchor: TingCardAnchor;
};

export function TingHintCard({ waits, wildcardKind, anchor }: TingHintCardProps) {
  const orderedWaits = orderTingWaits(waits);
  const densityClass = orderedWaits.length === 1 ? "is-single" : "is-multiple";

  return (
    <View className="ting-hint-rail">
      <View
        className={`ting-hint-card is-${anchor.alignment} ${densityClass}`}
        style={{ left: `${anchor.positionPercent}%` } as CSSProperties}
      >
        <View className="ting-hint-card__heading">
          <Text className="ting-hint-card__title">打出此牌可胡</Text>
          <Text className="ting-hint-card__summary">共 {orderedWaits.length} 种</Text>
        </View>
        <View className="ting-hint-card__list">
          {orderedWaits.map((wait) => {
            const previewTile: Tile = {
              id: `ting-preview-${wait.tileKind.suit}-${wait.tileKind.rank}`,
              ...wait.tileKind,
            };
            return (
              <View
                key={`${wait.tileKind.suit}-${wait.tileKind.rank}-${wait.winType}`}
                className={`ting-hint-card__item${
                  wait.remainingCount === 0 ? " is-exhausted" : ""
                }`}
              >
                <MahjongTile tile={previewTile} compact wildcardKind={wildcardKind} />
                <View className="ting-hint-card__copy">
                  <View className="ting-hint-card__metrics">
                    <Text className={`ting-hint-card__type is-${wait.winType.toLowerCase()}`}>
                      {wait.winType === "HARD" ? "硬胡" : "软胡"}
                    </Text>
                    <Text className="ting-hint-card__multiplier">{wait.multiplier}×</Text>
                    <Text className="ting-hint-card__remaining">
                      {wait.remainingCount === 0
                        ? "余 0 张 · 已绝张"
                        : `余 ${wait.remainingCount} 张`}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
