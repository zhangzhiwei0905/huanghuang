import { formatRankLevel, majorIndexForRankLevel } from "@huanghuang/game-engine";
import type {
  CompetitiveMatchHistoryPage,
  CompetitiveMultiplier,
  MatchmakingState,
  SelfCompetitiveProfile,
} from "@huanghuang/protocol";
import {
  CompetitiveMatchCreationConflictError,
  type AnonymousSession,
  type GameDatabase,
  type MatchmakingEntryRow,
} from "./database.js";
import {
  selectBotFillGroup,
  selectMatchmakingGroup,
  type MatchmakingCandidate,
} from "./matchmaking-algorithm.js";

export const MATCH_HISTORY_PAGE_SIZE = 20;

export const MATCHMAKING_DISCONNECT_GRACE_MS = 10_000;
// Client polls status roughly every 1s over HTTP; 8s tolerates a few missed
// beats from normal network jitter/backgrounding before treating a session
// as offline for scheduling purposes.
export const MATCHMAKING_HEARTBEAT_TIMEOUT_MS = 8_000;
// Experience-phase "allow bots" parties wait this long before bot fill. The
// selector then aggregates complete compatible parties up to three humans and
// fills only the remaining seats, preserving party identity and giving any
// already-available four-human group priority.
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
  // Experience-phase per-session "allow bots" preference. Persisted on the
  // matchmaking_entries row (allow_bots column) so it survives a restart;
  // this map is a request-scoped write-through cache in front of that column
  // so tick() doesn't need a DB round trip per entry on every pass. A cold
  // start simply has an empty cache, which self-heals the first time each
  // entry is seen in listMatchmakingEntries() (see allowBotsFor()).
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
      winDoubleCards: profile.winDoubleCards,
      rankProtectionCards: profile.rankProtectionCards,
      rankProtectionActiveUntil: profile.rankProtectionActiveUntil,
      rankDisplay: formatRankLevel(profile.rankLevel),
      achievements: {
        exposedKong: profile.exposedKongCount,
        indicatorPongKong: profile.indicatorPongKongCount,
        addedKong: profile.addedKongCount,
        concealedKong: profile.concealedKongCount,
        releaseWildcard: profile.releaseWildcardCount,
        hardLaiyou: profile.hardLaiyouCount,
        softLaiyou: profile.softLaiyouCount,
      },
    };
  }

  getMatchHistory(session: AnonymousSession, beforeMatchId?: string): CompetitiveMatchHistoryPage {
    this.assertWechatLinked(session);
    const entries = this.database.listCompetitiveMatchHistory(session.id, {
      limit: MATCH_HISTORY_PAGE_SIZE,
      ...(beforeMatchId === undefined ? {} : { beforeMatchId }),
    });
    return {
      entries: entries.map((entry) => {
        const beforeMajor = majorIndexForRankLevel(entry.preRankLevel);
        const afterMajor = majorIndexForRankLevel(entry.postRankLevel);
        return {
          matchId: entry.matchId,
          settledAt: entry.settledAt,
          outcome: entry.outcome,
          multiplier: entry.multiplier as CompetitiveMultiplier | null,
          finalRankDelta: entry.finalRankDelta,
          crossedMajor:
            afterMajor === beforeMajor ? null : afterMajor > beforeMajor ? "UP" : "DOWN",
        };
      }),
      nextCursor:
        entries.length < MATCH_HISTORY_PAGE_SIZE
          ? null
          : (entries[entries.length - 1]?.matchId ?? null),
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
          ...(entry.partyId === null ? {} : { partyRoomId: entry.partyId }),
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
    const effectiveAllowBots = allowBots && this.botOptions.enabled;
    this.database.upsertMatchmakingEntry({
      sessionId: session.id,
      rankLevelSnapshot: profile.rankLevel,
      enqueuedAt: new Date(now).toISOString(),
      allowBots: effectiveAllowBots,
    });
    this.allowBotsBySessionId.set(session.id, effectiveAllowBots);
    return this.getState(session.id);
  }

  enqueueParty(
    sessions: readonly AnonymousSession[],
    partyRoomId: string,
    now = Date.now(),
    allowBots = false,
  ): MatchmakingState {
    if (
      sessions.length < 1 ||
      sessions.length > 4 ||
      new Set(sessions.map((session) => session.id)).size !== sessions.length
    ) {
      throw new Error("TEAM_MATCH_PARTY_SIZE");
    }
    for (const session of sessions) {
      this.assertWechatLinked(session);
      this.heartbeatAtBySessionId.set(session.id, now);
    }
    const players = sessions.map((session) => ({
      sessionId: session.id,
      rankLevelSnapshot: this.database.ensureCompetitiveProfile(session.id).rankLevel,
    }));
    const effectiveAllowBots = allowBots && this.botOptions.enabled;
    this.database.enqueueMatchmakingParty(
      partyRoomId,
      players,
      new Date(now).toISOString(),
      effectiveAllowBots,
    );
    for (const session of sessions) {
      this.allowBotsBySessionId.set(session.id, effectiveAllowBots);
    }
    return this.getState(sessions[0]?.id ?? "");
  }

  continueMatchmaking(
    session: AnonymousSession,
    previousMatchId: string,
    now = Date.now(),
    allowBots = false,
  ): MatchmakingState {
    this.assertWechatLinked(session);
    this.heartbeatAtBySessionId.set(session.id, now);
    const effectiveAllowBots = allowBots && this.botOptions.enabled;
    this.database.acknowledgeAndEnqueueCompetitiveMatch(
      previousMatchId,
      session.id,
      new Date(now).toISOString(),
      effectiveAllowBots,
    );
    this.allowBotsBySessionId.set(session.id, effectiveAllowBots);
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
    const entry = this.database.getMatchmakingEntry(sessionId);
    const partyId = entry?.partyId ?? null;
    const cancelledSessionIds =
      partyId === null ? [sessionId] : this.database.cancelMatchmakingParty(partyId);
    if (partyId === null) {
      this.database.cancelMatchmakingEntry(sessionId);
    }
    for (const cancelledSessionId of cancelledSessionIds) {
      this.allowBotsBySessionId.delete(cancelledSessionId);
    }
    return { status: "IDLE" };
  }

  cancelParty(partyRoomId: string): string[] {
    const cancelledSessionIds = this.database.cancelMatchmakingParty(partyRoomId);
    for (const sessionId of cancelledSessionIds) {
      this.allowBotsBySessionId.delete(sessionId);
    }
    return cancelledSessionIds;
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

      // Experience-phase bot matching: allowBots parties wait a short window
      // so compatible humans can aggregate, then rank-compatible idle bots
      // fill the remaining seats without splitting any party. Multiple bot
      // matches can run concurrently: each pass filters the
      // shared bot pool down to the currently-idle subset and only proceeds
      // if enough of them are free to fill the table, so several tables can
      // draw disjoint bots from the pool at once instead of the whole pool
      // being blocked by any single busy bot.
      if (this.botOptions.enabled && this.botOptions.bots.length >= 3) {
        const botEntries = this.database
          .listMatchmakingEntries()
          .filter(
            (entry) =>
              entry.disconnectedAt === null &&
              this.isOnline(entry.sessionId, now) &&
              this.allowBotsFor(entry),
          )
          .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
        if (botEntries.length > 0) {
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
          if (validEntries.length > 0) {
            const humanCandidates: MatchmakingCandidate[] = validEntries.map((entry) => ({
              sessionId: entry.sessionId,
              rankLevel: entry.rankLevelSnapshot,
              enqueuedAt: entry.enqueuedAt,
              recentOpponentSessionIds: this.database.getRecentCompetitiveOpponentIds(
                entry.sessionId,
              ),
              ...(entry.partyId === null || entry.partySize === null
                ? {}
                : { partyId: entry.partyId, partySize: entry.partySize }),
            }));
            const idleBots = this.botOptions.bots.flatMap((bot) => {
              if (this.database.hasActiveCompetitiveMatch(bot.id)) return [];
              const profile = this.database.getCompetitiveProfile(bot.id);
              return profile === null
                ? []
                : [
                    {
                      sessionId: bot.id,
                      rankLevel: profile.rankLevel,
                      lastMatchedAt: this.database.getLastCompetitiveMatchCreatedAt(bot.id),
                    },
                  ];
            });
            // Never consume three allowBots players plus a bot while a complete
            // compatible four-human table is already available (including
            // players who did not opt into bots). The normal matcher below
            // gets first claim in that case.
            const allHumanCandidates: MatchmakingCandidate[] = this.database
              .listMatchmakingEntries()
              .filter(
                (entry) => entry.disconnectedAt === null && this.isOnline(entry.sessionId, now),
              )
              .map((entry) => ({
                sessionId: entry.sessionId,
                rankLevel: entry.rankLevelSnapshot,
                enqueuedAt: entry.enqueuedAt,
                ...(entry.partyId === null || entry.partySize === null
                  ? {}
                  : { partyId: entry.partyId, partySize: entry.partySize }),
              }));
            const selected =
              selectMatchmakingGroup(allHumanCandidates) === null
                ? selectBotFillGroup(humanCandidates, idleBots, now, MATCHMAKING_BOT_FILL_WAIT_MS)
                : null;
            if (selected !== null) {
              const entriesById = new Map(validEntries.map((entry) => [entry.sessionId, entry]));
              const humans = selected.humans.flatMap((candidate) => {
                const session = sessionsById.get(candidate.sessionId);
                const entry = entriesById.get(candidate.sessionId);
                return session !== undefined && entry !== undefined ? [{ session, entry }] : [];
              });
              const botsById = new Map(this.botOptions.bots.map((bot) => [bot.id, bot]));
              const chosenBots = selected.bots.flatMap((bot) => {
                const session = botsById.get(bot.sessionId);
                return session === undefined ? [] : [session];
              });
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
                if (!(cause instanceof CompetitiveMatchCreationConflictError)) {
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
          ...(entry.partyId === null || entry.partySize === null
            ? {}
            : { partyId: entry.partyId, partySize: entry.partySize }),
        }));
        const group = selectMatchmakingGroup(candidates);
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
          if (cause instanceof CompetitiveMatchCreationConflictError) {
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

  // Cache-first read of the allowBots preference, falling back to (and then
  // backfilling the cache from) the DB row already fetched by the caller.
  // This is what makes the preference survive a process restart: a cold
  // start has an empty map, so the first tick() pass after restart reads
  // straight from entry.allowBots and repopulates the cache from there.
  private allowBotsFor(entry: MatchmakingEntryRow): boolean {
    const cached = this.allowBotsBySessionId.get(entry.sessionId);
    if (cached !== undefined) return cached;
    this.allowBotsBySessionId.set(entry.sessionId, entry.allowBots);
    return entry.allowBots;
  }

  private assertWechatLinked(session: AnonymousSession): void {
    if (session.wechatOpenId == null) throw new Error("WECHAT_LINK_REQUIRED");
  }
}
