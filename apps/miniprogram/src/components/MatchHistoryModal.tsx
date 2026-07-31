import { useEffect, useState } from "react";
import { Button, ScrollView, Text, View } from "@tarojs/components";
import type { CompetitiveMatchHistoryEntry } from "@huanghuang/protocol";
import { ApiError, competitiveApi } from "../api/http";
import { errorLabel } from "../lib/errors";
import "./MatchHistoryModal.scss";

export type MatchHistoryModalProps = {
  onClose: () => void;
};

const OUTCOME_LABEL: Record<CompetitiveMatchHistoryEntry["outcome"], string> = {
  WIN: "胜",
  LOSS: "负",
  DRAW: "流局",
};

function formatSettledAt(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRankDelta(entry: CompetitiveMatchHistoryEntry): string {
  const sign = entry.finalRankDelta > 0 ? "+" : "";
  const crossedSuffix =
    entry.crossedMajor === "UP" ? "（升段）" : entry.crossedMajor === "DOWN" ? "（掉段）" : "";
  return `${sign}${entry.finalRankDelta} 级${crossedSuffix}`;
}

function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return errorLabel(cause.code);
  return "历史战绩加载失败，请再试一次";
}

/**
 * Self-only ranked match history, opened from the home page's own
 * PlayerProfileModal. Draws exclusively on settled MATCH-mode rows, so
 * friend-room/bot games never appear here.
 */
export function MatchHistoryModal({ onClose }: MatchHistoryModalProps) {
  const [entries, setEntries] = useState<CompetitiveMatchHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    competitiveApi
      .matchHistory()
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    competitiveApi
      .matchHistory(nextCursor)
      .then((page) => {
        setEntries((previous) => [...previous, ...page.entries]);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => setError(describeError(cause)))
      .finally(() => setLoadingMore(false));
  };

  return (
    <View className="history-backdrop" onClick={onClose}>
      <View className="history-modal" catchMove onClick={(e) => e.stopPropagation()}>
        <View className="modal-close" hoverClass="is-pressed" onClick={onClose} ariaLabel="关闭">
          <Text className="modal-close-icon">×</Text>
        </View>
        <Text className="history-modal__title">历史战绩</Text>
        <ScrollView className="history-modal__scroll" scrollY enhanced showScrollbar={false}>
          {loading ? (
            <Text className="history-modal__empty">加载中…</Text>
          ) : error !== null && entries.length === 0 ? (
            <Text className="history-modal__empty">{error}</Text>
          ) : entries.length === 0 ? (
            <Text className="history-modal__empty">暂无历史战绩</Text>
          ) : (
            <View className="history-modal__list">
              {entries.map((entry) => (
                <View key={entry.matchId} className={`history-row history-row--${entry.outcome}`}>
                  <View className="history-row__outcome">
                    <Text className="history-row__outcome-label">
                      {OUTCOME_LABEL[entry.outcome]}
                    </Text>
                    <Text className="history-row__time">{formatSettledAt(entry.settledAt)}</Text>
                  </View>
                  <Text className="history-row__multiplier">
                    {entry.multiplier !== null ? `${entry.multiplier}×` : "—"}
                  </Text>
                  <Text className="history-row__delta">{formatRankDelta(entry)}</Text>
                </View>
              ))}
            </View>
          )}
          {error !== null && entries.length > 0 ? (
            <Text className="history-modal__error">{error}</Text>
          ) : null}
          {nextCursor !== null ? (
            <Button
              className="modal-action modal-action--ghost history-modal__more"
              hoverClass="is-pressed"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? "正在加载…" : "加载更多"}
            </Button>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
