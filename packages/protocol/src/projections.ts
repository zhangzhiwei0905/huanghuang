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

export type WaitingPlayerProjection = {
  nickname: string;
  ready: boolean;
  isSelf: boolean;
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
  schemaVersion: 1;
  roomId: string;
  roomCode: string;
  version: number;
  baseScore: BaseScore;
  isOwner: boolean;
  selfReady: boolean;
  selfSeat: Seat | null;
  selfDrawnTileId: string | null;
  status: "ACTIVE" | "CLOSED";
  dissolveAfterRound: boolean;
  indicatorTile: Tile | null;
  wildcardKind: TileKind | null;
  wallRemaining: number;
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
  waitingPlayers: WaitingPlayerProjection[];
};

export type RoomUpdate = {
  eventId: string;
  roomId: string;
  version: number;
  projection: RoomProjection;
};
