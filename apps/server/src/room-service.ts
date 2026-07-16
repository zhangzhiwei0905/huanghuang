import {
  availableTurnActions,
  claimExposedKong,
  claimIndicatorPongKong,
  claimPong,
  concealedKongKinds,
  continueTurn,
  createRound,
  declareAddedKong,
  declareConcealedKong,
  declareWin,
  discardTile,
  discardableTileIds,
  passResponse,
  releasableWildcardIds,
  releaseWildcard,
  sameTileKind,
  type RoundState,
  type RuleResult,
} from "@huanghuang/game-engine";
import type {
  BaseScore,
  CommandEnvelope,
  CommandResult,
  PlayerController,
  RoomMode,
  RoomProjection,
  RoomStage,
  RoundSettlementProjection,
  Seat,
  TileKind,
} from "@huanghuang/protocol";
import { randomInt, randomUUID } from "node:crypto";
import type { AnonymousSession, GameDatabase } from "./database.js";

type SeatController = {
  seat: Seat;
  sessionId: string | null;
  nickname: string;
  controller: PlayerController | "EMPTY";
  connected: boolean;
};

type LegacyWaitingHuman = {
  sessionId: string;
  nickname: string;
  ready: boolean;
  joinedAt: string;
};

type PersistedRoomState = {
  id: string;
  code: string;
  ownerSessionId: string;
  baseScore: BaseScore;
  status: "ACTIVE" | "CLOSED";
  version: number;
  dissolveAfterRound: boolean;
  seats: Record<Seat, SeatController>;
  waitingHumans?: LegacyWaitingHuman[];
  readySessionIds?: string[];
  mode?: RoomMode;
  stage?: RoomStage;
  scores?: Record<Seat, number>;
  nextDealerSeat?: Seat;
  round: RoundState | null;
  roundStartedAt?: string | null;
  actionDeadlineAt?: string | null;
  nextRoundAt?: string | null;
};

export type RoomState = {
  id: string;
  code: string;
  ownerSessionId: string;
  baseScore: BaseScore;
  status: "ACTIVE" | "CLOSED";
  version: number;
  dissolveAfterRound: boolean;
  mode: RoomMode;
  stage: RoomStage;
  seats: Record<Seat, SeatController>;
  readySessionIds: string[];
  scores: Record<Seat, number>;
  nextDealerSeat: Seat;
  round: RoundState | null;
  roundStartedAt: string | null;
  actionDeadlineAt: string | null;
  nextRoundAt: string | null;
};

export type JoinRoomResult = RoomState | "ROOM_FULL" | "ROOM_NOT_JOINABLE" | null;
export type RoomActionResult = RoomState | "ACTION_NOT_AVAILABLE" | null;

type CommandPayload = Record<string, unknown>;

const SEATS: readonly Seat[] = [0, 1, 2, 3];
const ZERO_SCORES: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

const randomIntFromCrypto = (max: number): number => randomInt(max);
const BOT_DELAY_MS = 650;
const TURN_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 5_000;
const ROUND_RESULT_MS = 4_000;

function emptySeat(seat: Seat): SeatController {
  return {
    seat,
    sessionId: null,
    nickname: "等待加入",
    controller: "EMPTY",
    connected: false,
  };
}

function botSeat(seat: Seat): SeatController {
  return {
    seat,
    sessionId: null,
    nickname: `机器人 ${seat}`,
    controller: "BOT",
    connected: true,
  };
}

function humanSeat(
  seat: Seat,
  session: Pick<AnonymousSession, "id" | "nickname">,
  connected = true,
): SeatController {
  return {
    seat,
    sessionId: session.id,
    nickname: session.nickname,
    controller: "HUMAN",
    connected,
  };
}

function sessionSeat(room: RoomState, sessionId: string): Seat | null {
  return SEATS.find((seat) => room.seats[seat].sessionId === sessionId) ?? null;
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

export class RoomService {
  private readonly roomsByCode = new Map<string, RoomState>();

  constructor(private readonly database: GameDatabase) {
    for (const json of this.database.loadActiveRooms()) {
      const room = this.normalizeRoom(JSON.parse(json) as PersistedRoomState);
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
          if (seats[seat].sessionId === null) seats[seat] = emptySeat(seat);
        }
      }
      return {
        id: persisted.id,
        code: persisted.code,
        ownerSessionId: persisted.ownerSessionId,
        baseScore: persisted.baseScore,
        status: persisted.status,
        version: persisted.version,
        dissolveAfterRound: persisted.dissolveAfterRound,
        mode,
        stage,
        seats,
        readySessionIds: persisted.readySessionIds ?? [],
        scores: persisted.scores ?? (round === null ? { ...ZERO_SCORES } : roundScores(round)),
        nextDealerSeat:
          persisted.nextDealerSeat ??
          round?.outcome?.nextDealerSeat ??
          round?.dealerSeat ??
          (randomInt(4) as Seat),
        round: stage === "WAITING" ? null : round,
        roundStartedAt: persisted.roundStartedAt ?? null,
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
        status: persisted.status,
        version: persisted.version,
        dissolveAfterRound: persisted.dissolveAfterRound,
        mode: "FRIEND",
        stage: "WAITING",
        seats,
        readySessionIds: persisted.readySessionIds ?? [],
        scores: { ...ZERO_SCORES },
        nextDealerSeat: randomInt(4) as Seat,
        round: null,
        roundStartedAt: null,
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
      status: persisted.status,
      version: persisted.version,
      dissolveAfterRound: persisted.dissolveAfterRound,
      mode,
      stage,
      seats: structuredClone(persisted.seats),
      readySessionIds: persisted.readySessionIds ?? [],
      scores: round === null ? { ...ZERO_SCORES } : roundScores(round),
      nextDealerSeat: round?.outcome?.nextDealerSeat ?? round?.dealerSeat ?? (randomInt(4) as Seat),
      round,
      roundStartedAt: null,
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
          : TURN_TIMEOUT_MS;
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
    room.nextRoundAt = null;
    this.refreshDeadline(room, now);
  }

  private enterWaiting(room: RoomState): void {
    this.syncRoundResult(room);
    room.stage = "WAITING";
    room.round = null;
    room.readySessionIds = [];
    room.roundStartedAt = null;
    room.actionDeadlineAt = null;
    room.nextRoundAt = null;
    for (const seat of SEATS) {
      if (room.seats[seat].sessionId === null) room.seats[seat] = emptySeat(seat);
    }
  }

  private acceptRule(room: RoomState, result: RuleResult): boolean {
    if (!result.ok || room.round === null) return false;
    room.round = result.state;
    room.version += 1;
    this.refreshDeadline(room);
    return true;
  }

  private automaticAction(room: RoomState, seat: Seat, isBot: boolean): RuleResult {
    const round = room.round;
    if (round === null) return { ok: false, code: "WRONG_PHASE" };
    if (round.phase === "DISCARD_RESPONSE") {
      const actions = round.pendingResponse?.actions ?? [];
      if (isBot) {
        if (actions.includes("CLAIM_INDICATOR_PONG_KONG"))
          return claimIndicatorPongKong(round, seat);
        if (actions.includes("CLAIM_EXPOSED_KONG")) return claimExposedKong(round, seat);
        if (actions.includes("CLAIM_PONG")) return claimPong(round, seat);
      }
      return passResponse(round, seat);
    }

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
    if (isBot && actions.includes("DECLARE_CONCEALED_KONG")) {
      const kind = concealedKongKinds({
        hand: player.hand,
        wildcardKind: round.wildcardKind,
        wallRemaining: round.wall.length,
      })[0];
      if (kind !== undefined) return declareConcealedKong(round, seat, kind);
    }
    if (isBot && actions.includes("DECLARE_ADDED_KONG")) {
      const meld = player.melds.find((candidate) => candidate.kind === "PONG");
      const tile =
        meld === undefined
          ? undefined
          : player.hand.find((candidate) => sameTileKind(candidate, meld.tileKind));
      if (meld !== undefined && tile !== undefined)
        return declareAddedKong(round, seat, meld.id, tile.id);
    }
    const legalDiscards = discardableTileIds(player.hand, round.wildcardKind);
    const tileId = legalDiscards.includes(round.lastDrawnTileId)
      ? round.lastDrawnTileId
      : legalDiscards[randomInt(Math.max(legalDiscards.length, 1))];
    return tileId === undefined
      ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
      : discardTile(round, seat, tileId);
  }

  tick(now = Date.now()): { roomId: string; version: number }[] {
    const updates: { roomId: string; version: number }[] = [];
    for (const room of this.roomsByCode.values()) {
      if (room.status !== "ACTIVE") continue;
      if (room.stage === "ROUND_RESULT") {
        if (
          room.mode === "FRIEND" &&
          room.nextRoundAt !== null &&
          Date.parse(room.nextRoundAt) <= now
        ) {
          if (room.dissolveAfterRound) {
            room.status = "CLOSED";
          } else {
            this.enterWaiting(room);
          }
          room.version += 1;
          this.save(room);
          updates.push({ roomId: room.id, version: room.version });
        }
        continue;
      }
      if (room.stage !== "PLAYING") continue;
      if (room.actionDeadlineAt === null || Date.parse(room.actionDeadlineAt) > now) continue;
      const seat = this.actingSeat(room);
      if (seat === null) continue;
      const changed = this.acceptRule(
        room,
        this.automaticAction(room, seat, room.seats[seat].controller !== "HUMAN"),
      );
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
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      if (!this.roomsByCode.has(code)) return code;
    }
    throw new Error("Unable to allocate a unique room code");
  }

  createRoom(session: AnonymousSession, baseScore: BaseScore, mode: RoomMode): RoomState {
    const room: RoomState = {
      id: randomUUID(),
      code: this.nextRoomCode(),
      ownerSessionId: session.id,
      baseScore,
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      mode,
      stage: mode === "FRIEND" ? "WAITING" : "PLAYING",
      seats: {
        0: humanSeat(0, session),
        1: mode === "FRIEND" ? emptySeat(1) : botSeat(1),
        2: mode === "FRIEND" ? emptySeat(2) : botSeat(2),
        3: mode === "FRIEND" ? emptySeat(3) : botSeat(3),
      },
      readySessionIds: [],
      scores: { ...ZERO_SCORES },
      nextDealerSeat: randomInt(4) as Seat,
      round: null,
      roundStartedAt: null,
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
    if (room.mode !== "FRIEND" || room.stage !== "WAITING") return "ROOM_NOT_JOINABLE";
    const seat = SEATS.find((candidate) => room.seats[candidate].sessionId === null);
    if (seat === undefined) return "ROOM_FULL";
    room.seats[seat] = humanSeat(seat, session);
    room.version += 1;
    this.save(room);
    return room;
  }

  setReady(sessionId: string, code: string): RoomActionResult {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.mode !== "FRIEND" || room.stage !== "WAITING") return "ACTION_NOT_AVAILABLE";
    const seat = sessionSeat(room, sessionId);
    if (seat === null) return "ACTION_NOT_AVAILABLE";
    if (room.readySessionIds.includes(sessionId)) return room;

    room.readySessionIds.push(sessionId);
    const occupiedSessions = SEATS.map((candidate) => room.seats[candidate].sessionId);
    if (
      occupiedSessions.every((candidate): candidate is string => candidate !== null) &&
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

  requestDissolve(sessionId: string, code: string): RoomState | "FORBIDDEN" | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (room.ownerSessionId !== sessionId) return "FORBIDDEN";
    if (room.stage === "WAITING") {
      room.status = "CLOSED";
    } else {
      room.dissolveAfterRound = true;
      if (room.stage === "ROUND_RESULT" && room.mode === "FRIEND") {
        room.nextRoundAt = new Date().toISOString();
      }
    }
    room.version += 1;
    this.save(room);
    return room;
  }

  leaveRoom(sessionId: string, code: string): RoomState | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    const seat = sessionSeat(room, sessionId);
    if (seat === null) return room;

    room.readySessionIds = room.readySessionIds.filter((id) => id !== sessionId);
    if (room.mode === "BOT") {
      room.status = "CLOSED";
      room.version += 1;
      this.save(room);
      return room;
    }

    room.seats[seat] = room.stage === "WAITING" ? emptySeat(seat) : botSeat(seat);
    if (room.ownerSessionId === sessionId) {
      const candidates = SEATS.flatMap((candidateSeat) => {
        const candidate = room.seats[candidateSeat];
        return candidate.sessionId === null ? [] : [candidate.sessionId];
      });
      const nextOwner = candidates[randomInt(Math.max(candidates.length, 1))];
      if (nextOwner === undefined) {
        room.status = "CLOSED";
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
      if (seat === null) continue;
      const controller = room.seats[seat];
      const nextController = room.stage === "WAITING" ? "HUMAN" : connected ? "HUMAN" : "TRUSTEE";
      if (controller.connected === connected && controller.controller === nextController) continue;
      controller.connected = connected;
      controller.controller = nextController;
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

    return {
      schemaVersion: 2,
      roomId: room.id,
      roomCode: room.code,
      version: room.version,
      baseScore: room.baseScore,
      mode: room.mode,
      stage: room.stage,
      roundId: round?.id ?? null,
      roundStartedAt: room.roundStartedAt,
      isOwner: room.ownerSessionId === sessionId,
      selfReady: room.readySessionIds.includes(sessionId),
      selfSeat,
      selfDrawnTileId,
      status: room.status,
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
      players,
      lobbySeats: SEATS.map((seat) => {
        const controller = room.seats[seat];
        const occupied = controller.sessionId !== null;
        return {
          seat,
          nickname: occupied ? controller.nickname : null,
          occupied,
          ready:
            controller.sessionId !== null && room.readySessionIds.includes(controller.sessionId),
          connected: occupied && controller.connected,
          isOwner: controller.sessionId === room.ownerSessionId,
          isSelf: controller.sessionId === sessionId,
          score: round?.players[seat].score ?? room.scores[seat],
        };
      }),
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
