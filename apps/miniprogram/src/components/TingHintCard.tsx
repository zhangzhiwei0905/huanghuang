import type { CSSProperties } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import type { Tile, TileKind, TingWaitProjection } from "@huanghuang/protocol";
import type { TingCardAnchor } from "../lib/tingHints";
import { MahjongTile } from "./MahjongTile";
import "./TingHintCard.scss";

type TingHintCardProps = {
  waits: readonly TingWaitProjection[];
  wildcardKind: TileKind | null;
  anchor: TingCardAnchor;
};

export function TingHintCard({ waits, wildcardKind, anchor }: TingHintCardProps) {
  return (
    <View className="ting-hint-rail">
      <View
        className={`ting-hint-card is-${anchor.alignment}`}
        style={{ left: `${anchor.positionPercent}%` } as CSSProperties}
      >
        <Text className="ting-hint-card__title">打出此牌可胡</Text>
        <ScrollView className="ting-hint-card__scroll" scrollX>
          <View className="ting-hint-card__list">
            {waits.map((wait) => {
              const previewTile: Tile = {
                id: `ting-preview-${wait.tileKind.suit}-${wait.tileKind.rank}`,
                ...wait.tileKind,
              };
              return (
                <View
                  key={`${wait.tileKind.suit}-${wait.tileKind.rank}`}
                  className={`ting-hint-card__item${
                    wait.remainingCount === 0 ? " is-exhausted" : ""
                  }`}
                >
                  <MahjongTile tile={previewTile} compact wildcardKind={wildcardKind} />
                  <View className="ting-hint-card__copy">
                    <Text className="ting-hint-card__type">
                      {wait.winType === "HARD" ? "硬胡" : "软胡"} {wait.multiplier}×
                    </Text>
                    <Text className="ting-hint-card__remaining">
                      {wait.remainingCount === 0
                        ? "剩 0 张 · 已绝张"
                        : `剩 ${wait.remainingCount} 张`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
