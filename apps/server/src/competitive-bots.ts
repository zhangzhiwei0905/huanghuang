import type { AnonymousSession } from "./database.js";

/**
 * Experience-phase ranked bots.
 *
 * The competitive design (see `.trellis/tasks/07-28-quick-match-ranking/prd.md`)
 * only ever matches four real humans — bots are forbidden in MATCH rooms and
 * rank/achievements are four-human-only. During the invite-only experience
 * phase there are not enough concurrent real players to fill a table, so this
 * module defines ten preset bot accounts with real rank that can stand in
 * when a player opts into "allow bots". Matchmaking applies the same expanding
 * rank window used for humans and rotates equally eligible idle bots by their
 * last match time, so the roster is not pinned to the first three entries.
 *
 * Bot matches settle rank AND achievements exactly like a real match (the
 * settlement code keys off session id, and these bots own real competitive
 * profiles). The safety valve is `MATCHMAKING_BOTS_ENABLED`: it defaults to
 * `false` and must be turned on explicitly. Before opening ranked to real
 * traffic, leave it off and the queue reverts to pure four-human matching —
 * no client change required.
 */

export type RankedBot = {
  id: string;
  nickname: string;
  rankLevel: number;
  avatarUrl: string | null;
};

export const RANKED_BOTS: readonly RankedBot[] = [
  { id: "bot-dushen", nickname: "赌神", rankLevel: 17, avatarUrl: null },
  { id: "bot-duxia", nickname: "赌侠", rankLevel: 13, avatarUrl: null },
  { id: "bot-dusheng", nickname: "赌圣", rankLevel: 9, avatarUrl: null },
  { id: "bot-dalinwa", nickname: "大力娃", rankLevel: 0, avatarUrl: null },
  { id: "bot-qianliyan", nickname: "千里眼", rankLevel: 0, avatarUrl: null },
  { id: "bot-tiewa", nickname: "铁娃", rankLevel: 0, avatarUrl: null },
  { id: "bot-huowa", nickname: "火娃", rankLevel: 0, avatarUrl: null },
  { id: "bot-shuiwa", nickname: "水娃", rankLevel: 0, avatarUrl: null },
  { id: "bot-yinshenwa", nickname: "隐身娃", rankLevel: 0, avatarUrl: null },
  { id: "bot-huluwa", nickname: "葫芦娃", rankLevel: 0, avatarUrl: null },
];

export const matchmakingBotsEnabled: boolean = process.env.MATCHMAKING_BOTS_ENABLED === "true";

export const rankedBotSessionIds: ReadonlySet<string> = new Set(RANKED_BOTS.map((bot) => bot.id));

export function isRankedBotSession(sessionId: string): boolean {
  return rankedBotSessionIds.has(sessionId);
}

export function rankedBotSession(bot: RankedBot): AnonymousSession {
  return { id: bot.id, nickname: bot.nickname, wechatOpenId: null, avatarUrl: bot.avatarUrl };
}
