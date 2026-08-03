import type { CheckinItem, CheckinMilestone } from "@huanghuang/protocol";

// Taro resolves protocol types correctly but cannot bundle runtime exports
// through the protocol package's ESM `.js` re-export paths (same reason
// pages/index/index.tsx keeps TURN_TIMEOUT_OPTIONS local). This mirrors the
// protocol's CHECKIN_MILESTONES with a local type constraint; the server
// still grants against the authoritative protocol table.
export const CHECKIN_MILESTONES = [
  { day: 1, item: "PROTECTION_CARD", amount: 1 },
  { day: 2, item: "PROTECTION_CARD", amount: 3 },
  { day: 3, item: "PROTECTION_CARD", amount: 8 },
  { day: 4, item: "WIN_DOUBLE_CARD", amount: 1 },
  { day: 5, item: "WIN_DOUBLE_CARD", amount: 2 },
  { day: 6, item: "WIN_DOUBLE_CARD", amount: 3 },
  { day: 7, item: "RANK_PROTECTION_CARD", amount: 1 },
] as const satisfies readonly CheckinMilestone[];

export const CHECKIN_ITEM_NAMES: Record<CheckinItem, string> = {
  PROTECTION_CARD: "保星卡",
  WIN_DOUBLE_CARD: "胡牌加倍卡",
  RANK_PROTECTION_CARD: "排位保护卡",
};

export const CHECKIN_ITEM_EFFECTS: Record<CheckinItem, string> = {
  PROTECTION_CARD: "排位失败扣星时自动消耗，按持有数量抵扣应扣的星星。",
  WIN_DOUBLE_CARD: "胡牌后、结算前可选择使用：本局获得的星星翻倍，一局消耗一张。",
  RANK_PROTECTION_CARD: "在背包中使用后生效 2 小时，可叠加；生效期间排位失败扣星减半（向下取整）。",
};

/**
 * 7 格签到状态：已达成的里程碑、今天可领取的下一格、以及更远的锁定格。
 * 「今天可领取」= 未签今日且累计天数 +1 恰好等于该里程碑天数。
 */
export type CheckinCellState = "ACHIEVED" | "NEXT" | "LOCKED";

export function checkinCellStates(
  signedCount: number,
  signedToday: boolean,
): readonly CheckinCellState[] {
  return CHECKIN_MILESTONES.map((milestone) => {
    if (signedCount >= milestone.day) return "ACHIEVED";
    if (!signedToday && signedCount + 1 === milestone.day) return "NEXT";
    return "LOCKED";
  });
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/**
 * 里程碑对应的北京日期（'M/D'）与星期标签。weekStart 是本周周一的
 * 'YYYY-MM-DD'，按 UTC 纯算术偏移天数，不经过本地时区。
 */
export function milestoneDateLabel(
  weekStart: string,
  day: number,
): { dateText: string; weekday: string } {
  const parsed = new Date(`${weekStart}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + (day - 1));
  const weekday = WEEKDAY_LABELS[(parsed.getUTCDay() + 6) % 7] ?? WEEKDAY_LABELS[0];
  return {
    dateText: `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`,
    weekday: `周${weekday}`,
  };
}
