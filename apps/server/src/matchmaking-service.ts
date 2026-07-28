import { formatRankLevel } from "@huanghuang/game-engine";
import type { MatchmakingState, SelfCompetitiveProfile } from "@huanghuang/protocol";
import type { AnonymousSession, GameDatabase, MatchmakingEntryRow } from "./database.js";
import { selectMatchmakingGroup, type MatchmakingCandidate } from "./matchmaking-algorithm.js";

export const MATCHMAKING_DISCONNECT_GRACE_MS = 10_000;
export const MATCHMAKING_HEARTBEAT_TIMEOUT_MS = 3_000;

type CompetitiveRoomCreator = (
  players: readonly { session: AnonymousSession; entry: MatchmakingEntryRow }[],
  now: number,
) => { matchId: string; roomId: string };

export type MatchmakingTickResult = {
  changedSessionIds: string[];
  matches: { matchId: string; roomId: string; sessionIds: string[] }[];
};

export class MatchmakingService {
  private ticking = false;
  private readonly heartbeatAtBySessionId = new Map<string, number>();

  constructor(
    private readonly database: GameDatabase,
    private readonly isSessionOnline: (sessionId: string) => boolean,
    private readonly createCompetitiveRoom: CompetitiveRoomCreator,
    startupAt = Date.now(),
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

  enqueue(session: AnonymousSession, now = Date.now()): MatchmakingState {
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
    return this.getState(session.id);
  }

  continueMatchmaking(
    session: AnonymousSession,
    previousMatchId: string,
    now = Date.now(),
  ): MatchmakingState {
    this.assertWechatLinked(session);
    this.heartbeatAtBySessionId.set(session.id, now);
    this.database.acknowledgeAndEnqueueCompetitiveMatch(
      previousMatchId,
      session.id,
      new Date(now).toISOString(),
    );
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
