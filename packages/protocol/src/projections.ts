import type { RoomMode } from "./commands.js";
import type { BaseScore, Meld, PersonalMultiplier, Seat, Tile, TileKind, WinType } from "./game.js";

export type PlayerController = "HUMAN" | "BOT" | "TRUSTEE";

export type PlayerProjection = {
  seat: Seat;
  nickname: string;
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
  nickname: string | null;
  occupied: boolean;
  ready: boolean;
  connected: boolean;
  isOwner: boolean;
  isSelf: boolean;
  score: number;
};

export type RoundSettlementProjection = {
  roundId: string;
  kind: "WIN" | "DRAW";
  winnerSeat: Seat | null;
  winType: WinType | null;
  baseScore: BaseScore;
  winBaseMultiplier: 1 | 2 | null;
  winnerMultiplier: PersonalMultiplier | null;
  nextDealerSeat: Seat;
  payments: {
    payerSeat: Seat;
    payerMultiplier: PersonalMultiplier;
    amount: number;
  }[];
  scoreChanges: {
    seat: Seat;
    roundDelta: number;
    totalScore: number;
  }[];
};

export type RoomProjection = {
  schemaVersion: 4;
  roomId: string;
  roomCode: string;
  version: number;
  baseScore: BaseScore;
  mode: RoomMode;
  stage: RoomStage;
  roundId: string | null;
  roundStartedAt: string | null;
  waitingExpiresAt: string | null;
  isOwner: boolean;
  selfReady: boolean;
  selfSeat: Seat | null;
  selfDrawnTileId: string | null;
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
    | { kind: "WIN"; winnerSeat: Seat; winType: WinType; nextDealerSeat: Seat }
    | { kind: "DRAW"; nextDealerSeat: Seat }
    | null;
  roundSettlement: RoundSettlementProjection | null;
  legalActions: string[];
  players: PlayerProjection[];
  lobbySeats: LobbySeatProjection[];
};

export type RoomUpdate = {
  eventId: string;
  roomId: string;
  version: number;
  projection: RoomProjection;
};
