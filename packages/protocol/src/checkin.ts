import { z } from "zod";

/** 道具体系三类道具。 */
export const checkinItemSchema = z.enum([
  "PROTECTION_CARD",
  "WIN_DOUBLE_CARD",
  "RANK_PROTECTION_CARD",
]);
export type CheckinItem = z.infer<typeof checkinItemSchema>;

export const checkinMilestoneSchema = z.object({
  /** 本周累计签到天数（1–7）。 */
  day: z.number().int().min(1).max(7),
  item: checkinItemSchema,
  amount: z.number().int().positive(),
});
export type CheckinMilestone = z.infer<typeof checkinMilestoneSchema>;

/**
 * 每周签到里程碑奖励表：周一重新计算，累计签到到第 N 天发放对应奖励。
 * 服务端发放与客户端渲染共用这一份定义。
 */
export const CHECKIN_MILESTONES: readonly CheckinMilestone[] = [
  { day: 1, item: "PROTECTION_CARD", amount: 1 },
  { day: 2, item: "PROTECTION_CARD", amount: 3 },
  { day: 3, item: "PROTECTION_CARD", amount: 8 },
  { day: 4, item: "WIN_DOUBLE_CARD", amount: 1 },
  { day: 5, item: "WIN_DOUBLE_CARD", amount: 2 },
  { day: 6, item: "WIN_DOUBLE_CARD", amount: 3 },
  { day: 7, item: "RANK_PROTECTION_CARD", amount: 1 },
] as const;

/** 北京日期字符串 'YYYY-MM-DD'。 */
export const beijingDateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const checkinStatusProjectionSchema = z.object({
  /** 本周周一的北京日期。 */
  weekStart: beijingDateStringSchema,
  /** 今天的北京日期。 */
  today: beijingDateStringSchema,
  /** 本周已签到的北京日期列表（升序）。 */
  signedDates: z.array(beijingDateStringSchema),
  /** 本周累计签到天数。 */
  signedCount: z.number().int().min(0).max(7),
  /** 今日是否已签到。 */
  signedToday: z.boolean(),
});
export type CheckinStatusProjection = z.infer<typeof checkinStatusProjectionSchema>;

export const checkinSignResultSchema = z.object({
  status: checkinStatusProjectionSchema,
  /** 本次签到新发放的里程碑奖励；今日重复签到时为空数组。 */
  granted: z.array(checkinMilestoneSchema),
});
export type CheckinSignResult = z.infer<typeof checkinSignResultSchema>;

/** 排位保护卡使用结果：生效截止时间。 */
export const rankProtectionUseResultSchema = z.object({
  rankProtectionCards: z.number().int().nonnegative(),
  rankProtectionActiveUntil: z.iso.datetime({ offset: true }),
});
export type RankProtectionUseResult = z.infer<typeof rankProtectionUseResultSchema>;
