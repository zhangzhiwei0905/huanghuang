import { useCallback, useEffect, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import type { SelfCompetitiveProfile } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ApiError, checkinApi, competitiveApi } from "../../api/http";
import { API_BASE } from "../../config";
import { errorLabel } from "../../lib/errors";
import { rankProtectionCountdownText } from "../../lib/backpack";
import "./index.scss";

type CardKey = "PROTECTION_CARD" | "WIN_DOUBLE_CARD" | "RANK_PROTECTION_CARD";

// 道具卡图片由服务端静态托管（/cards/），不打进小程序包内。
const CARD_META: Record<CardKey, { name: string; image: string; effect: string }> = {
  PROTECTION_CARD: {
    name: "保星卡",
    image: `${API_BASE}/cards/protection-card.png`,
    effect: "排位失败扣星时自动消耗，按持有数量抵扣应扣的星星。",
  },
  WIN_DOUBLE_CARD: {
    name: "胡牌加倍卡",
    image: `${API_BASE}/cards/win-double-card.png`,
    effect: "胡牌后、结算前可选择使用：本局获得的星星翻倍，一局消耗一张。",
  },
  RANK_PROTECTION_CARD: {
    name: "排位保护卡",
    image: `${API_BASE}/cards/rank-protection-card.png`,
    effect: "使用后生效 2 小时，可叠加；生效期间排位失败扣星减半（向下取整）。",
  },
};

export default function BackpackPage() {
  const [profile, setProfile] = useState<SelfCompetitiveProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Wall-clock "now" drives the protection-card countdown so it keeps ticking
  // while the page is open and recovers correctly after backgrounding.
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setProfile(await competitiveApi.profile());
    } catch (cause) {
      setLoadError(cause instanceof ApiError ? errorLabel(cause.code) : "加载失败，请再试一次");
    }
  }, []);

  useDidShow(() => {
    void refresh();
  });

  // Tick once per second for the countdown; stop while inactive to avoid a
  // needless render loop when no protection card is running.
  const activeUntil = profile?.rankProtectionActiveUntil ?? null;
  const countdown = activeUntil === null ? null : rankProtectionCountdownText(activeUntil, now);
  const countdownActive = countdown !== null;
  useEffect(() => {
    if (!countdownActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [countdownActive]);

  async function useRankProtection() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await checkinApi.useRankProtection();
      setProfile((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              rankProtectionCards: result.rankProtectionCards,
              rankProtectionActiveUntil: result.rankProtectionActiveUntil,
            },
      );
      setNow(Date.now());
    } catch (cause) {
      setFeedback(cause instanceof ApiError ? errorLabel(cause.code) : "操作没有成功，请再试一次");
    } finally {
      setBusy(false);
    }
  }

  function renderCount(key: CardKey): number {
    if (profile === null) return 0;
    switch (key) {
      case "PROTECTION_CARD":
        return profile.protectionCards;
      case "WIN_DOUBLE_CARD":
        return profile.winDoubleCards;
      case "RANK_PROTECTION_CARD":
        return profile.rankProtectionCards;
    }
  }

  return (
    <View className="mp-backpack">
      <Image className="mp-backpack__bg" src={tableBackground} mode="aspectFill" />
      <View className="mp-backpack__overlay" />
      <View className="mp-backpack__panel">
        <Text className="mp-backpack__title">道具背包</Text>
        {loadError !== null ? (
          <View className="mp-backpack__empty">
            <Text className="mp-backpack__empty-text">{loadError}</Text>
            <Button hoverClass="is-pressed" className="mp-backpack__reload" onClick={() => void refresh()}>
              重新加载
            </Button>
          </View>
        ) : profile === null ? (
          <Text className="mp-backpack__empty-text">正在加载…</Text>
        ) : (
          <View className="mp-backpack__grid">
            {(Object.keys(CARD_META) as CardKey[]).map((key) => {
              const meta = CARD_META[key];
              const isProtection = key === "RANK_PROTECTION_CARD";
              return (
                <View key={key} className="mp-backpack__card">
                  <View className="mp-backpack__card-head">
                    <Image className="mp-backpack__card-image" src={meta.image} mode="aspectFit" />
                    <View className="mp-backpack__card-title">
                      <Text className="mp-backpack__card-name">{meta.name}</Text>
                      <Text className="mp-backpack__card-count">剩余 ×{renderCount(key)}</Text>
                    </View>
                  </View>
                  <Text className="mp-backpack__card-effect">{meta.effect}</Text>
                  {isProtection ? (
                    <View className="mp-backpack__card-action">
                      {countdown !== null ? (
                        <Text className="mp-backpack__countdown">
                          生效中 · 剩余 {countdown}
                        </Text>
                      ) : null}
                      {feedback !== null ? (
                        <Text className="mp-backpack__error">{feedback}</Text>
                      ) : null}
                      <Button
                        hoverClass="is-pressed"
                        className="mp-backpack__use"
                        disabled={busy || renderCount(key) === 0}
                        onClick={() => void useRankProtection()}
                      >
                        {busy ? "正在使用…" : "使用一张 · +2 小时"}
                      </Button>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
