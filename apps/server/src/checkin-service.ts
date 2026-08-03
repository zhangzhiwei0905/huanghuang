import type {
  CheckinItem,
  CheckinMilestone,
  CheckinSignResult,
  CheckinStatusProjection,
  RankProtectionUseResult,
} from "@huanghuang/protocol";
import { CHECKIN_MILESTONES } from "@huanghuang/protocol";
import type { AnonymousSession, GameDatabase } from "./database.js";

/** 排位保护卡每张延长的生效时长。 */
export const RANK_PROTECTION_DURATION_MS = 2 * 60 * 60_000;

const BEIJING_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * 北京时间（UTC+8）当天日期，'YYYY-MM-DD'。纯函数，便于跨周一边界单测。
 */
export function beijingDate(now: Date): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 北京时间本周周一日期，'YYYY-MM-DD'。签到周从周一 00:00（北京时间）起算。
 */
export function beijingWeekStart(now: Date): string {
  const shifted = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const dayOfWeek = shifted.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return new Date(shifted.getTime() - daysFromMonday * DAY_MS).toISOString().slice(0, 10);
}

function itemDeltas(item: CheckinItem, amount: number): {
  protectionCards?: number;
  winDoubleCards?: number;
  rankProtectionCards?: number;
} {
  switch (item) {
    case "PROTECTION_CARD":
      return { protectionCards: amount };
    case "WIN_DOUBLE_CARD":
      return { winDoubleCards: amount };
    case "RANK_PROTECTION_CARD":
      return { rankProtectionCards: amount };
  }
}

export class CheckInService {
  constructor(private readonly database: GameDatabase) {}

  getStatus(session: AnonymousSession, now = new Date()): CheckinStatusProjection {
    this.assertWechatLinked(session);
    const weekStart = beijingWeekStart(now);
    const today = beijingDate(now);
    const record = this.database.getCheckInRecord(session.id, weekStart);
    const signedDates = [...(record?.signedDates ?? [])].sort();
    return {
      weekStart,
      today,
      signedDates,
      signedCount: signedDates.length,
      signedToday: signedDates.includes(today),
    };
  }

  /**
   * 点击签到（幂等）：追加今日北京日期后按累计天数发放当天里程碑奖励。
   * 今日已签时原样返回当前状态，不重复发放。
   */
  sign(session: AnonymousSession, now = new Date()): CheckinSignResult {
    this.assertWechatLinked(session);
    const weekStart = beijingWeekStart(now);
    const today = beijingDate(now);
    return this.database.connection.transaction((): CheckinSignResult => {
      this.database.ensureCompetitiveProfile(session.id);
      const record = this.database.getCheckInRecord(session.id, weekStart);
      const previousDates = [...(record?.signedDates ?? [])].sort();
      if (previousDates.includes(today)) {
        return {
          status: {
            weekStart,
            today,
            signedDates: previousDates,
            signedCount: previousDates.length,
            signedToday: true,
          },
          granted: [],
        };
      }
      const signedDates = [...previousDates, today].sort();
      const milestone = CHECKIN_MILESTONES.find(
        (candidate) => candidate.day === signedDates.length,
      );
      const granted: CheckinMilestone[] = [];
      if (milestone !== undefined) {
        this.database.addProfileItems(session.id, itemDeltas(milestone.item, milestone.amount));
        granted.push(milestone);
      }
      this.database.upsertCheckInRecord({
        sessionId: session.id,
        weekStart,
        signedDates,
        updatedAt: now.toISOString(),
      });
      return {
        status: {
          weekStart,
          today,
          signedDates,
          signedCount: signedDates.length,
          signedToday: true,
        },
        granted,
      };
    })();
  }

  /**
   * 使用一张排位保护卡：生效期 = max(当前时间, 现生效截止) + 2 小时，
   * 可叠加。无卡时抛 NO_RANK_PROTECTION_CARD。
   */
  useRankProtection(session: AnonymousSession, now = new Date()): RankProtectionUseResult {
    this.assertWechatLinked(session);
    const profile = this.database.ensureCompetitiveProfile(session.id);
    if (profile.rankProtectionCards < 1) throw new Error("NO_RANK_PROTECTION_CARD");
    const existingUntilMs =
      profile.rankProtectionActiveUntil === null
        ? 0
        : Date.parse(profile.rankProtectionActiveUntil);
    const base = Math.max(now.getTime(), existingUntilMs);
    const activeUntil = new Date(base + RANK_PROTECTION_DURATION_MS).toISOString();
    const updated = this.database.consumeRankProtectionCard(session.id, activeUntil);
    if (updated === null) throw new Error("NO_RANK_PROTECTION_CARD");
    return {
      rankProtectionCards: updated.rankProtectionCards,
      rankProtectionActiveUntil: activeUntil,
    };
  }

  private assertWechatLinked(session: AnonymousSession): void {
    if (session.wechatOpenId == null) throw new Error("WECHAT_LINK_REQUIRED");
  }
}
