import { useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import type { PublicCompetitiveProfile } from "@huanghuang/protocol";
import { API_BASE } from "../config";
import { RankBadge } from "./RankBadge";
import "./PlayerProfileModal.scss";

export type PlayerProfileModalProps = {
  nickname: string;
  avatarUrl: string | null;
  score: number;
  controller?: "HUMAN" | "BOT" | "TRUSTEE" | null;
  connected?: boolean;
  isSelf?: boolean;
  isOwner?: boolean;
  competitiveProfile: PublicCompetitiveProfile | null;
  onClose: () => void;
};

/**
 * Player detail popover triggered by tapping a seat's name. Shows the avatar
 * (tap again to zoom full-screen), nickname and cumulative score. Extra
 * status chips (房主 / 我 / 机器人 / 离线) are derived from the optional
 * flags so the same component works for both lobby and in-round seats.
 */
export function PlayerProfileModal({
  nickname,
  avatarUrl,
  score,
  controller = "HUMAN",
  connected = true,
  isSelf = false,
  isOwner = false,
  competitiveProfile,
  onClose,
}: PlayerProfileModalProps) {
  const [avatarZoomed, setAvatarZoomed] = useState(false);
  const fallback = controller === "BOT" ? "机" : nickname.slice(0, 1) || "玩";
  const hasAvatar = avatarUrl !== null && avatarUrl.length > 0;
  const avatarSrc = hasAvatar ? `${API_BASE}${avatarUrl}` : null;

  const chips: string[] = [];
  if (isSelf) chips.push("我");
  if (isOwner) chips.push("房主");
  if (controller === "BOT") chips.push("机器人");
  else if (controller === "TRUSTEE") chips.push("托管");
  if (!connected) chips.push("离线");

  return (
    <>
      <View className="profile-backdrop" onClick={onClose}>
        <View className="profile-modal" catchMove onClick={(e) => e.stopPropagation()}>
          <View className="profile-modal__header">
            <View
              className={`profile-avatar${hasAvatar ? " is-tappable" : ""}`}
              onClick={() => {
                if (hasAvatar) setAvatarZoomed(true);
              }}
            >
              {avatarSrc !== null ? (
                <Image src={avatarSrc} mode="aspectFill" className="profile-avatar__image" />
              ) : (
                <Text className="profile-avatar__fallback">{fallback}</Text>
              )}
              {hasAvatar ? <Text className="profile-avatar__hint">点击放大</Text> : null}
            </View>
          </View>

          <View className="profile-modal__body">
            <Text className="profile-modal__name">{nickname}</Text>
            {chips.length > 0 ? (
              <View className="profile-modal__chips">
                {chips.map((chip) => (
                  <Text key={chip} className="profile-modal__chip">
                    {chip}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>

          <View className="profile-modal__competitive">
            {competitiveProfile === null ? (
              <Text className="profile-modal__competitive-empty">无永久竞技战绩</Text>
            ) : (
              <>
                <View className="profile-modal__rank">
                  <Text className="profile-modal__rank-label">当前段位</Text>
                  <RankBadge rank={competitiveProfile.rankDisplay} size="large" />
                </View>
                <View className="profile-modal__achievements">
                  <View>
                    <Text>放赖</Text>
                    <Text>{competitiveProfile.achievements.releaseWildcard}</Text>
                  </View>
                  <View>
                    <Text>明杠</Text>
                    <Text>{competitiveProfile.achievements.exposedKong}</Text>
                  </View>
                  <View>
                    <Text>碰亮牌</Text>
                    <Text>{competitiveProfile.achievements.indicatorPongKong}</Text>
                  </View>
                  <View>
                    <Text>补杠</Text>
                    <Text>{competitiveProfile.achievements.addedKong}</Text>
                  </View>
                  <View>
                    <Text>暗杠</Text>
                    <Text>{competitiveProfile.achievements.concealedKong}</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          <View className="profile-modal__score">
            <Text className="profile-modal__score-label">牌桌积分</Text>
            <Text className="profile-modal__score-value">{score}</Text>
          </View>

          <View className="profile-modal__actions">
            <Button className="btn-ghost" hoverClass="is-pressed" onClick={onClose}>
              关闭
            </Button>
          </View>
        </View>
      </View>

      {avatarZoomed && avatarSrc !== null ? (
        <View className="profile-zoom" onClick={() => setAvatarZoomed(false)}>
          <Image src={avatarSrc} mode="aspectFit" className="profile-zoom__image" />
          <Text className="profile-zoom__hint">点击任意位置关闭</Text>
        </View>
      ) : null}
    </>
  );
}
