import {
  analyzeDiscardTingOptions,
  applyCompetitiveRankTransition,
  availableTurnActions,
  chooseBotAction,
  COMPETITIVE_RULE_VERSION,
  claimExposedKong,
  claimIndicatorPongKong,
  claimPong,
  continueTurn,
  createRound,
  declareAddedKong,
  declareConcealedKong,
  declareWin,
  discardTile,
  discardableTileIds,
  evaluateWin,
  formatRankLevel,
  passResponse,
  releasableWildcardIds,
  releaseWildcard,
  tileKindKey,
  type BotAction,
  type BotDecisionView,
  type RoundState,
  type RuleResult,
} from "@huanghuang/game-engine";
import type {
  BaseScore,
  BotDifficulty,
  ChatMessageProjection,
  CommandEnvelope,
  CommandResult,
  DiscardTingProjection,
  CompetitiveAchievementAction,
  CompetitiveMultiplier,
  CompetitiveRankTransition,
  GameEffectAction,
  GameEffectCue,
  PlayerController,
  PublicCompetitiveProfile,
  RoomMode,
  RoomCloseReason,
  RoomProjection,
  RoomStage,
  RoundSettlementProjection,
  Seat,
  TeamMatchmakingProjection,
  TileKind,
  TurnTimeoutSeconds,
} from "@huanghuang/protocol";
import {
  competitiveMultiplierSchema,
  competitiveRankStateSchema,
  competitiveRankTransitionSchema,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_TURN_TIMEOUT_SECONDS,
} from "@huanghuang/protocol";
import { randomInt, randomUUID } from "node:crypto";
import type {
  AnonymousSession,
  CompetitiveActionEventInput,
  CompetitiveMatchSettlement,
  CompetitivePlayerSettlementInput,
  CompetitiveProfileRow,
  GameDatabase,
  MatchmakingEntryRow,
  PublicCompetitiveProfileRow,
} from "./database.js";

type SeatController = {
  seat: Seat;
  sessionId: string | null;
  nickname: string;
  avatarUrl: string | null;
  controller: PlayerController | "EMPTY";
  connected: boolean;
};

type LegacyWaitingHuman = {
  sessionId: string;
  nickname: string;
  ready: boolean;
  joinedAt: string;
};

type SpectatorState = {
  sessionId: string;
  nickname: string;
  avatarUrl: string | null;
  connected: boolean;
  joinedAt: string;
};

type PendingEffectTransition = {
  cue: GameEffectCue;
  nextRound: RoundState;
};

type PersistedRoomState = {
  id: string;
  code: string;
  ownerSessionId: string;
  baseScore: BaseScore;
  turnTimeoutSeconds?: TurnTimeoutSeconds;
  botDifficulty?: BotDifficulty;
  status: "ACTIVE" | "CLOSED";
  version: number;
  dissolveAfterRound: boolean;
  closeReason?: RoomCloseReason | null;
  seats: Record<Seat, SeatController>;
  waitingHumans?: LegacyWaitingHuman[];
  readySessionIds?: string[];
  spectators?: SpectatorState[];
  mode?: RoomMode;
  stage?: RoomStage;
  scores?: Record<Seat, number>;
  fullTableScoreResetDone?: boolean;
  nextDealerSeat?: Seat;
  round: RoundState | null;
  roundStartedAt?: string | null;
  waitingExpiresAt?: string | null;
  actionDeadlineAt?: string | null;
  nextRoundAt?: string | null;
  pendingEffectTransition?: PendingEffectTransition | null;
  competitiveMatch?: { matchId: string; ruleVersion: number } | null;
  teamQueueStartedAt?: string | null;
};

export type RoomState = {
  id: string;
  code: string;
  ownerSessionId: string;
  baseScore: BaseScore;
  turnTimeoutSeconds: TurnTimeoutSeconds;
  botDifficulty: BotDifficulty;
  status: "ACTIVE" | "CLOSED";
  version: number;
  dissolveAfterRound: boolean;
  closeReason: RoomCloseReason | null;
  mode: RoomMode;
  stage: RoomStage;
  seats: Record<Seat, SeatController>;
  readySessionIds: string[];
  spectators: SpectatorState[];
  scores: Record<Seat, number>;
  /**
   * Whether this room has already performed its one-and-only full-table score
   * reset. It flips the first time a round starts with all four seats human and
   * never flips back, so a later disconnect/bot substitution and reconnect does
   * not wipe scores again. Only creating a new room starts a fresh ledger.
   */
  fullTableScoreResetDone: boolean;
  nextDealerSeat: Seat;
  round: RoundState | null;
  roundStartedAt: string | null;
  waitingExpiresAt: string | null;
  actionDeadlineAt: string | null;
  nextRoundAt: string | null;
  pendingEffectTransition: PendingEffectTransition | null;
  competitiveMatch: { matchId: string; ruleVersion: number } | null;
  teamQueueStartedAt: string | null;
};

export type JoinRoomResult =
  RoomState | "ROOM_FULL" | "ROOM_NOT_JOINABLE" | "WECHAT_LINK_REQUIRED" | null;
export type RoomActionResult = RoomState | "ACTION_NOT_AVAILABLE" | null;
export type RoomSettingsResult = RoomState | "ACTION_NOT_AVAILABLE" | "FORBIDDEN" | null;
export type TeamMatchStartResult =
  | { room: RoomState; sessions: AnonymousSession[] }
  | "FORBIDDEN"
  | "ACTION_NOT_AVAILABLE"
  | "TEAM_SIZE_INVALID"
  | "NOT_ALL_READY"
  | "WECHAT_LINK_REQUIRED"
  | null;
export type ChatMessageResult =
  ChatMessageProjection | "ACTION_NOT_AVAILABLE" | "NOT_A_MEMBER" | null;

type CommandPayload = Record<string, unknown>;

const SEATS: readonly Seat[] = [0, 1, 2, 3];
const ZERO_SCORES: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

const randomIntFromCrypto = (max: number): number => randomInt(max);
const BOT_DELAY_MS = 650;
const RESPONSE_TIMEOUT_MS = 5_000;
const ROUND_RESULT_MS = 4_000;
const EFFECT_DURATION_MS = {
  PONG: 450,
  EXPOSED_KONG: 700,
  CONCEALED_KONG: 700,
  ADDED_KONG: 650,
  INDICATOR_PONG_KONG: 700,
  RELEASE_WILDCARD: 800,
  WIN: 1_050,
} satisfies Record<GameEffectAction, number>;
export const WAITING_ROOM_TIMEOUT_MS = 3 * 60_000;
export const MATCH_SETTLEMENT_RETENTION_MS = 24 * 60 * 60_000;
export const CLOSED_ROOM_EVICTION_MS = 30_000;

function emptySeat(seat: Seat): SeatController {
  return {
    seat,
    sessionId: null,
    nickname: "等待加入",
    avatarUrl: null,
    controller: "EMPTY",
    connected: false,
  };
}

function botSeat(seat: Seat): SeatController {
  return {
    seat,
    sessionId: null,
    nickname: `机器人 ${seat}`,
    avatarUrl: null,
    controller: "BOT",
    connected: true,
  };
}

/**
 * A ranked bot seat for experience-phase MATCH rooms. Unlike {@link botSeat}
 * this seat carries a real session id (and competitive profile), so the
 * competitive settlement pipeline — which requires every seat to resolve to a
 * profile — can apply rank transitions and achievements to the bot just like
 * a human. The `BOT` controller still routes the seat through the bot AI on
 * each turn deadline.
 */
function rankedBotSeat(
  seat: Seat,
  bot: Pick<AnonymousSession, "id" | "nickname" | "avatarUrl">,
): SeatController {
  return {
    seat,
    sessionId: bot.id,
    nickname: bot.nickname,
    avatarUrl: bot.avatarUrl ?? null,
    controller: "BOT",
    connected: true,
  };
}

function humanSeat(
  seat: Seat,
  session: Pick<AnonymousSession, "id" | "nickname" | "avatarUrl">,
  connected = true,
): SeatController {
  return {
    seat,
    sessionId: session.id,
    nickname: session.nickname,
    avatarUrl: session.avatarUrl ?? null,
    controller: "HUMAN",
    connected,
  };
}

function sessionSeat(room: RoomState, sessionId: string): Seat | null {
  return SEATS.find((seat) => room.seats[seat].sessionId === sessionId) ?? null;
}

function spectatorIndex(room: RoomState, sessionId: string): number {
  return room.spectators.findIndex((spectator) => spectator.sessionId === sessionId);
}

function humanSessionIds(room: RoomState): string[] {
  return SEATS.flatMap((seat) => {
    const sessionId = room.seats[seat].sessionId;
    return sessionId === null ? [] : [sessionId];
  });
}

function memberHumanSessionIds(room: RoomState): string[] {
  return [...humanSessionIds(room), ...room.spectators.map((spectator) => spectator.sessionId)];
}

function isAllHumanTable(seats: Readonly<Record<Seat, SeatController>>): boolean {
  return SEATS.every((seat) => seats[seat].controller === "HUMAN");
}

function scoreResetPending(room: RoomState): boolean {
  return !room.fullTableScoreResetDone && isAllHumanTable(room.seats);
}

function roundScores(round: RoundState): Record<Seat, number> {
  return {
    0: round.players[0].score,
    1: round.players[1].score,
    2: round.players[2].score,
    3: round.players[3].score,
  };
}

function projectCompetitiveProfile(
  profile: PublicCompetitiveProfileRow | undefined,
): PublicCompetitiveProfile | null {
  if (profile === undefined) return null;
  return {
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

function competitiveMultiplier(value: number): CompetitiveMultiplier {
  return competitiveMultiplierSchema.parse(value);
}

function shuffledCompetitivePlayers(
  sessions: readonly AnonymousSession[],
  entries: readonly MatchmakingEntryRow[],
): { session: AnonymousSession; entry: MatchmakingEntryRow }[] {
  if (sessions.length !== 4 || entries.length !== 4) {
    throw new Error("A competitive room requires exactly four sessions and queue entries");
  }
  const entriesBySessionId = new Map(entries.map((entry) => [entry.sessionId, entry]));
  if (entriesBySessionId.size !== 4 || new Set(sessions.map((session) => session.id)).size !== 4) {
    throw new Error("A competitive room requires four unique sessions and queue entries");
  }
  const players = sessions.map((session) => {
    const entry = entriesBySessionId.get(session.id);
    if (entry === undefined) throw new Error(`Missing matchmaking entry for ${session.id}`);
    return { session, entry };
  });
  for (let index = players.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = players[index];
    const swap = players[swapIndex];
    if (current === undefined || swap === undefined)
      throw new Error("Invalid competitive seat shuffle");
    players[index] = swap;
    players[swapIndex] = current;
  }
  return players;
}

function competitiveAchievementAction(
  descriptor: Pick<EffectDescriptor, "action" | "winType" | "laiyou">,
): CompetitiveAchievementAction | null {
  switch (descriptor.action) {
    case "EXPOSED_KONG":
    case "INDICATOR_PONG_KONG":
    case "ADDED_KONG":
    case "CONCEALED_KONG":
    case "RELEASE_WILDCARD":
      return descriptor.action;
    case "WIN":
      if (!descriptor.laiyou) return null;
      return descriptor.winType === "HARD" ? "HARD_LAIYOU" : "SOFT_LAIYOU";
    case "PONG":
      return null;
  }
}

/**
 * Backfills round fields added after older snapshots were persisted. Rounds are
 * stored inside the room JSON, so every load path must run this before the
 * round is projected or advanced.
 */
function normalizeRoundState(round: RoundState): void {
  const legacyRound = round as Omit<RoundState, "startingScores" | "laiyouCandidate"> & {
    startingScores?: Record<Seat, number>;
    laiyouCandidate?: RoundState["laiyouCandidate"];
  };
  legacyRound.startingScores ??= roundScores(round);
  legacyRound.laiyouCandidate ??= null;
  const outcome = round.outcome;
  if (outcome?.kind === "WIN") {
    const legacyOutcome = outcome as Omit<typeof outcome, "laiyou"> & { laiyou?: boolean };
    legacyOutcome.laiyou ??= false;
  }
}

type EffectDescriptor = Pick<
  GameEffectCue,
  "action" | "actorSeat" | "tileKind" | "winType" | "laiyou"
>;

function detectEffectDescriptor(previous: RoundState, next: RoundState): EffectDescriptor | null {
  const candidates: EffectDescriptor[] = [];

  for (const seat of SEATS) {
    const previousMeldKinds = new Map(
      previous.players[seat].melds.map((meld) => [meld.id, meld.kind] as const),
    );
    for (const meld of next.players[seat].melds) {
      if (previousMeldKinds.get(meld.id) === meld.kind) continue;
      candidates.push({
        action: meld.kind,
        actorSeat: seat,
        tileKind: meld.tileKind,
        winType: null,
        laiyou: false,
      });
    }

    const previousReleasedIds = new Set(
      previous.players[seat].releasedWildcards.map((tile) => tile.id),
    );
    for (const tile of next.players[seat].releasedWildcards) {
      if (previousReleasedIds.has(tile.id)) continue;
      candidates.push({
        action: "RELEASE_WILDCARD",
        actorSeat: seat,
        tileKind: { suit: tile.suit, rank: tile.rank },
        winType: null,
        laiyou: false,
      });
    }
  }

  if (previous.outcome?.kind !== "WIN" && next.outcome?.kind === "WIN") {
    candidates.push({
      action: "WIN",
      actorSeat: next.outcome.winnerSeat,
      tileKind: null,
      winType: next.outcome.winType,
      laiyou: next.outcome.laiyou,
    });
  }

  if (candidates.length > 1) {
    throw new Error("A single rule transition produced multiple game effects");
  }
  return candidates[0] ?? null;
}

function createEffectCue(descriptor: EffectDescriptor, now: number): GameEffectCue {
  return {
    id: randomUUID(),
    ...descriptor,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + EFFECT_DURATION_MS[descriptor.action]).toISOString(),
  };
}

function stringField(payload: CommandPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function tileKindField(payload: CommandPayload): TileKind | null {
  const suit = payload.suit;
  const rank = payload.rank;
  if ((suit !== "WAN" && suit !== "TIAO" && suit !== "TONG") || typeof rank !== "number") {
    return null;
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > 9) return null;
  return { suit, rank: rank as TileKind["rank"] };
}

function publicVisibleTileCounts(round: RoundState, selfSeat: Seat): Map<string, number> {
  const visibleTiles = new Map<string, TileKind>();
  const addVisibleTile = (id: string, kind: TileKind): void => {
    if (!visibleTiles.has(id)) {
      visibleTiles.set(id, { suit: kind.suit, rank: kind.rank });
    }
  };

  for (const tile of round.players[selfSeat].hand) {
    addVisibleTile(tile.id, tile);
  }
  addVisibleTile(round.indicatorTile.id, round.indicatorTile);
  for (const seat of SEATS) {
    const player = round.players[seat];
    for (const tile of player.discards) addVisibleTile(tile.id, tile);
    for (const tile of player.releasedWildcards) addVisibleTile(tile.id, tile);
    for (const meld of player.melds) {
      for (const tileId of meld.tileIds) addVisibleTile(tileId, meld.tileKind);
    }
  }

  const counts = new Map<string, number>();
  for (const kind of visibleTiles.values()) {
    const key = tileKindKey(kind);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function projectTingHints(options: {
  round: RoundState;
  selfSeat: Seat | null;
  legalActions: readonly string[];
}): DiscardTingProjection[] {
  if (
    options.selfSeat === null ||
    options.round.phase !== "TURN_DECISION" ||
    options.round.currentSeat !== options.selfSeat ||
    !options.legalActions.includes("DISCARD_TILE")
  ) {
    return [];
  }

  const player = options.round.players[options.selfSeat];
  const publicCounts = publicVisibleTileCounts(options.round, options.selfSeat);
  return analyzeDiscardTingOptions({
    concealedTiles: player.hand,
    melds: player.melds,
    wildcardKind: options.round.wildcardKind,
  })
    .filter((option) => option.waits.length > 0)
    .map((option) => ({
      discardTileId: option.discardTileId,
      waits: option.waits.map((wait) => ({
        tileKind: wait.tileKind,
        winType: wait.winType,
        multiplier: (wait.winType === "HARD" ? 2 : 1) * player.personalMultiplier,
        remainingCount: Math.max(0, 4 - (publicCounts.get(tileKindKey(wait.tileKind)) ?? 0)),
      })),
    }));
}

export class RoomService {
  private readonly roomsByCode = new Map<string, RoomState>();
  private readonly closedRoomEvictionAt = new Map<string, number>();

  constructor(private readonly database: GameDatabase) {
    this.database.deleteClosedRooms();
    for (const json of this.database.loadActiveRooms()) {
      const room = this.normalizeRoom(JSON.parse(json) as PersistedRoomState);
      if (room.dissolveAfterRound) {
        this.database.deleteRoom(room.id);
        continue;
      }
      this.refreshDeadline(room);
      this.roomsByCode.set(room.code, room);
    }
  }

  private normalizeRoom(persisted: PersistedRoomState): RoomState {
    const round = persisted.round;
    if (round !== null) normalizeRoundState(round);
    const persistedTransition = persisted.pendingEffectTransition ?? null;
    if (persistedTransition !== null) normalizeRoundState(persistedTransition.nextRound);

    if (persisted.mode !== undefined) {
      const mode = persisted.mode;
      const stage =
        persisted.stage ??
        (round === null ? "WAITING" : round.phase === "ROUND_OVER" ? "ROUND_RESULT" : "PLAYING");
      const seats = structuredClone(persisted.seats);
      if ((mode === "FRIEND" || mode === "TEAM_MATCH") && stage === "WAITING") {
        for (const seat of SEATS) {
          if (seats[seat].sessionId === null && seats[seat].controller !== "BOT") {
            seats[seat] = emptySeat(seat);
          }
        }
      }
      return {
        id: persisted.id,
        code: persisted.code,
        ownerSessionId: persisted.ownerSessionId,
        baseScore: persisted.baseScore,
        turnTimeoutSeconds: persisted.turnTimeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS,
        botDifficulty: persisted.botDifficulty ?? DEFAULT_BOT_DIFFICULTY,
        status: persisted.status,
        version: persisted.version,
        dissolveAfterRound: persisted.dissolveAfterRound,
        closeReason: persisted.closeReason ?? null,
        mode,
        stage,
        seats,
        readySessionIds: persisted.readySessionIds ?? [],
        spectators: persisted.spectators ?? [],
        scores: persisted.scores ?? (round === null ? { ...ZERO_SCORES } : roundScores(round)),
        // Conservative inference for snapshots written before this field
        // existed: an all-human table is treated as already reset so we never
        // wipe totals real players earned, while a bot-seated table still owes
        // its one-shot reset.
        fullTableScoreResetDone:
          persisted.fullTableScoreResetDone ??
          !SEATS.some((seat) => seats[seat].controller === "BOT"),
        nextDealerSeat:
          persisted.nextDealerSeat ??
          round?.outcome?.nextDealerSeat ??
          round?.dealerSeat ??
          (randomInt(4) as Seat),
        round: stage === "WAITING" ? null : round,
        roundStartedAt: persisted.roundStartedAt ?? null,
        waitingExpiresAt:
          (mode === "FRIEND" || mode === "TEAM_MATCH") && stage === "WAITING"
            ? (persisted.waitingExpiresAt ??
              new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString())
            : null,
        actionDeadlineAt: persisted.actionDeadlineAt ?? null,
        nextRoundAt: persisted.nextRoundAt ?? null,
        pendingEffectTransition: stage === "WAITING" ? null : persistedTransition,
        competitiveMatch: persisted.competitiveMatch ?? null,
        teamQueueStartedAt: persisted.teamQueueStartedAt ?? null,
      };
    }

    const activeHumans = SEATS.flatMap((seat) => {
      const controller = persisted.seats[seat];
      return controller.sessionId === null || controller.controller === "BOT"
        ? []
        : [
            {
              id: controller.sessionId,
              nickname: controller.nickname,
              connected: controller.connected,
            },
          ];
    });
    const waitingHumans = persisted.waitingHumans ?? [];

    if (waitingHumans.length > 0) {
      const seen = new Set<string>();
      const humans = [
        ...activeHumans,
        ...waitingHumans.map((human) => ({
          id: human.sessionId,
          nickname: human.nickname,
          connected: true,
        })),
      ].filter((human) => {
        if (seen.has(human.id)) return false;
        seen.add(human.id);
        return true;
      });
      const seats = {
        0: emptySeat(0),
        1: emptySeat(1),
        2: emptySeat(2),
        3: emptySeat(3),
      } satisfies Record<Seat, SeatController>;
      for (const seat of SEATS) {
        const human = humans[seat];
        if (human !== undefined) {
          seats[seat] = humanSeat(seat, human, human.connected);
        }
      }
      return {
        id: persisted.id,
        code: persisted.code,
        ownerSessionId: persisted.ownerSessionId,
        baseScore: persisted.baseScore,
        turnTimeoutSeconds: persisted.turnTimeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS,
        botDifficulty: persisted.botDifficulty ?? DEFAULT_BOT_DIFFICULTY,
        status: persisted.status,
        version: persisted.version,
        dissolveAfterRound: persisted.dissolveAfterRound,
        closeReason: persisted.closeReason ?? null,
        mode: "FRIEND",
        stage: "WAITING",
        seats,
        readySessionIds: persisted.readySessionIds ?? [],
        spectators: [],
        scores: { ...ZERO_SCORES },
        // Seats are rebuilt from humans only and scores start at zero, so the
        // reset has nothing left to do.
        fullTableScoreResetDone: true,
        nextDealerSeat: randomInt(4) as Seat,
        round: null,
        roundStartedAt: null,
        waitingExpiresAt: new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString(),
        actionDeadlineAt: null,
        nextRoundAt: null,
        pendingEffectTransition: null,
        competitiveMatch: null,
        teamQueueStartedAt: null,
      };
    }

    const mode: RoomMode = activeHumans.length === 4 ? "FRIEND" : "BOT";
    const stage: RoomStage = round?.phase === "ROUND_OVER" ? "ROUND_RESULT" : "PLAYING";
    return {
      id: persisted.id,
      code: persisted.code,
      ownerSessionId: persisted.ownerSessionId,
      baseScore: persisted.baseScore,
      turnTimeoutSeconds: persisted.turnTimeoutSeconds ?? DEFAULT_TURN_TIMEOUT_SECONDS,
      botDifficulty: persisted.botDifficulty ?? DEFAULT_BOT_DIFFICULTY,
      status: persisted.status,
      version: persisted.version,
      dissolveAfterRound: persisted.dissolveAfterRound,
      closeReason: persisted.closeReason ?? null,
      mode,
      stage,
      seats: structuredClone(persisted.seats),
      readySessionIds: persisted.readySessionIds ?? [],
      spectators: persisted.spectators ?? [],
      scores: round === null ? { ...ZERO_SCORES } : roundScores(round),
      fullTableScoreResetDone: !SEATS.some((seat) => persisted.seats[seat].controller === "BOT"),
      nextDealerSeat: round?.outcome?.nextDealerSeat ?? round?.dealerSeat ?? (randomInt(4) as Seat),
      round,
      roundStartedAt: null,
      waitingExpiresAt: null,
      actionDeadlineAt: persisted.actionDeadlineAt ?? null,
      nextRoundAt: persisted.nextRoundAt ?? null,
      pendingEffectTransition: null,
      competitiveMatch: persisted.competitiveMatch ?? null,
      teamQueueStartedAt: null,
    };
  }

  private actingSeat(room: RoomState): Seat | null {
    const round = room.round;
    if (room.stage !== "PLAYING" || round === null || room.pendingEffectTransition !== null) {
      return null;
    }
    if (round.phase === "TURN_DECISION") return round.currentSeat;
    if (round.phase === "DISCARD_RESPONSE") return round.pendingResponse?.seat ?? null;
    return null;
  }

  private syncRoundResult(room: RoomState): void {
    const round = room.round;
    if (round?.outcome === null || round === null) return;
    room.scores = roundScores(round);
    room.nextDealerSeat = round.outcome.nextDealerSeat;
  }

  private refreshDeadline(room: RoomState, now = Date.now()): void {
    const round = room.round;
    if (room.status !== "ACTIVE" || room.stage === "WAITING" || round === null) {
      room.actionDeadlineAt = null;
      room.nextRoundAt = null;
      return;
    }
    if (room.pendingEffectTransition !== null) {
      room.actionDeadlineAt = null;
      room.nextRoundAt = null;
      return;
    }
    if (round.phase === "ROUND_OVER") {
      room.stage = "ROUND_RESULT";
      room.actionDeadlineAt = null;
      this.syncRoundResult(room);
      if (room.mode === "FRIEND") {
        room.nextRoundAt ??= new Date(now + ROUND_RESULT_MS).toISOString();
      } else {
        room.nextRoundAt = null;
      }
      return;
    }
    room.stage = "PLAYING";
    room.nextRoundAt = null;
    const actingSeat = this.actingSeat(room);
    if (actingSeat === null) {
      room.actionDeadlineAt = null;
      return;
    }
    const controller = room.seats[actingSeat].controller;
    const duration =
      controller !== "HUMAN"
        ? BOT_DELAY_MS
        : round.phase === "DISCARD_RESPONSE"
          ? RESPONSE_TIMEOUT_MS
          : room.turnTimeoutSeconds * 1_000;
    room.actionDeadlineAt = new Date(now + duration).toISOString();
  }

  private startRound(room: RoomState, now = Date.now()): void {
    // `startRound` is the only place a round receives `startingScores`, so it is
    // also the single choke point for the one-shot full-table reset. Firing here
    // rather than when the fourth human takes a seat matters: a seat can turn
    // back into a bot while still waiting, and we must not spend the reset on a
    // round that ends up including a bot.
    if (!room.fullTableScoreResetDone && isAllHumanTable(room.seats)) {
      room.scores = { ...ZERO_SCORES };
      room.fullTableScoreResetDone = true;
    }
    room.pendingEffectTransition = null;
    room.round = createRound({
      id: randomUUID(),
      dealerSeat: room.nextDealerSeat,
      baseScore: room.baseScore,
      startingScores: room.scores,
      randomInt: randomIntFromCrypto,
    });
    room.stage = "PLAYING";
    room.readySessionIds = [];
    room.roundStartedAt = new Date(now).toISOString();
    room.waitingExpiresAt = null;
    room.nextRoundAt = null;
    this.refreshDeadline(room, now);
  }

  private enterWaiting(room: RoomState, now = Date.now()): void {
    this.syncRoundResult(room);
    for (const spectator of room.spectators) {
      const botSeatIndex = SEATS.find((seat) => room.seats[seat].controller === "BOT");
      if (botSeatIndex === undefined) break;
      room.seats[botSeatIndex] = humanSeat(
        botSeatIndex,
        {
          id: spectator.sessionId,
          nickname: spectator.nickname,
          avatarUrl: spectator.avatarUrl,
        },
        spectator.connected,
      );
    }
    room.spectators = [];
    room.stage = "WAITING";
    room.pendingEffectTransition = null;
    room.round = null;
    room.readySessionIds = [];
    room.roundStartedAt = null;
    room.waitingExpiresAt = new Date(now + WAITING_ROOM_TIMEOUT_MS).toISOString();
    room.actionDeadlineAt = null;
    room.nextRoundAt = null;
    for (const seat of SEATS) {
      if (room.seats[seat].sessionId === null && room.seats[seat].controller !== "BOT") {
        room.seats[seat] = emptySeat(seat);
      }
    }
  }

  private closeRoom(room: RoomState, reason: RoomCloseReason, now = Date.now()): void {
    room.status = "CLOSED";
    room.closeReason = reason;
    room.dissolveAfterRound = false;
    room.readySessionIds = [];
    room.pendingEffectTransition = null;
    room.actionDeadlineAt = null;
    room.nextRoundAt = null;
    room.waitingExpiresAt = null;
    this.closedRoomEvictionAt.set(room.code, now + CLOSED_ROOM_EVICTION_MS);
  }

  private acceptRule(room: RoomState, result: RuleResult, now = Date.now()): boolean {
    if (!result.ok || room.round === null || room.pendingEffectTransition !== null) return false;
    const effect = detectEffectDescriptor(room.round, result.state);
    if (effect === null) {
      room.round = result.state;
    } else {
      room.pendingEffectTransition = {
        cue: createEffectCue(effect, now),
        nextRound: result.state,
      };
    }
    room.version += 1;
    this.refreshDeadline(room, now);
    return true;
  }

  private competitiveAchievementEvent(
    room: RoomState,
    result: Extract<RuleResult, { ok: true }>,
  ): CompetitiveActionEventInput | undefined {
    if (room.mode !== "MATCH" || room.round === null || room.competitiveMatch === null) {
      return undefined;
    }
    const descriptor = detectEffectDescriptor(room.round, result.state);
    if (descriptor === null) return undefined;
    const action = competitiveAchievementAction(descriptor);
    const sessionId = room.seats[descriptor.actorSeat].sessionId;
    if (action === null || sessionId === null) return undefined;
    return {
      eventKey: `${result.state.id}:${result.state.version}`,
      matchId: room.competitiveMatch.matchId,
      sessionId,
      roundId: result.state.id,
      roundVersion: result.state.version,
      action,
    };
  }

  private competitiveTerminalSettlement(room: RoomState): {
    settlement: {
      matchId: string;
      resultJson: string;
      players: CompetitivePlayerSettlementInput[];
    };
    transitions: Record<string, CompetitiveRankTransition>;
  } | null {
    const round = room.round;
    if (
      room.mode !== "MATCH" ||
      room.competitiveMatch === null ||
      round?.outcome === undefined ||
      round.outcome === null
    ) {
      return null;
    }
    const outcome = round.outcome;
    const profiles = new Map<string, CompetitiveProfileRow>();
    for (const seat of SEATS) {
      const sessionId = room.seats[seat].sessionId;
      if (sessionId === null) throw new Error("Competitive room seat is missing its session");
      const profile = this.database.getCompetitiveProfile(sessionId);
      if (profile === null) throw new Error(`Competitive profile is missing for ${sessionId}`);
      profiles.set(sessionId, profile);
    }

    const winnerSeat = outcome.kind === "WIN" ? outcome.winnerSeat : null;
    const winnerMultiplier =
      outcome.kind === "WIN"
        ? competitiveMultiplier(
            (outcome.winType === "HARD" ? 2 : 1) *
              (outcome.laiyou ? 2 : 1) *
              round.players[outcome.winnerSeat].personalMultiplier,
          )
        : null;
    const transitions: Record<string, CompetitiveRankTransition> = {};
    const players = SEATS.map((seat): CompetitivePlayerSettlementInput => {
      const sessionId = room.seats[seat].sessionId;
      if (sessionId === null) throw new Error("Competitive room seat is missing its session");
      const profileRow = profiles.get(sessionId);
      if (profileRow === undefined)
        throw new Error(`Competitive profile is missing for ${sessionId}`);
      const profile = competitiveRankStateSchema.parse(profileRow);
      let multiplier: CompetitiveMultiplier | null = null;
      let transition: CompetitiveRankTransition;
      if (outcome.kind === "DRAW") {
        transition = applyCompetitiveRankTransition(profile, { kind: "DRAW" });
      } else if (seat === winnerSeat && winnerMultiplier !== null) {
        multiplier = winnerMultiplier;
        transition = applyCompetitiveRankTransition(profile, { kind: "WIN", multiplier });
      } else {
        const payment = outcome.scoreDeltas.find((delta) => delta.seat === seat && delta.delta < 0);
        if (payment === undefined) throw new Error(`Missing competitive payment for seat ${seat}`);
        multiplier = competitiveMultiplier(-payment.delta / round.baseScore);
        transition = applyCompetitiveRankTransition(profile, { kind: "LOSS", multiplier });
      }
      transitions[sessionId] = competitiveRankTransitionSchema.parse(transition);
      return {
        sessionId,
        postRankLevel: transition.afterRankLevel,
        highestMajorIndex: transition.afterHighestMajorIndex,
        rawRankDelta: transition.rawDelta,
        finalRankDelta: transition.appliedDelta,
        protectionCardsBefore: transition.protectionCardsBefore,
        protectionCardsAfter: transition.protectionCardsAfter,
        protectionCardsConsumed: transition.protectionCardsConsumed,
        protectionCardsGranted: transition.protectionCardsGranted,
        multiplier,
      };
    });
    return {
      settlement: {
        matchId: room.competitiveMatch.matchId,
        resultJson: JSON.stringify(transitions),
        players,
      },
      transitions,
    };
  }

  private commitAcceptedRule(
    room: RoomState,
    result: Extract<RuleResult, { ok: true }>,
    options: {
      now?: number;
      processedRequest?: { sessionId: string; requestId: string; resultJson: string };
    } = {},
  ): boolean {
    const now = options.now ?? Date.now();
    const nextRoom = structuredClone(room);
    const achievementEvent = this.competitiveAchievementEvent(room, result);
    if (!this.acceptRule(nextRoom, result, now)) return false;
    const terminal =
      nextRoom.pendingEffectTransition === null
        ? this.competitiveTerminalSettlement(nextRoom)?.settlement
        : undefined;
    this.database.saveAcceptedTransition({
      room: nextRoom,
      stateJson: JSON.stringify(nextRoom),
      ...(options.processedRequest === undefined
        ? {}
        : { processedRequest: options.processedRequest }),
      ...(achievementEvent === undefined ? {} : { achievementEvent }),
      ...(terminal === undefined ? {} : { terminalSettlement: terminal }),
    });
    Object.assign(room, nextRoom);
    return true;
  }

  private botDecisionView(room: RoomState, seat: Seat): BotDecisionView {
    const round = room.round;
    if (round === null) throw new Error("Cannot project a bot decision without an active round");
    const player = round.players[seat];
    const legalActions =
      round.phase === "DISCARD_RESPONSE"
        ? [...(round.pendingResponse?.actions ?? []), "PASS_RESPONSE"]
        : availableTurnActions(round, seat);
    return {
      seat,
      phase: round.phase === "DISCARD_RESPONSE" ? "DISCARD_RESPONSE" : "TURN_DECISION",
      legalActions,
      botDifficulty: room.botDifficulty,
      winType: legalActions.includes("DECLARE_WIN")
        ? evaluateWin({
            concealedTiles: player.hand,
            melds: player.melds,
            wildcardKind: round.wildcardKind,
            winningTileId: round.lastDrawnTileId,
          }).winType
        : null,
      hand: player.hand,
      melds: player.melds,
      releasedWildcards: player.releasedWildcards,
      wildcardKind: round.wildcardKind,
      indicatorTile: round.indicatorTile,
      wallRemaining: round.wall.length,
      pendingDiscard: round.lastDiscard?.tile ?? null,
      publicPlayers: SEATS.map((publicSeat) => ({
        seat: publicSeat,
        melds: round.players[publicSeat].melds,
        discards: round.players[publicSeat].discards,
        releasedWildcards: round.players[publicSeat].releasedWildcards,
      })),
    };
  }

  private executeBotAction(round: RoundState, seat: Seat, action: BotAction): RuleResult {
    switch (action.type) {
      case "DECLARE_WIN":
        return declareWin(round, seat);
      case "RELEASE_WILDCARD":
        return releaseWildcard(round, seat, action.tileId);
      case "DECLARE_CONCEALED_KONG":
        return declareConcealedKong(round, seat, action.tileKind);
      case "DECLARE_ADDED_KONG":
        return declareAddedKong(round, seat, action.meldId, action.tileId);
      case "DISCARD_TILE":
        return discardTile(round, seat, action.tileId);
      case "CLAIM_PONG":
        return claimPong(round, seat);
      case "CLAIM_EXPOSED_KONG":
        return claimExposedKong(round, seat);
      case "CLAIM_INDICATOR_PONG_KONG":
        return claimIndicatorPongKong(round, seat);
      case "PASS_RESPONSE":
        return passResponse(round, seat);
    }
  }

  private trusteeAction(round: RoundState, seat: Seat): RuleResult {
    if (round.phase === "DISCARD_RESPONSE") return passResponse(round, seat);
    const actions = availableTurnActions(round, seat);
    if (actions.includes("DECLARE_WIN")) return declareWin(round, seat);
    const player = round.players[seat];
    const wildcardIds = releasableWildcardIds({
      hand: player.hand,
      wildcardKind: round.wildcardKind,
      wallRemaining: round.wall.length,
    });
    if (wildcardIds.length >= 2) {
      const tileId = wildcardIds[0];
      if (tileId !== undefined) return releaseWildcard(round, seat, tileId);
    }
    const legalDiscards = discardableTileIds(player.hand, round.wildcardKind);
    const tileId = legalDiscards.includes(round.lastDrawnTileId)
      ? round.lastDrawnTileId
      : legalDiscards[randomInt(Math.max(legalDiscards.length, 1))];
    return tileId === undefined
      ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
      : discardTile(round, seat, tileId);
  }

  private automaticAction(room: RoomState, seat: Seat): RuleResult {
    const round = room.round;
    if (round === null) return { ok: false, code: "WRONG_PHASE" };
    if (room.seats[seat].controller !== "BOT") return this.trusteeAction(round, seat);
    const action = chooseBotAction(this.botDecisionView(room, seat), randomIntFromCrypto);
    return action === null
      ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
      : this.executeBotAction(round, seat, action);
  }

  tick(now = Date.now()): { roomId: string; version: number }[] {
    const updates: { roomId: string; version: number }[] = [];
    for (const [code, room] of this.roomsByCode) {
      if (room.status !== "ACTIVE") {
        const evictionAt = this.closedRoomEvictionAt.get(code);
        if (evictionAt !== undefined && evictionAt <= now) {
          this.roomsByCode.delete(code);
          this.closedRoomEvictionAt.delete(code);
          this.database.deleteRoom(room.id);
        }
        continue;
      }
      const pendingTransition = room.pendingEffectTransition;
      if (pendingTransition !== null) {
        if (Date.parse(pendingTransition.cue.endsAt) > now) continue;
        const nextRoom = structuredClone(room);
        nextRoom.round = structuredClone(pendingTransition.nextRound);
        nextRoom.pendingEffectTransition = null;
        nextRoom.version += 1;
        this.refreshDeadline(nextRoom, now);
        const terminalSettlement = this.competitiveTerminalSettlement(nextRoom)?.settlement;
        this.database.saveAcceptedTransition({
          room: nextRoom,
          stateJson: JSON.stringify(nextRoom),
          ...(terminalSettlement === undefined ? {} : { terminalSettlement }),
        });
        Object.assign(room, nextRoom);
        updates.push({ roomId: room.id, version: room.version });
        continue;
      }
      if (room.stage === "WAITING") {
        if (
          (room.mode === "FRIEND" ||
            (room.mode === "TEAM_MATCH" && room.teamQueueStartedAt === null)) &&
          room.waitingExpiresAt !== null &&
          Date.parse(room.waitingExpiresAt) <= now
        ) {
          this.closeRoom(room, "WAITING_TIMEOUT", now);
          room.version += 1;
          this.save(room);
          updates.push({ roomId: room.id, version: room.version });
        }
        continue;
      }
      if (room.stage === "ROUND_RESULT") {
        if (
          room.mode === "FRIEND" &&
          room.nextRoundAt !== null &&
          Date.parse(room.nextRoundAt) <= now
        ) {
          this.enterWaiting(room, now);
          room.version += 1;
          this.save(room);
          updates.push({ roomId: room.id, version: room.version });
        } else if (room.mode === "MATCH" && room.competitiveMatch !== null) {
          const settlement = this.database.getCompetitiveMatchSettlement(
            room.competitiveMatch.matchId,
          );
          if (settlement?.match.status === "SETTLED") {
            // Experience-phase bot seats never acknowledge on their own (they
            // have no client). Auto-ack them here so a ranked bot match closes
            // promptly once its human player acknowledges, instead of lingering
            // for the full 24h retention window and keeping the bot accounts
            // pinned to a settled match.
            const ackedAt = new Date(now).toISOString();
            for (const seat of SEATS) {
              const controller = room.seats[seat];
              if (controller.controller === "BOT" && controller.sessionId !== null) {
                this.database.acknowledgeCompetitiveMatchResult(
                  settlement.match.id,
                  controller.sessionId,
                  ackedAt,
                );
              }
            }
            const refreshed = this.database.getCompetitiveMatchSettlement(
              room.competitiveMatch.matchId,
            );
            const allAcknowledged =
              refreshed?.players.every((player) => player.acknowledgedAt !== null) ?? false;
            const expired =
              settlement.match.settledAt !== null &&
              Date.parse(settlement.match.settledAt) + MATCH_SETTLEMENT_RETENTION_MS <= now;
            if (expired && !allAcknowledged) {
              this.database.acknowledgeAllCompetitiveMatchResults(
                settlement.match.id,
                new Date(now).toISOString(),
              );
            }
            if (allAcknowledged || expired) {
              this.closeRoom(room, "MATCH_SETTLED", now);
              room.version += 1;
              this.save(room);
              updates.push({ roomId: room.id, version: room.version });
            }
          }
        }
        continue;
      }
      if (room.actionDeadlineAt === null || Date.parse(room.actionDeadlineAt) > now) continue;
      const seat = this.actingSeat(room);
      if (seat === null) continue;
      const workingRoom = structuredClone(room);
      const result = this.automaticAction(workingRoom, seat);
      const changed = result.ok && this.commitAcceptedRule(room, result, { now });
      if (!changed) {
        const nextRoom = structuredClone(room);
        this.refreshDeadline(nextRoom, now);
        this.database.saveAcceptedTransition({
          room: nextRoom,
          stateJson: JSON.stringify(nextRoom),
        });
        Object.assign(room, nextRoom);
      }
      updates.push({ roomId: room.id, version: room.version });
    }
    return updates;
  }

  private save(room: RoomState): void {
    this.database.saveRoom(room, JSON.stringify(room));
  }

  private nextRoomCode(): string {
    const start = randomInt(9_000);
    for (let offset = 0; offset < 9_000; offset += 1) {
      const code = String(1_000 + ((start + offset) % 9_000));
      if (!this.roomsByCode.has(code)) return code;
    }
    throw new Error("All four-digit room codes are currently in use");
  }

  createRoom(
    session: AnonymousSession,
    baseScore: BaseScore,
    mode: Exclude<RoomMode, "MATCH">,
    turnTimeoutSeconds: TurnTimeoutSeconds = DEFAULT_TURN_TIMEOUT_SECONDS,
    botDifficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  ): RoomState {
    const room: RoomState = {
      id: randomUUID(),
      code: this.nextRoomCode(),
      ownerSessionId: session.id,
      baseScore: mode === "TEAM_MATCH" ? 2 : baseScore,
      turnTimeoutSeconds: mode === "TEAM_MATCH" ? 20 : turnTimeoutSeconds,
      botDifficulty: mode === "TEAM_MATCH" ? "LOW" : botDifficulty,
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      closeReason: null,
      mode,
      stage: mode === "BOT" ? "PLAYING" : "WAITING",
      seats: {
        0: humanSeat(0, session),
        1: mode === "BOT" ? botSeat(1) : emptySeat(1),
        2: mode === "BOT" ? botSeat(2) : emptySeat(2),
        3: mode === "BOT" ? botSeat(3) : emptySeat(3),
      },
      readySessionIds: [],
      spectators: [],
      scores: { ...ZERO_SCORES },
      fullTableScoreResetDone: false,
      nextDealerSeat: randomInt(4) as Seat,
      round: null,
      roundStartedAt: null,
      waitingExpiresAt:
        mode === "BOT" ? null : new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString(),
      actionDeadlineAt: null,
      nextRoundAt: null,
      pendingEffectTransition: null,
      competitiveMatch: null,
      teamQueueStartedAt: null,
    };
    if (mode === "BOT") this.startRound(room);
    this.roomsByCode.set(room.code, room);
    this.save(room);
    return room;
  }

  createCompetitiveMatch(
    sessions: readonly AnonymousSession[],
    entries: readonly MatchmakingEntryRow[],
  ): RoomState {
    const players = shuffledCompetitivePlayers(sessions, entries);
    const matchId = randomUUID();
    const player0 = players[0];
    const player1 = players[1];
    const player2 = players[2];
    const player3 = players[3];
    if (
      player0 === undefined ||
      player1 === undefined ||
      player2 === undefined ||
      player3 === undefined
    ) {
      throw new Error("Competitive room seat assignment is incomplete");
    }
    const room: RoomState = {
      id: randomUUID(),
      code: this.nextRoomCode(),
      ownerSessionId: player0.session.id,
      baseScore: 2,
      turnTimeoutSeconds: 20,
      botDifficulty: "LOW",
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      closeReason: null,
      mode: "MATCH",
      stage: "PLAYING",
      seats: {
        0: humanSeat(0, player0.session),
        1: humanSeat(1, player1.session),
        2: humanSeat(2, player2.session),
        3: humanSeat(3, player3.session),
      },
      readySessionIds: [],
      spectators: [],
      scores: { ...ZERO_SCORES },
      fullTableScoreResetDone: false,
      nextDealerSeat: randomInt(4) as Seat,
      round: null,
      roundStartedAt: null,
      waitingExpiresAt: null,
      actionDeadlineAt: null,
      nextRoundAt: null,
      pendingEffectTransition: null,
      competitiveMatch: { matchId, ruleVersion: COMPETITIVE_RULE_VERSION },
      teamQueueStartedAt: null,
    };
    this.startRound(room);
    const round = room.round;
    if (round === null) throw new Error("Competitive room failed to start its round");
    this.database.createCompetitiveMatch({
      match: {
        id: matchId,
        roomId: room.id,
        roundId: round.id,
        ruleVersion: COMPETITIVE_RULE_VERSION,
      },
      room,
      stateJson: JSON.stringify(room),
      players: players.map(({ session, entry }, seat) => ({
        sessionId: session.id,
        seat,
        queueVersion: entry.version,
        partyId: entry.partyId,
      })),
    });
    this.roomsByCode.set(room.code, room);
    return room;
  }

  /**
   * Create a MATCH room for one real human and three preset ranked bots.
   * Mirrors {@link createCompetitiveMatch} but seats the bots with
   * {@link rankedBotSeat} so they keep a real session id (settlement works)
   * while still being driven by the bot AI. Seat order is shuffled so the
   * human is not always dealer-adjacent to the same bot.
   */
  /**
   * Create a MATCH room for one to three real humans plus preset ranked bots
   * filling the remaining seats. Mirrors {@link createCompetitiveMatch} but
   * seats the bots with {@link rankedBotSeat} so they keep a real session id
   * (settlement works) while still being driven by the bot AI. Seat order is
   * shuffled so the humans are not always in fixed positions.
   */
  createCompetitiveMatchWithBots(
    humanSessions: readonly AnonymousSession[],
    humanEntries: readonly MatchmakingEntryRow[],
    botSessions: readonly AnonymousSession[],
  ): RoomState {
    if (
      humanSessions.length < 1 ||
      humanSessions.length > 3 ||
      humanEntries.length !== humanSessions.length ||
      botSessions.length !== 4 - humanSessions.length
    ) {
      throw new Error(
        "A competitive bot match needs 1-3 humans plus bots filling the rest of the table",
      );
    }
    const firstHuman = humanSessions[0];
    if (firstHuman === undefined) {
      throw new Error("A competitive bot match requires at least one human session");
    }
    const matchId = randomUUID();
    const entriesBySessionId = new Map(
      humanEntries.map((entry) => [entry.sessionId, entry] as const),
    );
    // Shuffle the four identities into seats 0..3.
    const identities: AnonymousSession[] = [...humanSessions, ...botSessions];
    for (let index = identities.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      const current = identities[index];
      const swap = identities[swapIndex];
      if (current === undefined || swap === undefined) {
        throw new Error("Invalid competitive bot seat shuffle");
      }
      identities[index] = swap;
      identities[swapIndex] = current;
    }
    const botsById = new Map(botSessions.map((bot) => [bot.id, bot] as const));
    const isBot = (session: AnonymousSession): boolean => botsById.has(session.id);
    const seats = {} as Record<Seat, SeatController>;
    const humanPlayers: {
      sessionId: string;
      seat: Seat;
      queueVersion: number;
      partyId: string | null;
    }[] = [];
    // A plain for loop (not forEach) so TypeScript's control-flow analysis
    // tracks mutations inside the body.
    for (let index = 0; index < SEATS.length; index += 1) {
      const seat = SEATS[index];
      if (seat === undefined) throw new Error("Competitive bot seat assignment is incomplete");
      const identity = identities[index];
      if (identity === undefined) throw new Error("Competitive bot seat assignment is incomplete");
      if (isBot(identity)) {
        seats[seat] = rankedBotSeat(seat, identity);
      } else {
        const entry = entriesBySessionId.get(identity.id);
        if (entry === undefined) {
          throw new Error(`Missing matchmaking entry for human ${identity.id}`);
        }
        seats[seat] = humanSeat(seat, identity);
        humanPlayers.push({
          sessionId: identity.id,
          seat,
          queueVersion: entry.version,
          partyId: entry.partyId,
        });
      }
    }
    if (humanPlayers.length !== humanSessions.length) {
      throw new Error("Competitive bot match is missing human seat assignments");
    }
    const botPlayers = SEATS.flatMap((seat) => {
      const controller = seats[seat];
      return controller.controller === "BOT" && controller.sessionId !== null
        ? [{ sessionId: controller.sessionId, seat }]
        : [];
    });

    const room: RoomState = {
      id: randomUUID(),
      code: this.nextRoomCode(),
      ownerSessionId: firstHuman.id,
      baseScore: 2,
      turnTimeoutSeconds: 20,
      botDifficulty: "LOW",
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      closeReason: null,
      mode: "MATCH",
      stage: "PLAYING",
      seats,
      readySessionIds: [],
      spectators: [],
      scores: { ...ZERO_SCORES },
      fullTableScoreResetDone: false,
      nextDealerSeat: randomInt(4) as Seat,
      round: null,
      roundStartedAt: null,
      waitingExpiresAt: null,
      actionDeadlineAt: null,
      nextRoundAt: null,
      pendingEffectTransition: null,
      competitiveMatch: { matchId, ruleVersion: COMPETITIVE_RULE_VERSION },
      teamQueueStartedAt: null,
    };
    this.startRound(room);
    const round = room.round;
    if (round === null) throw new Error("Competitive bot room failed to start its round");
    this.database.createCompetitiveMatchWithBots({
      match: {
        id: matchId,
        roomId: room.id,
        roundId: round.id,
        ruleVersion: COMPETITIVE_RULE_VERSION,
      },
      room,
      stateJson: JSON.stringify(room),
      humanPlayers,
      botPlayers,
    });
    this.roomsByCode.set(room.code, room);
    return room;
  }

  joinRoom(session: AnonymousSession, code: string): JoinRoomResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "FRIEND" && room.mode !== "TEAM_MATCH") return "ROOM_NOT_JOINABLE";
    if (room.mode === "TEAM_MATCH") {
      if (session.wechatOpenId == null) return "WECHAT_LINK_REQUIRED";
      if (
        room.teamQueueStartedAt !== null ||
        this.database.listMatchmakingPartyEntries(room.id).length > 0 ||
        this.currentTeamCompetitiveMatch(room) !== null
      ) {
        return "ROOM_NOT_JOINABLE";
      }
    }
    if (sessionSeat(room, session.id) !== null) return room;
    if (spectatorIndex(room, session.id) >= 0) return room;

    if (room.stage === "WAITING") {
      const seat =
        SEATS.find((candidate) => room.seats[candidate].controller === "EMPTY") ??
        SEATS.find((candidate) => room.seats[candidate].controller === "BOT");
      if (seat === undefined) return "ROOM_FULL";
      room.seats[seat] = humanSeat(seat, session);
    } else {
      const currentHumans = humanSessionIds(room).length + room.spectators.length;
      const hasReplaceableBot = SEATS.some((seat) => room.seats[seat].controller === "BOT");
      if (currentHumans >= 4 || !hasReplaceableBot) return "ROOM_FULL";
      room.spectators.push({
        sessionId: session.id,
        nickname: session.nickname,
        avatarUrl: session.avatarUrl ?? null,
        connected: true,
        joinedAt: new Date().toISOString(),
      });
    }
    room.version += 1;
    this.save(room);
    return room;
  }

  setReady(sessionId: string, code: string, ready: boolean): RoomActionResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (
      (room.mode !== "FRIEND" && room.mode !== "TEAM_MATCH") ||
      room.stage !== "WAITING" ||
      (room.mode === "TEAM_MATCH" &&
        (room.teamQueueStartedAt !== null ||
          this.database.listMatchmakingPartyEntries(room.id).length > 0))
    ) {
      return "ACTION_NOT_AVAILABLE";
    }
    const seat = sessionSeat(room, sessionId);
    if (seat === null) return "ACTION_NOT_AVAILABLE";
    const isReady = room.readySessionIds.includes(sessionId);
    if (isReady === ready) return room;

    room.readySessionIds = ready
      ? [...room.readySessionIds, sessionId]
      : room.readySessionIds.filter((id) => id !== sessionId);
    const allSeatsOccupied = SEATS.every(
      (candidate) => room.seats[candidate].controller !== "EMPTY",
    );
    const occupiedSessions = humanSessionIds(room);
    if (
      room.mode === "FRIEND" &&
      allSeatsOccupied &&
      ready &&
      occupiedSessions.every((candidate) => room.readySessionIds.includes(candidate))
    ) {
      this.startRound(room);
    }
    room.version += 1;
    this.save(room);
    return room;
  }

  prepareTeamMatch(sessionId: string, code: string): TeamMatchStartResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "TEAM_MATCH" || room.stage !== "WAITING") {
      return "ACTION_NOT_AVAILABLE";
    }
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
    if (
      room.teamQueueStartedAt !== null ||
      this.database.listMatchmakingPartyEntries(room.id).length > 0
    ) {
      return "ACTION_NOT_AVAILABLE";
    }
    const sessionIds = humanSessionIds(room);
    if (sessionIds.length < 1 || sessionIds.length > 4) return "TEAM_SIZE_INVALID";
    if (
      !sessionIds
        .filter((candidate) => candidate !== room.ownerSessionId)
        .every((candidate) => room.readySessionIds.includes(candidate))
    ) {
      return "NOT_ALL_READY";
    }
    const sessions = this.database.findSessionsByIds(sessionIds);
    if (sessions.length !== sessionIds.length) return "ACTION_NOT_AVAILABLE";
    if (sessions.some((session) => session.wechatOpenId == null)) {
      return "WECHAT_LINK_REQUIRED";
    }
    return { room, sessions };
  }

  resetTeamMatch(code: string): RoomActionResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "TEAM_MATCH" || room.stage !== "WAITING") {
      return "ACTION_NOT_AVAILABLE";
    }
    room.readySessionIds = [];
    room.teamQueueStartedAt = null;
    room.waitingExpiresAt = new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString();
    room.version += 1;
    this.save(room);
    return room;
  }

  touchTeamMatch(code: string): RoomActionResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "TEAM_MATCH" || room.stage !== "WAITING") {
      return "ACTION_NOT_AVAILABLE";
    }
    room.teamQueueStartedAt =
      this.database.listMatchmakingPartyEntries(room.id)[0]?.enqueuedAt ?? new Date().toISOString();
    room.version += 1;
    this.save(room);
    return room;
  }

  reconcileTeamMatchQueues(): RoomState[] {
    const changed: RoomState[] = [];
    for (const room of this.roomsByCode.values()) {
      if (
        room.status !== "ACTIVE" ||
        room.mode !== "TEAM_MATCH" ||
        room.teamQueueStartedAt === null ||
        this.database.listMatchmakingPartyEntries(room.id).length > 0 ||
        this.currentTeamCompetitiveMatch(room) !== null
      ) {
        continue;
      }
      room.readySessionIds = [];
      room.teamQueueStartedAt = null;
      room.waitingExpiresAt = new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString();
      room.version += 1;
      this.save(room);
      changed.push(room);
    }
    return changed;
  }

  continueBotRound(sessionId: string, code: string): RoomActionResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "BOT" || room.stage !== "ROUND_RESULT" || room.ownerSessionId !== sessionId) {
      return "ACTION_NOT_AVAILABLE";
    }
    this.syncRoundResult(room);
    this.startRound(room);
    room.version += 1;
    this.save(room);
    return room;
  }

  getRoom(code: string): RoomState | null {
    return this.roomsByCode.get(code) ?? null;
  }

  getRoomById(roomId: string): RoomState | null {
    return [...this.roomsByCode.values()].find((room) => room.id === roomId) ?? null;
  }

  /**
   * Resolves the team-ranked staging room this player queued from for a
   * given competitive match, if any and if that room is still around. Lets
   * "continue" send a team-ranked player back to regroup with their
   * original party instead of silently re-queueing them solo — see
   * 07-31-ranked-continue-team-bug.
   */
  private resolveOriginRoomCode(matchId: string, sessionId: string): string | null {
    const partyId = this.database.getCompetitiveMatchPlayer(matchId, sessionId)?.partyId ?? null;
    if (partyId === null) return null;
    const originRoom = this.getRoomById(partyId);
    return originRoom !== null && originRoom.status === "ACTIVE" ? originRoom.code : null;
  }

  hasMember(sessionId: string, code: string): boolean {
    const room = this.roomsByCode.get(code);
    return (
      room !== undefined &&
      (sessionSeat(room, sessionId) !== null || spectatorIndex(room, sessionId) >= 0)
    );
  }

  updateSettings(
    sessionId: string,
    code: string,
    settings: {
      baseScore?: BaseScore | undefined;
      botDifficulty?: BotDifficulty | undefined;
    },
  ): RoomSettingsResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
    if (room.mode !== "FRIEND" || room.stage !== "WAITING") return "ACTION_NOT_AVAILABLE";
    const nextBaseScore = settings.baseScore ?? room.baseScore;
    const nextBotDifficulty = settings.botDifficulty ?? room.botDifficulty;
    if (room.baseScore === nextBaseScore && room.botDifficulty === nextBotDifficulty) return room;

    room.baseScore = nextBaseScore;
    room.botDifficulty = nextBotDifficulty;
    room.readySessionIds = [];
    room.version += 1;
    this.save(room);
    return room;
  }

  updateBaseScore(sessionId: string, code: string, baseScore: BaseScore): RoomSettingsResult {
    return this.updateSettings(sessionId, code, { baseScore });
  }

  addBot(sessionId: string, code: string): RoomSettingsResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
    if (room.mode !== "FRIEND" || room.stage !== "WAITING") return "ACTION_NOT_AVAILABLE";
    const seat = SEATS.find((candidate) => room.seats[candidate].controller === "EMPTY");
    if (seat === undefined) return "ACTION_NOT_AVAILABLE";

    room.seats[seat] = botSeat(seat);
    room.readySessionIds = [];
    room.version += 1;
    this.save(room);
    return room;
  }

  removeBot(sessionId: string, code: string, seat: Seat): RoomSettingsResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
    if (
      room.mode !== "FRIEND" ||
      room.stage !== "WAITING" ||
      room.seats[seat].controller !== "BOT"
    ) {
      return "ACTION_NOT_AVAILABLE";
    }

    room.seats[seat] = emptySeat(seat);
    room.readySessionIds = [];
    room.version += 1;
    this.save(room);
    return room;
  }

  createChatMessage(sessionId: string, code: string, message: string): ChatMessageResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    const seat = sessionSeat(room, sessionId);
    if (seat === null) return "NOT_A_MEMBER";
    if (room.mode !== "FRIEND" || room.stage !== "PLAYING") {
      return "ACTION_NOT_AVAILABLE";
    }
    return {
      id: randomUUID(),
      roomId: room.id,
      senderSeat: seat,
      nickname: room.seats[seat].nickname,
      message,
      sentAt: new Date().toISOString(),
    };
  }

  requestDissolve(sessionId: string, code: string): RoomState | "FORBIDDEN" | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode === "MATCH" || room.ownerSessionId !== sessionId) {
      return "FORBIDDEN";
    }
    this.closeRoom(room, "OWNER_DISSOLVED");
    room.version += 1;
    this.save(room);
    return room;
  }

  leaveRoom(sessionId: string, code: string): RoomState | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    const seat = sessionSeat(room, sessionId);
    const waitingIndex = spectatorIndex(room, sessionId);
    if (seat === null && waitingIndex < 0) return room;

    room.readySessionIds = room.readySessionIds.filter((id) => id !== sessionId);
    if (room.mode === "MATCH") {
      if (seat === null) return room;
      const controller = room.seats[seat];
      if (controller.controller === "TRUSTEE" && !controller.connected) return room;
      controller.controller = "TRUSTEE";
      controller.connected = false;
      room.version += 1;
      this.refreshDeadline(room);
      this.save(room);
      return room;
    }
    if (room.mode === "BOT" && seat !== null) {
      this.closeRoom(room, "EMPTY_ROOM");
      room.version += 1;
      this.save(room);
      return room;
    }

    if (seat !== null) {
      room.seats[seat] = room.stage === "WAITING" ? emptySeat(seat) : botSeat(seat);
    } else {
      room.spectators.splice(waitingIndex, 1);
    }
    if (room.ownerSessionId === sessionId) {
      const candidates = memberHumanSessionIds(room);
      const nextOwner = candidates[randomInt(Math.max(candidates.length, 1))];
      if (nextOwner === undefined) {
        this.closeRoom(room, "EMPTY_ROOM");
      } else {
        room.ownerSessionId = nextOwner;
      }
    }
    room.version += 1;
    this.refreshDeadline(room);
    this.save(room);
    return room;
  }

  private projectCompetitiveSettlement(
    room: RoomState,
    sessionId: string,
  ): {
    matchId: string;
    ruleVersion: number;
    originRoomCode: string | null;
    self: CompetitiveRankTransition;
    beforeRankDisplay: ReturnType<typeof formatRankLevel>;
    afterRankDisplay: ReturnType<typeof formatRankLevel>;
  } | null {
    if (room.mode !== "MATCH" || room.competitiveMatch === null) return null;
    const settlement: CompetitiveMatchSettlement | null =
      this.database.getCompetitiveMatchSettlement(room.competitiveMatch.matchId);
    if (settlement?.match.status !== "SETTLED" || settlement.match.resultJson === null) return null;
    let result: unknown;
    try {
      result = JSON.parse(settlement.match.resultJson) as unknown;
    } catch {
      throw new Error(`Competitive match ${settlement.match.id} has invalid result JSON`);
    }
    if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
    const transition = competitiveRankTransitionSchema.safeParse(
      (result as Record<string, unknown>)[sessionId],
    );
    return transition.success
      ? {
          matchId: room.competitiveMatch.matchId,
          ruleVersion: room.competitiveMatch.ruleVersion,
          originRoomCode: this.resolveOriginRoomCode(room.competitiveMatch.matchId, sessionId),
          self: transition.data,
          beforeRankDisplay: formatRankLevel(transition.data.beforeRankLevel),
          afterRankDisplay: formatRankLevel(transition.data.afterRankLevel),
        }
      : null;
  }

  setRoomConnected(
    sessionId: string,
    roomId: string,
    connected: boolean,
  ): { roomId: string; version: number } | null {
    const room = this.getRoomById(roomId);
    if (room?.status !== "ACTIVE") return null;
    const seat = sessionSeat(room, sessionId);
    const waitingIndex = spectatorIndex(room, sessionId);
    if (seat === null && waitingIndex < 0) return null;
    if (seat !== null) {
      const controller = room.seats[seat];
      const nextController = room.stage === "WAITING" ? "HUMAN" : connected ? "HUMAN" : "TRUSTEE";
      if (controller.connected === connected && controller.controller === nextController)
        return null;
      controller.connected = connected;
      controller.controller = nextController;
    } else {
      const spectator = room.spectators[waitingIndex];
      if (spectator === undefined || spectator.connected === connected) return null;
      spectator.connected = connected;
    }
    room.version += 1;
    this.refreshDeadline(room);
    this.save(room);
    return { roomId: room.id, version: room.version };
  }

  setConnected(sessionId: string, connected: boolean): { roomId: string; version: number }[] {
    return [...this.roomsByCode.values()].flatMap((room) => {
      const update = this.setRoomConnected(sessionId, room.id, connected);
      return update === null ? [] : [update];
    });
  }

  private currentTeamCompetitiveMatch(
    room: RoomState,
  ): { match: { id: string; roomId: string } } | null {
    if (room.mode !== "TEAM_MATCH") return null;
    for (const memberSessionId of humanSessionIds(room)) {
      const current = this.database.getCurrentCompetitiveMatch(memberSessionId);
      if (current !== null) return current;
    }
    return null;
  }

  private projectTeamMatchmaking(room: RoomState): TeamMatchmakingProjection | null {
    if (room.mode !== "TEAM_MATCH") return null;
    const current = this.currentTeamCompetitiveMatch(room);
    if (current !== null) {
      return {
        status: "MATCHED",
        matchId: current.match.id,
        roomId: current.match.roomId,
      };
    }
    const entries = this.database.listMatchmakingPartyEntries(room.id);
    const first = entries[0];
    if (first !== undefined) {
      return {
        status: "QUEUED",
        enqueuedAt: first.enqueuedAt,
        memberCount: entries.length,
      };
    }
    return { status: "IDLE" };
  }

  project(room: RoomState, sessionId: string): RoomProjection {
    const selfSeat = sessionSeat(room, sessionId);
    const round = room.round;
    const competitiveSessionIds = SEATS.flatMap((seat) => {
      const controller = room.seats[seat];
      return controller.sessionId === null ? [] : [controller.sessionId];
    });
    const publicIds = new Map(
      this.database
        .findSessionsByIds([
          ...competitiveSessionIds,
          ...room.spectators.map((spectator) => spectator.sessionId),
        ])
        .map((session) => [session.id, session.playerId ?? null] as const),
    );
    const competitiveProfiles = new Map(
      this.database
        .getPublicCompetitiveProfiles(competitiveSessionIds)
        .map((profile) => [profile.sessionId, profile] as const),
    );
    const profileForSeat = (seat: Seat): PublicCompetitiveProfile | null => {
      const seatSessionId = room.seats[seat].sessionId;
      return seatSessionId === null
        ? null
        : projectCompetitiveProfile(competitiveProfiles.get(seatSessionId));
    };
    const presentationRound =
      room.pendingEffectTransition?.cue.action === "PONG"
        ? room.pendingEffectTransition.nextRound
        : round;
    const selfDrawnTileId =
      room.stage === "PLAYING" &&
      selfSeat !== null &&
      presentationRound?.phase === "TURN_DECISION" &&
      presentationRound.lastDrawSeat === selfSeat &&
      presentationRound.players[selfSeat].hand.some(
        (tile) => tile.id === presentationRound.lastDrawnTileId,
      )
        ? presentationRound.lastDrawnTileId
        : null;
    const players =
      presentationRound === null
        ? []
        : SEATS.map((seat) => {
            const controller = room.seats[seat];
            const roundPlayer = presentationRound.players[seat];
            const playerController: PlayerController =
              controller.controller === "EMPTY" ? "BOT" : controller.controller;
            return {
              seat,
              nickname: controller.nickname,
              playerId:
                controller.sessionId === null
                  ? null
                  : (publicIds.get(controller.sessionId) ?? null),
              avatarUrl: controller.avatarUrl,
              controller: playerController,
              connected: controller.connected,
              handCount: roundPlayer.hand.length,
              hand: selfSeat === seat ? roundPlayer.hand : null,
              melds: roundPlayer.melds,
              discards: roundPlayer.discards,
              releasedWildcards: roundPlayer.releasedWildcards,
              personalMultiplier: roundPlayer.personalMultiplier,
              score: roundPlayer.score,
              competitiveProfile: profileForSeat(seat),
            };
          });
    const legalActions =
      room.stage !== "PLAYING" ||
      selfSeat === null ||
      round === null ||
      room.pendingEffectTransition !== null ||
      (room.mode === "MATCH" && room.seats[selfSeat].controller !== "HUMAN")
        ? []
        : round.phase === "DISCARD_RESPONSE" && round.pendingResponse?.seat === selfSeat
          ? [...round.pendingResponse.actions, "PASS_RESPONSE"]
          : availableTurnActions(round, selfSeat);
    const roundSettlement: RoundSettlementProjection | null =
      round?.outcome === null || round === null
        ? null
        : {
            roundId: round.id,
            kind: round.outcome.kind,
            winnerSeat: round.outcome.kind === "WIN" ? round.outcome.winnerSeat : null,
            winType: round.outcome.kind === "WIN" ? round.outcome.winType : null,
            baseScore: round.baseScore,
            winBaseMultiplier:
              round.outcome.kind === "WIN" ? (round.outcome.winType === "HARD" ? 2 : 1) : null,
            winnerMultiplier:
              round.outcome.kind === "WIN"
                ? competitiveMultiplier(
                    (round.outcome.winType === "HARD" ? 2 : 1) *
                      (round.outcome.laiyou ? 2 : 1) *
                      round.players[round.outcome.winnerSeat].personalMultiplier,
                  )
                : null,
            laiyou: round.outcome.kind === "WIN" && round.outcome.laiyou,
            laiyouMultiplier: round.outcome.kind === "WIN" ? (round.outcome.laiyou ? 2 : 1) : null,
            nextDealerSeat: round.outcome.nextDealerSeat,
            payments:
              round.outcome.kind === "WIN"
                ? round.outcome.scoreDeltas.flatMap((delta) =>
                    delta.delta < 0
                      ? [
                          {
                            payerSeat: delta.seat,
                            payerMultiplier: round.players[delta.seat].personalMultiplier,
                            payerEffectiveMultiplier: competitiveMultiplier(
                              -delta.delta / round.baseScore,
                            ),
                            amount: -delta.delta,
                          },
                        ]
                      : [],
                  )
                : [],
            finalHands: SEATS.map((seat) => ({
              seat,
              tiles: round.players[seat].hand,
              personalMultiplier: round.players[seat].personalMultiplier,
            })),
            scoreChanges: SEATS.map((seat) => ({
              seat,
              roundDelta: round.players[seat].score - round.startingScores[seat],
              totalScore: round.players[seat].score,
            })),
            competitiveSettlement: this.projectCompetitiveSettlement(room, sessionId),
          };
    const roundOutcome =
      round?.outcome === null || round === null
        ? null
        : round.outcome.kind === "WIN"
          ? {
              kind: "WIN" as const,
              winnerSeat: round.outcome.winnerSeat,
              winType: round.outcome.winType,
              laiyou: round.outcome.laiyou,
              nextDealerSeat: round.outcome.nextDealerSeat,
            }
          : { kind: "DRAW" as const, nextDealerSeat: round.outcome.nextDealerSeat };
    const tingHints =
      room.stage === "PLAYING" && round !== null
        ? projectTingHints({ round, selfSeat, legalActions })
        : [];

    return {
      schemaVersion: 10,
      roomId: room.id,
      roomCode: room.code,
      version: room.version,
      baseScore: room.baseScore,
      turnTimeoutSeconds: room.turnTimeoutSeconds,
      botDifficulty: room.botDifficulty,
      mode: room.mode,
      competitiveMatch:
        room.mode === "MATCH" && room.competitiveMatch !== null
          ? {
              ...room.competitiveMatch,
              originRoomCode: this.resolveOriginRoomCode(room.competitiveMatch.matchId, sessionId),
            }
          : null,
      teamMatchmaking: this.projectTeamMatchmaking(room),
      stage: room.stage,
      roundId: round?.id ?? null,
      roundStartedAt: room.roundStartedAt,
      waitingExpiresAt: room.waitingExpiresAt,
      isOwner: room.ownerSessionId === sessionId,
      selfRole: selfSeat === null ? "SPECTATOR" : "PLAYER",
      selfReady: room.readySessionIds.includes(sessionId),
      selfSeat,
      selfDrawnTileId,
      scoreResetPending: scoreResetPending(room),
      status: room.status,
      closeReason: room.closeReason,
      dissolveAfterRound: room.dissolveAfterRound,
      indicatorTile: presentationRound?.indicatorTile ?? null,
      wildcardKind: presentationRound?.wildcardKind ?? null,
      wallRemaining: presentationRound?.wall.length ?? 0,
      actingSeat: this.actingSeat(room),
      currentSeat: room.stage === "PLAYING" ? (presentationRound?.currentSeat ?? null) : null,
      roundPhase: presentationRound?.phase ?? null,
      actionDeadlineAt: room.stage === "PLAYING" ? room.actionDeadlineAt : null,
      roundOutcome,
      roundSettlement,
      effectCue: room.pendingEffectTransition?.cue ?? null,
      legalActions,
      tingHints,
      players,
      lobbySeats: SEATS.map((seat) => {
        const controller = room.seats[seat];
        const occupied = controller.controller !== "EMPTY";
        return {
          seat,
          controller:
            controller.controller === "EMPTY"
              ? null
              : controller.controller === "BOT"
                ? "BOT"
                : "HUMAN",
          nickname: occupied ? controller.nickname : null,
          playerId:
            controller.sessionId === null ? null : (publicIds.get(controller.sessionId) ?? null),
          avatarUrl: occupied ? controller.avatarUrl : null,
          occupied,
          ready:
            controller.controller === "BOT" ||
            (controller.sessionId !== null && room.readySessionIds.includes(controller.sessionId)),
          connected: occupied && controller.connected,
          isOwner: controller.sessionId === room.ownerSessionId,
          isSelf: controller.sessionId === sessionId,
          score: round?.players[seat].score ?? room.scores[seat],
          competitiveProfile: profileForSeat(seat),
        };
      }),
      spectators: room.spectators.map((spectator) => ({
        nickname: spectator.nickname,
        playerId: publicIds.get(spectator.sessionId) ?? null,
        avatarUrl: spectator.avatarUrl,
        connected: spectator.connected,
        isSelf: spectator.sessionId === sessionId,
      })),
    };
  }

  execute(sessionId: string, command: CommandEnvelope): CommandResult {
    const previous = this.database.getProcessedRequest(sessionId, command.requestId);
    if (previous !== null) return JSON.parse(previous) as CommandResult;
    const room = [...this.roomsByCode.values()].find(
      (candidate) => candidate.id === command.roomId,
    );
    if (room === undefined) return this.storeRejected(sessionId, command, 0, "ROOM_NOT_FOUND");
    if (command.expectedVersion !== room.version) {
      return this.storeRejected(sessionId, command, room.version, "VERSION_CONFLICT");
    }
    const seat = sessionSeat(room, sessionId);
    if (seat === null) return this.storeRejected(sessionId, command, room.version, "NOT_A_MEMBER");
    if (room.pendingEffectTransition !== null) {
      return this.storeRejected(sessionId, command, room.version, "ACTION_NOT_AVAILABLE");
    }
    const round = room.round;
    if (room.stage !== "PLAYING" || round === null) {
      return this.storeRejected(sessionId, command, room.version, "WRONG_PHASE");
    }
    if (command.roundId !== null && command.roundId !== round.id) {
      return this.storeRejected(sessionId, command, room.version, "WRONG_PHASE");
    }
    if (room.mode === "MATCH" && room.seats[seat].controller !== "HUMAN") {
      return this.storeRejected(sessionId, command, room.version, "ACTION_NOT_AVAILABLE");
    }
    const workingRound = structuredClone(round);
    let result: RuleResult;
    switch (command.type) {
      case "DECLARE_WIN":
        result = declareWin(workingRound, seat);
        break;
      case "CONTINUE_TURN":
        result = continueTurn(workingRound, seat);
        break;
      case "RELEASE_WILDCARD": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : releaseWildcard(workingRound, seat, tileId);
        break;
      }
      case "DISCARD_TILE": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : discardTile(workingRound, seat, tileId);
        break;
      }
      case "CLAIM_PONG":
        result = claimPong(workingRound, seat);
        break;
      case "CLAIM_EXPOSED_KONG":
        result = claimExposedKong(workingRound, seat);
        break;
      case "CLAIM_INDICATOR_PONG_KONG":
        result = claimIndicatorPongKong(workingRound, seat);
        break;
      case "DECLARE_CONCEALED_KONG": {
        const kind = tileKindField(command.payload);
        result =
          kind === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareConcealedKong(workingRound, seat, kind);
        break;
      }
      case "DECLARE_ADDED_KONG": {
        const meldId = stringField(command.payload, "meldId");
        const tileId = stringField(command.payload, "tileId");
        result =
          meldId === null || tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareAddedKong(workingRound, seat, meldId, tileId);
        break;
      }
      case "PASS_RESPONSE":
        result = passResponse(workingRound, seat);
        break;
      case "REQUEST_DISSOLVE_AFTER_ROUND":
      case "LEAVE_ROOM":
      case "SET_READY":
        return this.storeRejected(sessionId, command, room.version, "USE_HTTP_ROOM_ACTION");
    }
    if (!result.ok) return this.storeRejected(sessionId, command, room.version, result.code);
    const response: CommandResult = {
      accepted: true,
      requestId: command.requestId,
      serverVersion: room.version + 1,
      errorCode: null,
      message: null,
    };
    const committed = this.commitAcceptedRule(room, result, {
      processedRequest: {
        sessionId,
        requestId: command.requestId,
        resultJson: JSON.stringify(response),
      },
    });
    if (!committed) throw new Error("Accepted rule transition was not committed");
    return response;
  }

  private storeRejected(
    sessionId: string,
    command: Pick<CommandEnvelope, "requestId">,
    serverVersion: number,
    errorCode: string,
  ): CommandResult {
    const response: CommandResult = {
      accepted: false,
      requestId: command.requestId,
      serverVersion,
      errorCode,
      message: null,
    };
    this.database.saveProcessedRequest(sessionId, command.requestId, JSON.stringify(response));
    return response;
  }
}
