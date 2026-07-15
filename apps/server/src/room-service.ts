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
  RoomProjection,
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
  controller: PlayerController;
  connected: boolean;
};

type WaitingHuman = {
  sessionId: string;
  nickname: string;
  ready: boolean;
  joinedAt: string;
};

export type RoomState = {
  id: string;
  code: string;
  ownerSessionId: string;
  baseScore: BaseScore;
  status: "ACTIVE" | "CLOSED";
  version: number;
  dissolveAfterRound: boolean;
  seats: Record<Seat, SeatController>;
  waitingHumans: WaitingHuman[];
  readySessionIds: string[];
  round: RoundState;
  actionDeadlineAt: string | null;
  nextRoundAt: string | null;
};

type CommandPayload = Record<string, unknown>;

const SEATS: readonly Seat[] = [0, 1, 2, 3];

const randomIntFromCrypto = (max: number): number => randomInt(max);
const BOT_DELAY_MS = 650;
const TURN_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 5_000;
const ROUND_RESULT_MS = 4_000;

function sessionSeat(room: RoomState, sessionId: string): Seat | null {
  return SEATS.find((seat) => room.seats[seat].sessionId === sessionId) ?? null;
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
      const room = JSON.parse(json) as RoomState;
      const legacyRound = room.round as Omit<RoundState, "startingScores"> & {
        startingScores?: Record<Seat, number>;
      };
      legacyRound.startingScores ??= {
        0: room.round.players[0].score,
        1: room.round.players[1].score,
        2: room.round.players[2].score,
        3: room.round.players[3].score,
      };
      room.actionDeadlineAt ??= null;
      room.nextRoundAt ??= null;
      this.refreshDeadline(room);
      this.roomsByCode.set(room.code, room);
    }
  }

  private actingSeat(room: RoomState): Seat | null {
    if (room.round.phase === "TURN_DECISION") return room.round.currentSeat;
    if (room.round.phase === "DISCARD_RESPONSE") return room.round.pendingResponse?.seat ?? null;
    return null;
  }

  private refreshDeadline(room: RoomState, now = Date.now()): void {
    if (room.round.phase === "ROUND_OVER") {
      room.actionDeadlineAt = null;
      room.nextRoundAt = new Date(now + ROUND_RESULT_MS).toISOString();
      return;
    }
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
        : room.round.phase === "DISCARD_RESPONSE"
          ? RESPONSE_TIMEOUT_MS
          : TURN_TIMEOUT_MS;
    room.actionDeadlineAt = new Date(now + duration).toISOString();
  }

  private acceptRule(room: RoomState, result: RuleResult): boolean {
    if (!result.ok) return false;
    room.round = result.state;
    room.version += 1;
    this.refreshDeadline(room);
    return true;
  }

  private startNextRound(room: RoomState): void {
    const scores = Object.fromEntries(
      SEATS.map((seat) => [seat, room.round.players[seat].score]),
    ) as Record<Seat, number>;
    const nextDealerSeat = room.round.outcome?.nextDealerSeat ?? (randomInt(4) as Seat);
    room.round = createRound({
      id: randomUUID(),
      dealerSeat: nextDealerSeat,
      baseScore: room.baseScore,
      startingScores: scores,
      randomInt: randomIntFromCrypto,
    });
    room.version += 1;
    this.refreshDeadline(room);
  }

  private automaticAction(room: RoomState, seat: Seat, isBot: boolean): RuleResult {
    if (room.round.phase === "DISCARD_RESPONSE") {
      const actions = room.round.pendingResponse?.actions ?? [];
      if (isBot) {
        if (actions.includes("CLAIM_INDICATOR_PONG_KONG"))
          return claimIndicatorPongKong(room.round, seat);
        if (actions.includes("CLAIM_EXPOSED_KONG")) return claimExposedKong(room.round, seat);
        if (actions.includes("CLAIM_PONG")) return claimPong(room.round, seat);
      }
      return passResponse(room.round, seat);
    }

    const actions = availableTurnActions(room.round, seat);
    if (actions.includes("DECLARE_WIN")) return declareWin(room.round, seat);
    const player = room.round.players[seat];
    const wildcardIds = releasableWildcardIds({
      hand: player.hand,
      wildcardKind: room.round.wildcardKind,
      wallRemaining: room.round.wall.length,
    });
    if (wildcardIds.length >= 2) {
      const tileId = wildcardIds[0];
      if (tileId !== undefined) return releaseWildcard(room.round, seat, tileId);
    }
    if (isBot && actions.includes("DECLARE_CONCEALED_KONG")) {
      const kind = concealedKongKinds({
        hand: player.hand,
        wildcardKind: room.round.wildcardKind,
        wallRemaining: room.round.wall.length,
      })[0];
      if (kind !== undefined) return declareConcealedKong(room.round, seat, kind);
    }
    if (isBot && actions.includes("DECLARE_ADDED_KONG")) {
      const meld = player.melds.find((candidate) => candidate.kind === "PONG");
      const tile =
        meld === undefined
          ? undefined
          : player.hand.find((candidate) => sameTileKind(candidate, meld.tileKind));
      if (meld !== undefined && tile !== undefined)
        return declareAddedKong(room.round, seat, meld.id, tile.id);
    }
    const legalDiscards = discardableTileIds(player.hand, room.round.wildcardKind);
    const tileId = legalDiscards.includes(room.round.lastDrawnTileId)
      ? room.round.lastDrawnTileId
      : legalDiscards[randomInt(Math.max(legalDiscards.length, 1))];
    return tileId === undefined
      ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
      : discardTile(room.round, seat, tileId);
  }

  tick(now = Date.now()): { roomId: string; version: number }[] {
    const updates: { roomId: string; version: number }[] = [];
    for (const room of this.roomsByCode.values()) {
      if (room.status !== "ACTIVE") continue;
      if (room.round.phase === "ROUND_OVER") {
        if (room.nextRoundAt !== null && Date.parse(room.nextRoundAt) <= now) {
          if (room.dissolveAfterRound) {
            room.status = "CLOSED";
            room.version += 1;
          } else {
            this.startNextRound(room);
          }
          this.save(room);
          updates.push({ roomId: room.id, version: room.version });
        }
        continue;
      }
      if (room.actionDeadlineAt === null || Date.parse(room.actionDeadlineAt) > now) continue;
      const seat = this.actingSeat(room);
      if (seat === null) continue;
      const changed = this.acceptRule(
        room,
        this.automaticAction(room, seat, room.seats[seat].controller !== "HUMAN"),
      );
      if (!changed) {
        this.refreshDeadline(room, now);
      }
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

  createRoom(session: AnonymousSession, baseScore: BaseScore): RoomState {
    const id = randomUUID();
    const dealerSeat = randomInt(4) as Seat;
    const createController = (seat: Seat): SeatController =>
      seat === 0
        ? {
            seat,
            sessionId: session.id,
            nickname: session.nickname,
            controller: "HUMAN",
            connected: true,
          }
        : { seat, sessionId: null, nickname: `机器人 ${seat}`, controller: "BOT", connected: true };
    const room: RoomState = {
      id,
      code: this.nextRoomCode(),
      ownerSessionId: session.id,
      baseScore,
      status: "ACTIVE",
      version: 0,
      dissolveAfterRound: false,
      seats: {
        0: createController(0),
        1: createController(1),
        2: createController(2),
        3: createController(3),
      },
      waitingHumans: [],
      readySessionIds: [],
      round: createRound({
        id: randomUUID(),
        dealerSeat,
        baseScore,
        randomInt: randomIntFromCrypto,
      }),
      actionDeadlineAt: null,
      nextRoundAt: null,
    };
    this.refreshDeadline(room);
    this.roomsByCode.set(room.code, room);
    this.save(room);
    return room;
  }

  joinRoom(session: AnonymousSession, code: string): RoomState | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    if (sessionSeat(room, session.id) !== null) return room;
    const existing = room.waitingHumans.find((human) => human.sessionId === session.id);
    if (existing === undefined) {
      room.waitingHumans.push({
        sessionId: session.id,
        nickname: session.nickname,
        ready: false,
        joinedAt: new Date().toISOString(),
      });
      room.version += 1;
      this.save(room);
    }
    return room;
  }

  setReady(sessionId: string, code: string): RoomState | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    const activeSeat = sessionSeat(room, sessionId);
    if (activeSeat !== null) {
      if (!room.readySessionIds.includes(sessionId)) room.readySessionIds.push(sessionId);
    } else {
      const waiting = room.waitingHumans.find((human) => human.sessionId === sessionId);
      if (waiting === undefined) return null;
      waiting.ready = true;
      if (!room.readySessionIds.includes(sessionId)) room.readySessionIds.push(sessionId);
    }

    const humanSessions = [
      ...SEATS.map((seat) => room.seats[seat]).filter(
        (seat) => seat.sessionId !== null && seat.controller !== "BOT",
      ),
      ...room.waitingHumans,
    ];
    const readyHumans = humanSessions.filter((human) => {
      const id = "sessionId" in human ? human.sessionId : null;
      return id !== null && room.readySessionIds.includes(id);
    });
    if (readyHumans.length >= 4) {
      const humans = humanSessions
        .filter((human): human is typeof human & { sessionId: string } => human.sessionId !== null)
        .slice(0, 4);
      for (const seat of SEATS) {
        const human = humans[seat];
        if (human === undefined) break;
        room.seats[seat] = {
          seat,
          sessionId: human.sessionId,
          nickname: human.nickname,
          controller: "HUMAN",
          connected: true,
        };
      }
      room.waitingHumans = room.waitingHumans.filter(
        (waiting) => !humans.some((human) => human.sessionId === waiting.sessionId),
      );
      room.readySessionIds = humans.map((human) => human.sessionId);
      room.round = createRound({
        id: randomUUID(),
        dealerSeat: randomInt(4) as Seat,
        baseScore: room.baseScore,
        randomInt: randomIntFromCrypto,
      });
      this.refreshDeadline(room);
    }
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
    room.dissolveAfterRound = true;
    room.version += 1;
    if (room.round.phase === "ROUND_OVER") room.nextRoundAt = new Date().toISOString();
    this.save(room);
    return room;
  }

  leaveRoom(sessionId: string, code: string): RoomState | null {
    const room = this.roomsByCode.get(code);
    if (room?.status !== "ACTIVE") return null;
    room.waitingHumans = room.waitingHumans.filter((human) => human.sessionId !== sessionId);
    room.readySessionIds = room.readySessionIds.filter((id) => id !== sessionId);
    const seat = sessionSeat(room, sessionId);
    if (seat !== null) {
      room.seats[seat] = {
        seat,
        sessionId: null,
        nickname: `机器人 ${seat}`,
        controller: "BOT",
        connected: true,
      };
    }
    if (room.ownerSessionId === sessionId) {
      const candidates = [
        ...SEATS.flatMap((candidateSeat) => {
          const candidate = room.seats[candidateSeat];
          return candidate.sessionId === null ? [] : [candidate.sessionId];
        }),
        ...room.waitingHumans.map((human) => human.sessionId),
      ];
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
      controller.connected = connected;
      controller.controller = connected ? "HUMAN" : "TRUSTEE";
      room.version += 1;
      this.refreshDeadline(room);
      this.save(room);
      updates.push({ roomId: room.id, version: room.version });
    }
    return updates;
  }

  project(room: RoomState, sessionId: string): RoomProjection {
    const selfSeat = sessionSeat(room, sessionId);
    const isWaiting = room.waitingHumans.some((human) => human.sessionId === sessionId);
    const selfDrawnTileId =
      selfSeat !== null &&
      !isWaiting &&
      room.round.phase === "TURN_DECISION" &&
      room.round.lastDrawSeat === selfSeat &&
      room.round.players[selfSeat].hand.some((tile) => tile.id === room.round.lastDrawnTileId)
        ? room.round.lastDrawnTileId
        : null;
    const players = SEATS.map((seat) => {
      const controller = room.seats[seat];
      const roundPlayer = room.round.players[seat];
      const maySeeHand = selfSeat === seat && !isWaiting;
      return {
        seat,
        nickname: controller.nickname,
        controller: controller.controller,
        connected: controller.connected,
        handCount: roundPlayer.hand.length,
        hand: maySeeHand ? roundPlayer.hand : null,
        melds: roundPlayer.melds,
        discards: roundPlayer.discards,
        releasedWildcards: roundPlayer.releasedWildcards,
        personalMultiplier: roundPlayer.personalMultiplier,
        score: roundPlayer.score,
      };
    });
    const legalActions =
      selfSeat === null || isWaiting
        ? []
        : room.round.phase === "DISCARD_RESPONSE" && room.round.pendingResponse?.seat === selfSeat
          ? [...room.round.pendingResponse.actions, "PASS_RESPONSE"]
          : availableTurnActions(room.round, selfSeat);
    const roundSettlement: RoundSettlementProjection | null =
      isWaiting || room.round.outcome === null
        ? null
        : {
            roundId: room.round.id,
            kind: room.round.outcome.kind,
            winnerSeat: room.round.outcome.kind === "WIN" ? room.round.outcome.winnerSeat : null,
            winType: room.round.outcome.kind === "WIN" ? room.round.outcome.winType : null,
            baseScore: room.round.baseScore,
            winBaseMultiplier:
              room.round.outcome.kind === "WIN"
                ? room.round.outcome.winType === "HARD"
                  ? 2
                  : 1
                : null,
            winnerMultiplier:
              room.round.outcome.kind === "WIN"
                ? room.round.players[room.round.outcome.winnerSeat].personalMultiplier
                : null,
            nextDealerSeat: room.round.outcome.nextDealerSeat,
            payments:
              room.round.outcome.kind === "WIN"
                ? room.round.outcome.scoreDeltas.flatMap((delta) =>
                    delta.delta < 0
                      ? [
                          {
                            payerSeat: delta.seat,
                            payerMultiplier: room.round.players[delta.seat].personalMultiplier,
                            amount: -delta.delta,
                          },
                        ]
                      : [],
                  )
                : [],
            scoreChanges: SEATS.map((seat) => ({
              seat,
              roundDelta: room.round.players[seat].score - room.round.startingScores[seat],
              totalScore: room.round.players[seat].score,
            })),
          };
    return {
      schemaVersion: 1,
      roomId: room.id,
      roomCode: room.code,
      version: room.version,
      baseScore: room.baseScore,
      isOwner: room.ownerSessionId === sessionId,
      selfReady: room.readySessionIds.includes(sessionId),
      selfSeat,
      selfDrawnTileId,
      status: room.status,
      dissolveAfterRound: room.dissolveAfterRound,
      indicatorTile: isWaiting ? null : room.round.indicatorTile,
      wildcardKind: isWaiting ? null : room.round.wildcardKind,
      wallRemaining: isWaiting ? 0 : room.round.wall.length,
      currentSeat: isWaiting ? null : room.round.currentSeat,
      roundPhase: isWaiting ? null : room.round.phase,
      actionDeadlineAt: isWaiting ? null : room.actionDeadlineAt,
      roundOutcome:
        isWaiting || room.round.outcome === null
          ? null
          : room.round.outcome.kind === "WIN"
            ? {
                kind: "WIN",
                winnerSeat: room.round.outcome.winnerSeat,
                winType: room.round.outcome.winType,
                nextDealerSeat: room.round.outcome.nextDealerSeat,
              }
            : { kind: "DRAW", nextDealerSeat: room.round.outcome.nextDealerSeat },
      roundSettlement,
      legalActions,
      players,
      waitingPlayers: room.waitingHumans.map((human) => ({
        nickname: human.nickname,
        ready: human.ready,
        isSelf: human.sessionId === sessionId,
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
    let result: RuleResult;
    switch (command.type) {
      case "DECLARE_WIN":
        result = declareWin(room.round, seat);
        break;
      case "CONTINUE_TURN":
        result = continueTurn(room.round, seat);
        break;
      case "RELEASE_WILDCARD": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : releaseWildcard(room.round, seat, tileId);
        break;
      }
      case "DISCARD_TILE": {
        const tileId = stringField(command.payload, "tileId");
        result =
          tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : discardTile(room.round, seat, tileId);
        break;
      }
      case "CLAIM_PONG":
        result = claimPong(room.round, seat);
        break;
      case "CLAIM_EXPOSED_KONG":
        result = claimExposedKong(room.round, seat);
        break;
      case "CLAIM_INDICATOR_PONG_KONG":
        result = claimIndicatorPongKong(room.round, seat);
        break;
      case "DECLARE_CONCEALED_KONG": {
        const kind = tileKindField(command.payload);
        result =
          kind === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareConcealedKong(room.round, seat, kind);
        break;
      }
      case "DECLARE_ADDED_KONG": {
        const meldId = stringField(command.payload, "meldId");
        const tileId = stringField(command.payload, "tileId");
        result =
          meldId === null || tileId === null
            ? { ok: false, code: "ACTION_NOT_AVAILABLE" }
            : declareAddedKong(room.round, seat, meldId, tileId);
        break;
      }
      case "PASS_RESPONSE":
        result = passResponse(room.round, seat);
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
