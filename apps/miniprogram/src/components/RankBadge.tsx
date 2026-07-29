import { Image, Text, View } from "@tarojs/components";
import type { CompetitiveRankDisplay } from "@huanghuang/protocol";
import blackIronBadge from "../assets/ranks/black-iron.svg";
import bronzeBadge from "../assets/ranks/bronze.svg";
import silverBadge from "../assets/ranks/silver.svg";
import goldBadge from "../assets/ranks/gold.svg";
import platinumBadge from "../assets/ranks/platinum.svg";
import diamondBadge from "../assets/ranks/diamond.svg";
import starlightBadge from "../assets/ranks/starlight.svg";
import mahjongDeityBadge from "../assets/ranks/mahjong-deity.svg";
import "./RankBadge.scss";

const BADGES = [
  blackIronBadge,
  bronzeBadge,
  silverBadge,
  goldBadge,
  platinumBadge,
  diamondBadge,
  starlightBadge,
  mahjongDeityBadge,
] as const;

export type RankBadgeProps = {
  rank: CompetitiveRankDisplay;
  size?: "compact" | "medium" | "large";
  showLabel?: boolean;
  className?: string;
};

export function rankBadgeAsset(rank: CompetitiveRankDisplay): string {
  return BADGES[rank.majorIndex];
}

export function RankBadge({
  rank,
  size = "medium",
  showLabel = true,
  className = "",
}: RankBadgeProps) {
  return (
    <View
      className={`rank-badge rank-badge--${size}${className.length > 0 ? ` ${className}` : ""}`}
    >
      <Image
        className="rank-badge__image"
        src={rankBadgeAsset(rank)}
        mode="aspectFit"
        ariaLabel={`${rank.displayName}段位徽章`}
      />
      {showLabel ? <Text className="rank-badge__label">{rank.displayName}</Text> : null}
    </View>
  );
}
