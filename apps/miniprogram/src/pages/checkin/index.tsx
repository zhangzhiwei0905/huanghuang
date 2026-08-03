import { useCallback, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import type { CheckinItem, CheckinMilestone, CheckinStatusProjection } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ApiError, checkinApi } from "../../api/http";
import { API_BASE } from "../../config";
import {
  CHECKIN_ITEM_EFFECTS,
  CHECKIN_ITEM_NAMES,
  CHECKIN_MILESTONES,
  checkinCellStates,
  milestoneDateLabel,
} from "../../lib/checkinRewards";
import "./index.scss";

// 道具卡图片由服务端静态托管（/cards/）：小程序主包 2MB 限制下不再
// 打进包内；域名与 API 一致，复用已有下载白名单。
const ITEM_IMAGES: Record<CheckinItem, string> = {
  PROTECTION_CARD: `${API_BASE}/cards/protection-card.png`,
  WIN_DOUBLE_CARD: `${API_BASE}/cards/win-double-card.png`,
  RANK_PROTECTION_CARD: `${API_BASE}/cards/rank-protection-card.png`,
};

// The shared errorLabel map phrases WECHAT_LINK_REQUIRED for 排位; check-in
// needs its own wording so the guidance fits this page.
function checkinErrorLabel(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "WECHAT_LINK_REQUIRED") {
    return "签到需要先完成微信登录";
  }
  return "操作没有成功，请再试一次";
}

export default function CheckinPage() {
  const [status, setStatus] = useState<CheckinStatusProjection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reward, setReward] = useState<CheckinMilestone | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await checkinApi.status());
    } catch (cause) {
      setLoadError(checkinErrorLabel(cause));
    }
  }, []);

  useDidShow(() => {
    void refresh();
  });

  async function sign() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await checkinApi.sign();
      setStatus(result.status);
      // 单次签到累计天数只 +1，最多命中一个里程碑。
      const granted = result.granted[0];
      if (granted !== undefined) setReward(granted);
    } catch (cause) {
      setFeedback(checkinErrorLabel(cause));
    } finally {
      setBusy(false);
    }
  }

  const cellStates =
    status === null ? null : checkinCellStates(status.signedCount, status.signedToday);

  return (
    <View className="mp-checkin">
      <Image className="mp-checkin__bg" src={tableBackground} mode="aspectFill" />
      <View className="mp-checkin__overlay" />
      <View className="mp-checkin__panel">
        <View className="mp-checkin__header">
          <Text className="mp-checkin__title">每周签到</Text>
          {status !== null ? (
            <Text className="mp-checkin__week">
              本周已签 {status.signedCount} 天 · 周一重新计算
            </Text>
          ) : null}
        </View>
        {loadError !== null ? (
          <View className="mp-checkin__empty">
            <Text className="mp-checkin__empty-text">{loadError}</Text>
            <Button
              hoverClass="is-pressed"
              className="mp-checkin__reload"
              onClick={() => void refresh()}
            >
              重新加载
            </Button>
          </View>
        ) : status === null || cellStates === null ? (
          <Text className="mp-checkin__empty-text">正在加载…</Text>
        ) : (
          <View className="mp-checkin__grid">
            {CHECKIN_MILESTONES.map((milestone, index) => {
              const cellState = cellStates[index] ?? "LOCKED";
              const label = milestoneDateLabel(status.weekStart, milestone.day);
              return (
                <View
                  key={milestone.day}
                  className={`mp-checkin__cell is-${cellState.toLowerCase()}`}
                >
                  <Text className="mp-checkin__cell-weekday">{label.weekday}</Text>
                  <Text className="mp-checkin__cell-date">{label.dateText}</Text>
                  <Image
                    className="mp-checkin__cell-image"
                    src={ITEM_IMAGES[milestone.item]}
                    mode="aspectFit"
                  />
                  <Text className="mp-checkin__cell-name">
                    {CHECKIN_ITEM_NAMES[milestone.item]}
                  </Text>
                  <Text className="mp-checkin__cell-amount">×{milestone.amount}</Text>
                  {cellState === "ACHIEVED" ? (
                    <Text className="mp-checkin__cell-check">✓</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
        <View className="mp-checkin__footer">
          {feedback !== null ? <Text className="mp-checkin__error">{feedback}</Text> : null}
          <Button
            hoverClass="is-pressed"
            className="mp-checkin__sign"
            disabled={busy || status === null || status.signedToday}
            onClick={() => void sign()}
          >
            {busy
              ? "正在签到…"
              : status === null
                ? "加载中…"
                : status.signedToday
                  ? "今日已签到"
                  : "签到"}
          </Button>
        </View>
      </View>
      {reward !== null ? (
        <View className="mp-checkin-reward">
          <View className="mp-checkin-reward__scrim" />
          <View className="mp-checkin-reward__panel">
            <Text className="mp-checkin-reward__eyebrow">签到成功</Text>
            <Text className="mp-checkin-reward__title">
              获得 {CHECKIN_ITEM_NAMES[reward.item]} ×{reward.amount}
            </Text>
            <Image
              className="mp-checkin-reward__image"
              src={ITEM_IMAGES[reward.item]}
              mode="aspectFit"
            />
            <Text className="mp-checkin-reward__effect">{CHECKIN_ITEM_EFFECTS[reward.item]}</Text>
            <Button
              hoverClass="is-pressed"
              className="mp-checkin-reward__confirm"
              onClick={() => setReward(null)}
            >
              收下
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
