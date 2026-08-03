import { afterEach, describe, expect, it } from "vitest";
import { CheckInService, RANK_PROTECTION_DURATION_MS, beijingDate, beijingWeekStart } from "./checkin-service.js";
import { GameDatabase, type AnonymousSession } from "./database.js";

const HOUR_MS = 60 * 60_000;

describe("beijing time helpers", () => {
  it("treats Beijing Monday 00:00 as the start of the new week", () => {
    // 北京时间 2026-08-03 00:00 = 2026-08-02T16:00Z（周日 UTC）。
    const mondayMidnight = new Date("2026-08-02T16:00:00.000Z");
    expect(beijingDate(mondayMidnight)).toBe("2026-08-03");
    expect(beijingWeekStart(mondayMidnight)).toBe("2026-08-03");
  });

  it("keeps Beijing Sunday 23:59 in the same week", () => {
    // 北京时间 2026-08-09 23:59:59 = 2026-08-09T15:59:59Z。
    const sundayLate = new Date("2026-08-09T15:59:59.000Z");
    expect(beijingDate(sundayLate)).toBe("2026-08-09");
    expect(beijingWeekStart(sundayLate)).toBe("2026-08-03");

    // 一秒后跨过周界：北京时间下周一 00:00。
    const nextMonday = new Date(sundayLate.getTime() + 1_000);
    expect(beijingDate(nextMonday)).toBe("2026-08-10");
    expect(beijingWeekStart(nextMonday)).toBe("2026-08-10");
  });
});

describe("CheckInService", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  function setup() {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    database.createSession(
      {
        id: "player-0",
        nickname: "玩家0",
        wechatOpenId: "openid-player-0",
        avatarUrl: "/avatars/player-0.png",
      },
      "token-player-0",
    );
    const session = database.findSessionByTokenHash("token-player-0");
    if (session === null) throw new Error("Expected the seeded session");
    return { database, session, service: new CheckInService(database) };
  }

  const mondayMorning = new Date("2026-08-03T02:00:00.000Z"); // 北京时间周一 10:00

  it("requires a WeChat-linked session", () => {
    const { service } = setup();
    const unlinked: AnonymousSession = { id: "ghost", nickname: "幽灵" };
    expect(() => service.getStatus(unlinked, mondayMorning)).toThrow("WECHAT_LINK_REQUIRED");
    expect(() => service.sign(unlinked, mondayMorning)).toThrow("WECHAT_LINK_REQUIRED");
    expect(() => service.useRankProtection(unlinked, mondayMorning)).toThrow(
      "WECHAT_LINK_REQUIRED",
    );
  });

  it("grants each day's milestone exactly once and is idempotent per day", () => {
    const { database, session, service } = setup();

    const first = service.sign(session, mondayMorning);
    expect(first.status).toMatchObject({
      weekStart: "2026-08-03",
      today: "2026-08-03",
      signedCount: 1,
      signedToday: true,
    });
    expect(first.granted).toEqual([{ day: 1, item: "PROTECTION_CARD", amount: 1 }]);
    expect(database.getCompetitiveProfile("player-0")?.protectionCards).toBe(1);

    // 同日重复签到：状态原样返回，不重复发奖。
    const again = service.sign(session, new Date(mondayMorning.getTime() + HOUR_MS));
    expect(again.granted).toEqual([]);
    expect(again.status.signedCount).toBe(1);
    expect(database.getCompetitiveProfile("player-0")?.protectionCards).toBe(1);

    // 周二签到：第 2 天里程碑 ×3 保星卡。
    const tuesday = service.sign(session, new Date("2026-08-04T01:00:00.000Z"));
    expect(tuesday.granted).toEqual([{ day: 2, item: "PROTECTION_CARD", amount: 3 }]);
    expect(database.getCompetitiveProfile("player-0")?.protectionCards).toBe(4);

    // 第 4 天发放胡牌加倍卡。
    service.sign(session, new Date("2026-08-05T01:00:00.000Z"));
    const dayFour = service.sign(session, new Date("2026-08-06T01:00:00.000Z"));
    expect(dayFour.granted).toEqual([{ day: 4, item: "WIN_DOUBLE_CARD", amount: 1 }]);
    expect(database.getCompetitiveProfile("player-0")?.winDoubleCards).toBe(1);

    // 第 7 天发放排位保护卡。
    service.sign(session, new Date("2026-08-07T01:00:00.000Z"));
    service.sign(session, new Date("2026-08-08T01:00:00.000Z"));
    const daySeven = service.sign(session, new Date("2026-08-09T01:00:00.000Z"));
    expect(daySeven.granted).toEqual([{ day: 7, item: "RANK_PROTECTION_CARD", amount: 1 }]);
    expect(database.getCompetitiveProfile("player-0")?.rankProtectionCards).toBe(1);
    expect(daySeven.status.signedCount).toBe(7);
  });

  it("resets the signing week on the next Beijing Monday", () => {
    const { database, session, service } = setup();

    service.sign(session, mondayMorning);
    service.sign(session, new Date("2026-08-04T01:00:00.000Z"));
    expect(service.getStatus(session, new Date("2026-08-05T01:00:00.000Z")).signedCount).toBe(2);

    // 下周一（北京时间 2026-08-10）：新的一周从第 1 天重新计。
    const nextWeek = new Date("2026-08-10T03:00:00.000Z");
    const status = service.getStatus(session, nextWeek);
    expect(status).toMatchObject({
      weekStart: "2026-08-10",
      today: "2026-08-10",
      signedCount: 0,
      signedToday: false,
    });
    const signed = service.sign(session, nextWeek);
    expect(signed.granted).toEqual([{ day: 1, item: "PROTECTION_CARD", amount: 1 }]);
    expect(database.getCompetitiveProfile("player-0")?.protectionCards).toBe(5); // 1+3+1
  });

  it("stacks rank protection durations from the later of now and the current expiry", () => {
    const { database, session, service } = setup();
    database.ensureCompetitiveProfile("player-0");
    database.addProfileItems("player-0", { rankProtectionCards: 3 });

    expect(() => service.useRankProtection({ ...session, id: "missing" }, mondayMorning)).toThrow();

    // 第一张：从现在起 2 小时。
    const first = service.useRankProtection(session, mondayMorning);
    expect(first.rankProtectionCards).toBe(2);
    expect(first.rankProtectionActiveUntil).toBe(
      new Date(mondayMorning.getTime() + RANK_PROTECTION_DURATION_MS).toISOString(),
    );

    // 生效期内第二张：从现截止时间再延 2 小时（共 4 小时）。
    const second = service.useRankProtection(
      session,
      new Date(mondayMorning.getTime() + 1 * HOUR_MS),
    );
    expect(second.rankProtectionCards).toBe(1);
    expect(second.rankProtectionActiveUntil).toBe(
      new Date(mondayMorning.getTime() + 2 * RANK_PROTECTION_DURATION_MS).toISOString(),
    );

    // 过期后再用：从当前时间重新起算，而不是接续旧截止。
    const third = service.useRankProtection(
      session,
      new Date(mondayMorning.getTime() + 5 * HOUR_MS),
    );
    expect(third.rankProtectionCards).toBe(0);
    expect(third.rankProtectionActiveUntil).toBe(
      new Date(mondayMorning.getTime() + 5 * HOUR_MS + RANK_PROTECTION_DURATION_MS).toISOString(),
    );

    expect(() => service.useRankProtection(session, mondayMorning)).toThrow(
      "NO_RANK_PROTECTION_CARD",
    );
  });
});
