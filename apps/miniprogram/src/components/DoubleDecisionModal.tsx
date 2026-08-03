import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { competitiveApi } from "../api/http";
import { remainingSecondsUntilTarget } from "../lib/roomTransitions";
import "./DoubleDecisionModal.scss";

const DOUBLE_DECISION_TOTAL_SECONDS = 10;

export type DoubleDecisionModalProps = {
  deadlineAt: string;
  busy: boolean;
  onDecide: (use: boolean) => void;
};

/**
 * Winner-only timed choice shown between a winning round and its competitive
 * settlement. The server settles automatically with use=false when the
 * deadline passes, so a stuck 0s display here is harmless: the next
 * projection clears room.doubleDecision and swaps in the settlement modal.
 */
export function DoubleDecisionModal({ deadlineAt, busy, onDecide }: DoubleDecisionModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [cardsRemaining, setCardsRemaining] = useState<number | null>(null);

  // Target-timestamp driven countdown (see roomTransitions) — recovers after
  // backgrounding instead of restarting or drifting.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadlineAt]);

  // The projection only carries the deadline; fetch the remaining card count
  // for display. A failed fetch just hides the count.
  useEffect(() => {
    let disposed = false;
    competitiveApi
      .profile()
      .then((profile) => {
        if (!disposed) setCardsRemaining(profile.winDoubleCards);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const secondsRemaining = remainingSecondsUntilTarget(
    Date.parse(deadlineAt),
    now,
    DOUBLE_DECISION_TOTAL_SECONDS,
  );

  return (
    <View className="double-decision">
      <View className="double-decision__scrim" />
      <View className="double-decision__panel">
        <Text className="double-decision__eyebrow">胡牌奖励</Text>
        <Text className="double-decision__title">使用胡牌加倍卡？</Text>
        <Text className="double-decision__copy">
          使用后本局获得的星星翻倍
          {cardsRemaining !== null ? `（剩余 ${cardsRemaining} 张）` : ""}。
        </Text>
        <View className="double-decision__timer">
          <View className="double-decision__timer-bar">
            <View
              className="double-decision__timer-fill"
              style={{
                width: `${(secondsRemaining / DOUBLE_DECISION_TOTAL_SECONDS) * 100}%`,
              }}
            />
          </View>
          <Text className="double-decision__timer-text">{secondsRemaining} 秒</Text>
        </View>
        <View className="double-decision__actions">
          <Button
            className="double-decision__action double-decision__action--primary"
            hoverClass="is-pressed"
            disabled={busy}
            onClick={() => onDecide(true)}
          >
            使用加倍
          </Button>
          <Button
            className="double-decision__action"
            hoverClass="is-pressed"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            不使用
          </Button>
        </View>
        <Text className="double-decision__hint">倒计时结束将自动按不使用结算</Text>
      </View>
    </View>
  );
}
