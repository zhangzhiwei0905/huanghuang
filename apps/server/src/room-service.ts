import {
  analyzeDiscardTingOptions,
  availableTurnActions,
  chooseBotAction,
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
  PlayerController,
  RoomMode,
  RoomCloseReason,
  RoomProjection,
  RoomStage,
  RoundSettlementProjection,
  Seat,
  TileKind,
  TurnTimeoutSeconds,
} from "@huanghuang/protocol";
import { DEFAULT_BOT_DIFFICULTY, DEFAULT_TURN_TIMEOUT_SECONDS } from "@huanghuang/protocol";
import { randomInt, randomUUID } from "node:crypto";
import type { AnonymousSession, GameDatabase } from "./database.js";

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
  nextDealerSeat?: Seat;
  round: RoundState | null;
  roundStartedAt?: string | null;
  waitingExpiresAt?: string | null;
  actionDeadlineAt?: string | null;
  nextRoundAt?: string | null;
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
  nextDealerSeat: Seat;
  round: RoundState | null;
  roundStartedAt: string | null;
  waitingExpiresAt: string | null;
  actionDeadlineAt: string | null;
  nextRoundAt: string | null;
};

export type JoinRoomResult = RoomState | "ROOM_FULL" | "ROOM_NOT_JOINABLE" | null;
export type RoomActionResult = RoomState | "ACTION_NOT_AVAILABLE" | null;
export type RoomSettingsResult = RoomState | "ACTION_NOT_AVAILABLE" | "FORBIDDEN" | null;
export type ChatMessageResult =
  ChatMessageProjection | "ACTION_NOT_AVAILABLE" | "NOT_A_MEMBER" | null;

type CommandPayload = Record<string, unknown>;

const SEATS: readonly Seat[] = [0, 1, 2, 3];
const ZERO_SCORES: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

const randomIntFromCrypto = (max: number): number => randomInt(max);
const BOT_DELAY_MS = 650;
const RESPONSE_TIMEOUT_MS = 5_000;
const ROUND_RESULT_MS = 4_000;
export const WAITING_ROOM_TIMEOUT_MS = 3 * 60_000;
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

function roundScores(round: RoundState): Record<Seat, number> {
  return {
    0: round.players[0].score,
    1: round.players[1].score,
    2: round.players[2].score,
    3: round.players[3].score,
  };
}

function ensureStartingScores(round: RoundState): void {
  const legacyRound = round as Omit<RoundState, "startingScores"> & {
    startingScores?: Record<Seat, number>;
  };
  legacyRound.startingScores ??= roundScores(round);
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
    if (round !== null) ensureStartingScores(round);

    if (persisted.mode !== undefined) {
      const mode = persisted.mode;
      const stage =
        persisted.stage ??
        (round === null ? "WAITING" : round.phase === "ROUND_OVER" ? "ROUND_RESULT" : "PLAYING");
      const seats = structuredClone(persisted.seats);
      if (mode === "FRIEND" && stage === "WAITING") {
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
        nextDealerSeat:
          persisted.nextDealerSeat ??
          round?.outcome?.nextDealerSeat ??
          round?.dealerSeat ??
          (randomInt(4) as Seat),
        round: stage === "WAITING" ? null : round,
        roundStartedAt: persisted.roundStartedAt ?? null,
        waitingExpiresAt:
          mode === "FRIEND" && stage === "WAITING"
            ? (persisted.waitingExpiresAt ??
              new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString())
            : null,
        actionDeadlineAt: persisted.actionDeadlineAt ?? null,
        nextRoundAt: persisted.nextRoundAt ?? null,
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
        nextDealerSeat: randomInt(4) as Seat,
        round: null,
        roundStartedAt: null,
        waitingExpiresAt: new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString(),
        actionDeadlineAt: null,
        nextRoundAt: null,
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
      nextDealerSeat: round?.outcome?.nextDealerSeat ?? round?.dealerSeat ?? (randomInt(4) as Seat),
      round,
      roundStartedAt: null,
      waitingExpiresAt: null,
      actionDeadlineAt: persisted.actionDeadlineAt ?? null,
      nextRoundAt: persisted.nextRoundAt ?? null,
    };
  }

  private actingSeat(room: RoomState): Seat | null {
    const round = room.round;
    if (room.stage !== "PLAYING" || round === null) return null;
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
    room.actionDeadlineAt = null;
    room.nextRoundAt = null;
    room.waitingExpiresAt = null;
    this.closedRoomEvictionAt.set(room.code, now + CLOSED_ROOM_EVICTION_MS);
  }

  private acceptRule(room: RoomState, result: RuleResult): boolean {
    if (!result.ok || room.round === null) return false;
    room.round = result.state;
    room.version += 1;
    this.refreshDeadline(room);
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
      if (room.stage === "WAITING") {
        if (
          room.mode === "FRIEND" &&
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
        }
        continue;
      }
      if (room.actionDeadlineAt === null || Date.parse(room.actionDeadlineAt) > now) continue;
      const seat = this.actingSeat(room);
      if (seat === null) continue;
      const changed = this.acceptRule(room, this.automaticAction(room, seat));
      if (!changed) this.refreshDeadline(room, now);
      this.save(room);
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
    mode: RoomMode,
    turnTimeoutSeconds: TurnTimeoutSeconds = DEFAULT_TURN_TIMEOUT_SECONDS,
    botDifficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  ): RoomState {
    const room: RoomState = {
      id: randomUUID(),
      code: this.nextRoomCode(),
      ownerSessionId: session.id,
      baseScore,
      turnTimeoutSeconds,
      botDifficulty,
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      closeReason: null,
      mode,
      stage: mode === "FRIEND" ? "WAITING" : "PLAYING",
      seats: {
        0: humanSeat(0, session),
        1: mode === "FRIEND" ? emptySeat(1) : botSeat(1),
        2: mode === "FRIEND" ? emptySeat(2) : botSeat(2),
        3: mode === "FRIEND" ? emptySeat(3) : botSeat(3),
      },
      readySessionIds: [],
      spectators: [],
      scores: { ...ZERO_SCORES },
      nextDealerSeat: randomInt(4) as Seat,
      round: null,
      roundStartedAt: null,
      waitingExpiresAt:
        mode === "FRIEND" ? new Date(Date.now() + WAITING_ROOM_TIMEOUT_MS).toISOString() : null,
      actionDeadlineAt: null,
      nextRoundAt: null,
    };
    if (mode === "BOT") this.startRound(room);
    this.roomsByCode.set(room.code, room);
    this.save(room);
    return room;
  }

  joinRoom(session: AnonymousSession, code: string): JoinRoomResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (sessionSeat(room, session.id) !== null) return room;
    if (spectatorIndex(room, session.id) >= 0) return room;
    if (room.mode !== "FRIEND") return "ROOM_NOT_JOINABLE";

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
    if (room.mode !== "FRIEND" || room.stage !== "WAITING") return "ACTION_NOT_AVAILABLE";
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
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
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

  setConnected(sessionId: string, connected: boolean): { roomId: string; version: number }[] {
    const updates: { roomId: string; version: number }[] = [];
    for (const room of this.roomsByCode.values()) {
      if (room.status !== "ACTIVE") continue;
      const seat = sessionSeat(room, sessionId);
      const waitingIndex = spectatorIndex(room, sessionId);
      if (seat === null && waitingIndex < 0) continue;
      if (seat !== null) {
        const controller = room.seats[seat];
        const nextController = room.stage === "WAITING" ? "HUMAN" : connected ? "HUMAN" : "TRUSTEE";
        if (controller.connected === connected && controller.controller === nextController) {
          continue;
        }
        controller.connected = connected;
        controller.controller = nextController;
      } else {
        const spectator = room.spectators[waitingIndex];
        if (spectator === undefined || spectator.connected === connected) continue;
        spectator.connected = connected;
      }
      room.version += 1;
      this.refreshDeadline(room);
      this.save(room);
      updates.push({ roomId: room.id, version: room.version });
    }
    return updates;
  }

  project(room: RoomState, sessionId: string): RoomProjection {
    const selfSeat = sessionSeat(room, sessionId);
    const round = room.round;
    const selfDrawnTileId =
      room.stage === "PLAYING" &&
      selfSeat !== null &&
      round?.phase === "TURN_DECISION" &&
      round.lastDrawSeat === selfSeat &&
      round.players[selfSeat].hand.some((tile) => tile.id === round.lastDrawnTileId)
        ? round.lastDrawnTileId
        : null;
    const players =
      round === null
        ? []
        : SEATS.map((seat) => {
            const controller = room.seats[seat];
            const roundPlayer = round.players[seat];
            const playerController: PlayerController =
              controller.controller === "EMPTY" ? "BOT" : controller.controller;
            return {
              seat,
              nickname: controller.nickname,
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
            };
          });
    const legalActions =
      room.stage !== "PLAYING" || selfSeat === null || round === null
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
                ? round.players[round.outcome.winnerSeat].personalMultiplier
                : null,
            nextDealerSeat: round.outcome.nextDealerSeat,
            payments:
              round.outcome.kind === "WIN"
                ? round.outcome.scoreDeltas.flatMap((delta) =>
                    delta.delta < 0
                      ? [
                          {
                            payerSeat: delta.seat,
                            payerMultiplier: round.players[delta.seat].personalMultiplier,
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
          };
    const roundOutcome =
      round?.outcome === null || round === null
        ? null
        : round.outcome.kind === "WIN"
          ? {
              kind: "WIN" as const,
              winnerSeat: round.outcome.winnerSeat,
              winType: round.outcome.winType,
              nextDealerSeat: round.outcome.nextDealerSeat,
            }
          : { kind: "DRAW" as const, nextDealerSeat: round.outcome.nextDealerSeat };
    const tingHints =
      room.stage === "PLAYING" && round !== null
        ? projectTingHints({ round, selfSeat, legalActions })
        : [];

    return {
      schemaVersion: 5,
      roomId: room.id,
      roomCode: room.code,
      version: room.version,
      baseScore: room.baseScore,
      turnTimeoutSeconds: room.turnTimeoutSeconds,
      botDifficulty: room.botDifficulty,
      mode: room.mode,
      stage: room.stage,
      roundId: round?.id ?? null,
      roundStartedAt: room.roundStartedAt,
      waitingExpiresAt: room.waitingExpiresAt,
      isOwner: room.ownerSessionId === sessionId,
      selfRole: selfSeat === null ? "SPECTATOR" : "PLAYER",
      selfReady: room.readySessionIds.includes(sessionId),
      selfSeat,
      selfDrawnTileId,
      status: room.status,
      closeReason: room.closeReason,
      dissolveAfterRound: room.dissolveAfterRound,
      indicatorTile: round?.indicatorTile ?? null,
      wildcardKind: round?.wildcardKind ?? null,
      wallRemaining: round?.wall.length ?? 0,
      actingSeat: this.actingSeat(room),
      currentSeat: room.stage === "PLAYING" ? (round?.currentSeat ?? null) : null,
      roundPhase: round?.phase ?? null,
      actionDeadlineAt: room.stage === "PLAYING" ? room.actionDeadlineAt : null,
      roundOutcome,
      roundSettlement,
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
          avatarUrl: occupied ? controller.avatarUrl : null,
          occupied,
          ready:
            controller.controller === "BOT" ||
            (controller.sessionId !== null && room.readySessionIds.includes(controller.sessionId)),
          connected: occupied && controller.connected,
          isOwner: controller.sessionId === room.ownerSessionId,
          isSelf: controller.sessionId === sessionId,
          score: round?.players[seat].score ?? room.scores[seat],
        };
      }),
      spectators: room.spectators.map((spectator) => ({
        nickname: spectator.nickname,
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
    const round = room.round;
    if (room.stage !== "PLAYING" || round === null) {
      return this.storeRejected(sessionId, command, room.version, "WRONG_PHASE");
    }
    let result: RuleResult;
    switch (command.type) {
      case "DECLARE_WIN":
        result = declareWin(round, seat);
        break;
      case "CONTINUE_TURN":
        result = continueTurn(round, seat);
        break;
      case "RELEASE_WILDCARD": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : releaseWildcard(round, seat, tileId);
        break;
      }
      case "DISCARD_TILE": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : discardTile(round, seat, tileId);
        break;
      }
      case "CLAIM_PONG":
        result = claimPong(round, seat);
        break;
      case "CLAIM_EXPOSED_KONG":
        result = claimExposedKong(round, seat);
        break;
      case "CLAIM_INDICATOR_PONG_KONG":
        result = claimIndicatorPongKong(round, seat);
        break;
      case "DECLARE_CONCEALED_KONG": {
        const kind = tileKindField(command.payload);
        result =
          kind === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareConcealedKong(round, seat, kind);
        break;
      }
      case "DECLARE_ADDED_KONG": {
        const meldId = stringField(command.payload, "meldId");
        const tileId = stringField(command.payload, "tileId");
        result =
          meldId === null || tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareAddedKong(round, seat, meldId, tileId);
        break;
      }
      case "PASS_RESPONSE":
        result = passResponse(round, seat);
        break;
      case "REQUEST_DISSOLVE_AFTER_ROUND":
      case "LEAVE_ROOM":
      case "SET_READY":
        return this.storeRejected(sessionId, command, room.version, "USE_HTTP_ROOM_ACTION");
    }
    if (!result.ok) return this.storeRejected(sessionId, command, room.version, result.code);
    const nextRoom = structuredClone(room);
    this.acceptRule(nextRoom, result);
    const response: CommandResult = {
      accepted: true,
      requestId: command.requestId,
      serverVersion: nextRoom.version,
      errorCode: null,
      message: null,
    };
    this.database.saveRoomAndProcessedRequest(
      nextRoom,
      JSON.stringify(nextRoom),
      sessionId,
      command.requestId,
      JSON.stringify(response),
    );
    Object.assign(room, nextRoom);
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
