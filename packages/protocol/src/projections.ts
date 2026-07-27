import type { BotDifficulty, RoomMode, TurnTimeoutSeconds } from "./commands.js";
import type { BaseScore, Meld, PersonalMultiplier, Seat, Tile, TileKind, WinType } from "./game.js";

export type PlayerController = "HUMAN" | "BOT" | "TRUSTEE";

export type PlayerProjection = {
  seat: Seat;
  nickname: string;
  avatarUrl: string | null;
  controller: PlayerController;
  connected: boolean;
  handCount: number;
  hand: Tile[] | null;
  melds: Meld[];
  discards: Tile[];
  releasedWildcards: Tile[];
  personalMultiplier: PersonalMultiplier;
  score: number;
};

export type RoomStage = "WAITING" | "PLAYING" | "ROUND_RESULT";
export type RoomCloseReason = "OWNER_DISSOLVED" | "WAITING_TIMEOUT" | "EMPTY_ROOM";

export type ChatMessageProjection = {
  id: string;
  roomId: string;
  senderSeat: Seat;
  nickname: string;
  message: string;
  sentAt: string;
};

export type LobbySeatProjection = {
  seat: Seat;
  controller: "HUMAN" | "BOT" | null;
  nickname: string | null;
  avatarUrl: string | null;
  occupied: boolean;
  ready: boolean;
  connected: boolean;
  isOwner: boolean;
  isSelf: boolean;
  score: number;
};

export type SpectatorProjection = {
  nickname: string;
  avatarUrl: string | null;
  connected: boolean;
  isSelf: boolean;
};

export type RoundSettlementProjection = {
  roundId: string;
  kind: "WIN" | "DRAW";
  winnerSeat: Seat | null;
  winType: WinType | null;
  baseScore: BaseScore;
  /** Win-type multiplier only: 2 for a hard win, 1 for a soft win. */
  winBaseMultiplier: 1 | 2 | null;
  winnerMultiplier: PersonalMultiplier | null;
  /**
   * True when the winning tile was the one drawn right after releasing a
   * wildcard ("来由"). `winType` doubles as the laiyou class: HARD is 硬来由,
   * SOFT is 软来由.
   */
  laiyou: boolean;
  /** The laiyou contribution to the total multiplier: 2 when `laiyou`, else 1. */
  laiyouMultiplier: 1 | 2 | null;
  nextDealerSeat: Seat;
  payments: {
    payerSeat: Seat;
    payerMultiplier: PersonalMultiplier;
    amount: number;
  }[];
  finalHands: {
    seat: Seat;
    tiles: Tile[];
    personalMultiplier: PersonalMultiplier;
  }[];
  scoreChanges: {
    seat: Seat;
    roundDelta: number;
    totalScore: number;
  }[];
};

export type GameEffectAction = Meld["kind"] | "RELEASE_WILDCARD" | "WIN";

export type GameEffectCue = {
  id: string;
  action: GameEffectAction;
  actorSeat: Seat;
  tileKind: TileKind | null;
  winType: WinType | null;
  /** Only meaningful for the `WIN` action; always false otherwise. */
  laiyou: boolean;
  startedAt: string;
  endsAt: string;
};

export type TingWaitProjection = {
  tileKind: TileKind;
  winType: WinType;
  multiplier: number;
  remainingCount: number;
};

export type DiscardTingProjection = {
  discardTileId: string;
  waits: TingWaitProjection[];
};

export type RoomProjection = {
  schemaVersion: 8;
  roomId: string;
  roomCode: string;
  version: number;
  baseScore: BaseScore;
  turnTimeoutSeconds: TurnTimeoutSeconds;
  botDifficulty: BotDifficulty;
  mode: RoomMode;
  stage: RoomStage;
  roundId: string | null;
  roundStartedAt: string | null;
  waitingExpiresAt: string | null;
  isOwner: boolean;
  selfRole: "PLAYER" | "SPECTATOR";
  selfReady: boolean;
  selfSeat: Seat | null;
  selfDrawnTileId: string | null;
  /**
   * True when the next round will zero every seat's cumulative score. That
   * happens exactly once per room, the first time a round starts with all four
   * seats human. Clients render a notice from this flag and must never derive
   * the reset themselves.
   */
  scoreResetPending: boolean;
  status: "ACTIVE" | "CLOSED";
  closeReason: RoomCloseReason | null;
  dissolveAfterRound: boolean;
  indicatorTile: Tile | null;
  wildcardKind: TileKind | null;
  wallRemaining: number;
  actingSeat: Seat | null;
  currentSeat: Seat | null;
  roundPhase: "TURN_DECISION" | "DISCARD_RESPONSE" | "ROUND_OVER" | null;
  actionDeadlineAt: string | null;
  roundOutcome:
    | { kind: "WIN"; winnerSeat: Seat; winType: WinType; laiyou: boolean; nextDealerSeat: Seat }
    | { kind: "DRAW"; nextDealerSeat: Seat }
    | null;
  roundSettlement: RoundSettlementProjection | null;
  effectCue: GameEffectCue | null;
  legalActions: string[];
  tingHints: DiscardTingProjection[];
  players: PlayerProjection[];
  lobbySeats: LobbySeatProjection[];
  spectators: SpectatorProjection[];
};

export type RoomUpdate = {
  eventId: string;
  roomId: string;
  version: number;
  projection: RoomProjection;
};
