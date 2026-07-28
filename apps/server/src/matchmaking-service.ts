import { formatRankLevel } from "@huanghuang/game-engine";
import type { MatchmakingState, SelfCompetitiveProfile } from "@huanghuang/protocol";
import type { AnonymousSession, GameDatabase, MatchmakingEntryRow } from "./database.js";
import { selectMatchmakingGroup, type MatchmakingCandidate } from "./matchmaking-algorithm.js";

export const MATCHMAKING_DISCONNECT_GRACE_MS = 10_000;
export const MATCHMAKING_HEARTBEAT_TIMEOUT_MS = 3_000;
// Experience-phase "allow bots" players wait this long before the queue is
// resolved with bots, so friends queueing near-simultaneously land in the
// same match (2 humans + 2 bots, 3 humans + 1 bot) instead of each getting a
// solo 1+3 split. After the window the earliest allowBots entry has waited,
// every currently-queued allowBots human (up to 3) is grouped and the rest of
// the table is filled with bots.
export const MATCHMAKING_BOT_FILL_WAIT_MS = 5_000;

type CompetitiveRoomCreator = (
  players: readonly { session: AnonymousSession; entry: MatchmakingEntryRow }[],
  now: number,
) => { matchId: string; roomId: string };

type CompetitiveBotRoomCreator = (
  humans: readonly { session: AnonymousSession; entry: MatchmakingEntryRow }[],
  bots: readonly AnonymousSession[],
  now: number,
) => { matchId: string; roomId: string };

export type MatchmakingBotOptions = {
  enabled: boolean;
  bots: readonly AnonymousSession[];
  createRoom: CompetitiveBotRoomCreator;
};

export type MatchmakingTickResult = {
  changedSessionIds: string[];
  matches: { matchId: string; roomId: string; sessionIds: string[] }[];
};

export class MatchmakingService {
  private ticking = false;
  private readonly heartbeatAtBySessionId = new Map<string, number>();
  // Experience-phase per-session "allow bots" preference. Acted on inside
  // tick() the moment bots are free, so it never needs to survive a restart —
  // a cold start simply drops pending preferences and the player re-queues.
  private readonly allowBotsBySessionId = new Map<string, boolean>();

  constructor(
    private readonly database: GameDatabase,
    private readonly isSessionOnline: (sessionId: string) => boolean,
    private readonly createCompetitiveRoom: CompetitiveRoomCreator,
    startupAt = Date.now(),
    private readonly botOptions: MatchmakingBotOptions = {
      enabled: false,
      bots: [],
      createRoom: () => {
        throw new Error("Bot matchmaking is not configured");
      },
    },
  ) {
    this.database.markAllMatchmakingEntriesDisconnected(new Date(startupAt).toISOString());
  }

  getProfile(session: AnonymousSession): SelfCompetitiveProfile {
    this.assertWechatLinked(session);
    const profile = this.database.ensureCompetitiveProfile(session.id);
    return {
      rankLevel: profile.rankLevel,
      protectionCards: profile.protectionCards,
      rankDisplay: formatRankLevel(profile.rankLevel),
      achievements: {
        exposedKong: profile.exposedKongCount,
        indicatorPongKong: profile.indicatorPongKongCount,
        addedKong: profile.addedKongCount,
        concealedKong: profile.concealedKongCount,
      },
    };
  }

  getState(sessionId: string): MatchmakingState {
    const currentMatch = this.database.getCurrentCompetitiveMatch(sessionId);
    if (currentMatch !== null) {
      return {
        status: "MATCHED",
        matchId: currentMatch.match.id,
        roomId: currentMatch.match.roomId,
      };
    }
    const entry = this.database.getMatchmakingEntry(sessionId);
    return entry === null
      ? { status: "IDLE" }
      : {
          status: "QUEUED",
          enqueuedAt: entry.enqueuedAt,
          disconnectedAt: entry.disconnectedAt,
          rankLevelSnapshot: entry.rankLevelSnapshot,
        };
  }

  heartbeat(sessionId: string, now = Date.now()): MatchmakingState {
    this.heartbeatAtBySessionId.set(sessionId, now);
    this.database.markMatchmakingEntryConnected(sessionId);
    return this.getState(sessionId);
  }

  enqueue(session: AnonymousSession, now = Date.now(), allowBots = false): MatchmakingState {
    this.assertWechatLinked(session);
    this.heartbeatAtBySessionId.set(session.id, now);
    const current = this.database.getCurrentCompetitiveMatch(session.id);
    if (current !== null) return this.getState(session.id);
    const profile = this.database.ensureCompetitiveProfile(session.id);
    this.database.upsertMatchmakingEntry({
      sessionId: session.id,
      rankLevelSnapshot: profile.rankLevel,
      enqueuedAt: new Date(now).toISOString(),
    });
    this.allowBotsBySessionId.set(session.id, allowBots && this.botOptions.enabled);
    return this.getState(session.id);
  }

  continueMatchmaking(
    session: AnonymousSession,
    previousMatchId: string,
    now = Date.now(),
    allowBots = false,
  ): MatchmakingState {
    this.assertWechatLinked(session);
    this.heartbeatAtBySessionId.set(session.id, now);
    this.database.acknowledgeAndEnqueueCompetitiveMatch(
      previousMatchId,
      session.id,
      new Date(now).toISOString(),
    );
    this.allowBotsBySessionId.set(session.id, allowBots && this.botOptions.enabled);
    return this.getState(session.id);
  }

  acknowledgeResult(sessionId: string, matchId: string, now = Date.now()): MatchmakingState {
    const player = this.database.acknowledgeCompetitiveMatchResult(
      matchId,
      sessionId,
      new Date(now).toISOString(),
    );
    if (player === null) throw new Error("MATCH_RESULT_NOT_AVAILABLE");
    return this.getState(sessionId);
  }

  cancel(sessionId: string): MatchmakingState {
    if (this.database.getCurrentCompetitiveMatch(sessionId) !== null) {
      return this.getState(sessionId);
    }
    this.database.cancelMatchmakingEntry(sessionId);
    this.allowBotsBySessionId.delete(sessionId);
    return { status: "IDLE" };
  }

  setConnected(sessionId: string, connected: boolean, now = Date.now()): MatchmakingState {
    if (connected) {
      this.heartbeatAtBySessionId.set(sessionId, now);
      this.database.markMatchmakingEntryConnected(sessionId);
    } else {
      this.heartbeatAtBySessionId.delete(sessionId);
      this.database.markMatchmakingEntryDisconnected(sessionId, new Date(now).toISOString());
    }
    return this.getState(sessionId);
  }

  tick(now = Date.now()): MatchmakingTickResult {
    if (this.ticking) return { changedSessionIds: [], matches: [] };
    this.ticking = true;
    try {
      const changedSessionIds: string[] = [];
      for (const entry of this.database.listMatchmakingEntries()) {
        if (entry.disconnectedAt === null && !this.isOnline(entry.sessionId, now)) {
          this.database.markMatchmakingEntryDisconnected(
            entry.sessionId,
            new Date(now).toISOString(),
          );
          changedSessionIds.push(entry.sessionId);
        } else if (entry.disconnectedAt !== null && this.isOnline(entry.sessionId, now)) {
          this.database.markMatchmakingEntryConnected(entry.sessionId);
          changedSessionIds.push(entry.sessionId);
        }
      }
      changedSessionIds.push(
        ...this.database.expireDisconnectedMatchmakingEntries(
          new Date(now - MATCHMAKING_DISCONNECT_GRACE_MS).toISOString(),
        ),
      );
      const matches: MatchmakingTickResult["matches"] = [];

      // Experience-phase bot matching: allowBots players wait a short window
      // so friends can land in the same match, then the table is filled with
      // bots. Only one bot match can run at a time because the bots are
      // shared, so the active-match guard on the bots is what serializes it.
      if (this.botOptions.enabled && this.botOptions.bots.length === 3) {
        const botEntries = this.database
          .listMatchmakingEntries()
          .filter(
            (entry) =>
              entry.disconnectedAt === null &&
              this.isOnline(entry.sessionId, now) &&
              this.allowBotsBySessionId.get(entry.sessionId) === true,
          )
          .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
        const earliest = botEntries[0];
        if (
          earliest !== undefined &&
          now - Date.parse(earliest.enqueuedAt) >= MATCHMAKING_BOT_FILL_WAIT_MS
        ) {
          const sessionsById = new Map(
            this.database
              .findSessionsByIds(botEntries.map((entry) => entry.sessionId))
              .map((session) => [session.id, session] as const),
          );
          // Drop (and cancel) any allowBots entry whose session vanished or
          // lost its wechat link, so it can't keep the group waiting forever.
          const isValid = (entry: MatchmakingEntryRow): boolean => {
            const session = sessionsById.get(entry.sessionId);
            return session?.wechatOpenId != null;
          };
          const validEntries = botEntries.filter(isValid);
          for (const entry of botEntries) {
            if (!isValid(entry)) {
              this.database.cancelMatchmakingEntry(entry.sessionId);
              this.allowBotsBySessionId.delete(entry.sessionId);
              changedSessionIds.push(entry.sessionId);
            }
          }
          if (
            validEntries.length > 0 &&
            !this.botOptions.bots.some((bot) => this.database.hasActiveCompetitiveMatch(bot.id))
          ) {
            const humanCount = Math.min(validEntries.length, 3);
            const humans = validEntries.slice(0, humanCount).flatMap((entry) => {
              const session = sessionsById.get(entry.sessionId);
              return session !== undefined ? [{ session, entry }] : [];
            });
            if (humans.length === humanCount) {
              const chosenBots = this.botOptions.bots.slice(0, 4 - humanCount);
              try {
                const match = this.botOptions.createRoom(humans, chosenBots, now);
                const sessionIds = humans.map((human) => human.session.id);
                matches.push({ ...match, sessionIds });
                changedSessionIds.push(...sessionIds);
                for (const sessionId of sessionIds) this.allowBotsBySessionId.delete(sessionId);
              } catch (cause) {
                // Lost a race for the bots (another match booked them between
                // the guard check and the transaction). Retry next tick
                // instead of crashing the scheduler.
                if (
                  !(cause instanceof Error &&
                    cause.message.includes("already has an active competitive match"))
                ) {
                  throw cause;
                }
              }
            }
          }
        }
      }

      for (;;) {
        const entries = this.database
          .listMatchmakingEntries()
          .filter((entry) => entry.disconnectedAt === null && this.isOnline(entry.sessionId, now));
        const bySessionId = new Map(entries.map((entry) => [entry.sessionId, entry]));
        const candidates: MatchmakingCandidate[] = entries.map((entry) => ({
          sessionId: entry.sessionId,
          rankLevel: entry.rankLevelSnapshot,
          enqueuedAt: entry.enqueuedAt,
          recentOpponentSessionIds: this.database.getRecentCompetitiveOpponentIds(entry.sessionId),
        }));
        const group = selectMatchmakingGroup(candidates, now);
        if (group === null) break;

        const sessionIds = group.map((candidate) => candidate.sessionId);
        const sessionsById = new Map(
          this.database.findSessionsByIds(sessionIds).map((session) => [session.id, session]),
        );
        const players = sessionIds.flatMap((sessionId) => {
          const session = sessionsById.get(sessionId);
          const entry = bySessionId.get(sessionId);
          return session?.wechatOpenId == null || entry === undefined ? [] : [{ session, entry }];
        });
        if (players.length !== 4) {
          for (const sessionId of sessionIds) {
            if (sessionsById.get(sessionId)?.wechatOpenId == null) {
              this.database.cancelMatchmakingEntry(sessionId);
              changedSessionIds.push(sessionId);
            }
          }
          break;
        }

        try {
          const match = this.createCompetitiveRoom(players, now);
          matches.push({ ...match, sessionIds });
          changedSessionIds.push(...sessionIds);
          for (const sessionId of sessionIds) this.allowBotsBySessionId.delete(sessionId);
        } catch (cause) {
          // Queue-version and online checks inside the creation transaction are
          // authoritative. A conflict leaves every queue row unchanged so the
          // next scheduler pass can evaluate a fresh snapshot. Infrastructure
          // and invariant failures must still reach the process error boundary.
          if (
            cause instanceof Error &&
            cause.message.includes("expected four current online queue entries")
          ) {
            break;
          }
          throw cause;
        }
      }

      return { changedSessionIds: [...new Set(changedSessionIds)], matches };
    } finally {
      this.ticking = false;
    }
  }

  private isOnline(sessionId: string, now: number): boolean {
    const heartbeatAt = this.heartbeatAtBySessionId.get(sessionId);
    return (
      this.isSessionOnline(sessionId) ||
      (heartbeatAt !== undefined && now - heartbeatAt <= MATCHMAKING_HEARTBEAT_TIMEOUT_MS)
    );
  }

  private assertWechatLinked(session: AnonymousSession): void {
    if (session.wechatOpenId == null) throw new Error("WECHAT_LINK_REQUIRED");
  }
}
