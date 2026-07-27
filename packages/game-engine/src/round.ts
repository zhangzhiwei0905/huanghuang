import type {
  BaseScore,
  Meld,
  PersonalMultiplier,
  Seat,
  Tile,
  TileKind,
  WinType,
} from "@huanghuang/protocol";
import { discardableTileIds, concealedKongKinds, releasableWildcardIds } from "./actions.js";
import {
  calculateKongSettlement,
  calculateSelfDrawSettlement,
  type ScoreDelta,
} from "./settlement.js";
import {
  createTileSet,
  nextWildcardKind,
  sameTileKind,
  shuffleTiles,
  type RandomInt,
} from "./tiles.js";
import { evaluateWin, type WinEvaluation } from "./win.js";

export type RoundPhase = "TURN_DECISION" | "DISCARD_RESPONSE" | "ROUND_OVER";

export type RoundPlayer = {
  seat: Seat;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  releasedWildcards: Tile[];
  personalMultiplier: PersonalMultiplier;
  score: number;
};

export type DiscardRecord = {
  id: string;
  tile: Tile;
  sourceSeat: Seat;
};

export type ResponseAction = "CLAIM_PONG" | "CLAIM_EXPOSED_KONG" | "CLAIM_INDICATOR_PONG_KONG";

export type PendingResponse = {
  seat: Seat;
  actions: ResponseAction[];
};

export type RoundOutcome =
  | {
      kind: "WIN";
      winnerSeat: Seat;
      winType: WinType;
      /** True when the winning tile was drawn right after releasing a wildcard. */
      laiyou: boolean;
      scoreDeltas: ScoreDelta[];
      nextDealerSeat: Seat;
    }
  | {
      kind: "DRAW";
      nextDealerSeat: Seat;
    };

export type RoundState = {
  id: string;
  version: number;
  baseScore: BaseScore;
  startingScores: Record<Seat, number>;
  dealerSeat: Seat;
  currentSeat: Seat;
  phase: RoundPhase;
  wall: Tile[];
  indicatorTile: Tile;
  wildcardKind: TileKind;
  players: Record<Seat, RoundPlayer>;
  lastDrawnTileId: string;
  lastDrawSeat: Seat;
  lastDiscard: DiscardRecord | null;
  pendingResponse: PendingResponse | null;
  winPassedThisTurn: boolean;
  /**
   * The tile drawn by the most recent wildcard release. Winning on exactly this
   * tile is "来由". Any later draw overwrites `lastDrawnTileId`, so comparing the
   * two is enough to invalidate a stale candidate without extra bookkeeping.
   */
  laiyouCandidate: { seat: Seat; tileId: string } | null;
  outcome: RoundOutcome | null;
};

export type RuleErrorCode =
  | "NOT_CURRENT_PLAYER"
  | "WRONG_PHASE"
  | "TILE_NOT_IN_HAND"
  | "WILDCARD_CANNOT_BE_DISCARDED"
  | "ACTION_NOT_AVAILABLE"
  | "WALL_EMPTY"
  | "CANNOT_WIN";

export type RuleResult = { ok: true; state: RoundState } | { ok: false; code: RuleErrorCode };

export type TurnAction =
  | "DECLARE_WIN"
  | "CONTINUE_TURN"
  | "RELEASE_WILDCARD"
  | "DISCARD_TILE"
  | "DECLARE_CONCEALED_KONG"
  | "DECLARE_ADDED_KONG";

const SEATS: readonly Seat[] = [0, 1, 2, 3];

const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
const oppositeSeat = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

function cloneState(state: RoundState): RoundState {
  return structuredClone(state);
}

function playerAt(state: RoundState, seat: Seat): RoundPlayer {
  return state.players[seat];
}

function rejected(code: RuleErrorCode): RuleResult {
  return { ok: false, code };
}

function accepted(state: RoundState): RuleResult {
  state.version += 1;
  return { ok: true, state };
}

function applyScoreDeltas(state: RoundState, deltas: readonly ScoreDelta[]): void {
  for (const delta of deltas) {
    playerAt(state, delta.seat).score += delta.delta;
  }
}

function drawFromFront(state: RoundState, seat: Seat): Tile | null {
  const drawn = state.wall.shift();
  if (drawn === undefined) {
    return null;
  }
  playerAt(state, seat).hand.push(drawn);
  state.lastDrawnTileId = drawn.id;
  state.lastDrawSeat = seat;
  return drawn;
}

function finishAsDraw(state: RoundState): void {
  state.phase = "ROUND_OVER";
  state.pendingResponse = null;
  state.outcome = { kind: "DRAW", nextDealerSeat: state.lastDrawSeat };
}

function beginSeatTurn(state: RoundState, seat: Seat, draw: boolean): void {
  state.currentSeat = seat;
  state.phase = "TURN_DECISION";
  state.pendingResponse = null;
  state.lastDiscard = null;
  state.winPassedThisTurn = false;
  if (draw && drawFromFront(state, seat) === null) {
    finishAsDraw(state);
  }
}

export function createRound(options: {
  id: string;
  dealerSeat: Seat;
  baseScore: BaseScore;
  startingScores?: Readonly<Record<Seat, number>>;
  randomInt: RandomInt;
}): RoundState {
  const startingScores: Record<Seat, number> = {
    0: options.startingScores?.[0] ?? 0,
    1: options.startingScores?.[1] ?? 0,
    2: options.startingScores?.[2] ?? 0,
    3: options.startingScores?.[3] ?? 0,
  };
  const shuffled = shuffleTiles(createTileSet(), options.randomInt);
  const createPlayer = (seat: Seat): RoundPlayer => ({
    seat,
    hand: [],
    melds: [],
    discards: [],
    releasedWildcards: [],
    personalMultiplier: 1,
    score: startingScores[seat],
  });
  const players: Record<Seat, RoundPlayer> = {
    0: createPlayer(0),
    1: createPlayer(1),
    2: createPlayer(2),
    3: createPlayer(3),
  };

  for (const seat of SEATS) {
    const count = seat === options.dealerSeat ? 14 : 13;
    players[seat].hand = shuffled.splice(0, count);
  }
  const indicatorTile = shuffled.shift();
  const dealerLastTile = players[options.dealerSeat].hand.at(-1);
  if (indicatorTile === undefined || dealerLastTile === undefined) {
    throw new Error("Initial deal did not contain enough tiles");
  }

  return {
    id: options.id,
    version: 0,
    baseScore: options.baseScore,
    startingScores,
    dealerSeat: options.dealerSeat,
    currentSeat: options.dealerSeat,
    phase: "TURN_DECISION",
    wall: shuffled,
    indicatorTile,
    wildcardKind: nextWildcardKind(indicatorTile),
    players,
    lastDrawnTileId: dealerLastTile.id,
    lastDrawSeat: options.dealerSeat,
    lastDiscard: null,
    pendingResponse: null,
    winPassedThisTurn: false,
    laiyouCandidate: null,
    outcome: null,
  };
}

export function isLaiyouWin(state: RoundState, seat: Seat): boolean {
  const candidate = state.laiyouCandidate;
  return (
    candidate !== null && candidate.seat === seat && candidate.tileId === state.lastDrawnTileId
  );
}

function currentWinEvaluation(state: RoundState, seat: Seat): WinEvaluation {
  const player = playerAt(state, seat);
  return evaluateWin({
    concealedTiles: player.hand,
    melds: player.melds,
    wildcardKind: state.wildcardKind,
    winningTileId: state.lastDrawnTileId,
  });
}

function hasCurrentDrawnTile(state: RoundState, seat: Seat): boolean {
  return (
    state.lastDrawSeat === seat &&
    state.lastDrawnTileId.length > 0 &&
    playerAt(state, seat).hand.some((tile) => tile.id === state.lastDrawnTileId)
  );
}

export function availableTurnActions(state: RoundState, seat: Seat): TurnAction[] {
  if (state.phase !== "TURN_DECISION" || state.currentSeat !== seat) {
    return [];
  }
  const player = playerAt(state, seat);
  const actions: TurnAction[] = [];
  const hasDrawnTile = hasCurrentDrawnTile(state, seat);
  if (hasDrawnTile && !state.winPassedThisTurn && currentWinEvaluation(state, seat).canWin) {
    actions.push("DECLARE_WIN", "CONTINUE_TURN");
  }
  if (
    releasableWildcardIds({
      hand: player.hand,
      wildcardKind: state.wildcardKind,
      wallRemaining: state.wall.length,
    }).length > 0
  ) {
    actions.push("RELEASE_WILDCARD");
  }
  if (
    hasDrawnTile &&
    concealedKongKinds({
      hand: player.hand,
      wildcardKind: state.wildcardKind,
      wallRemaining: state.wall.length,
    }).length > 0
  ) {
    actions.push("DECLARE_CONCEALED_KONG");
  }
  if (
    hasDrawnTile &&
    state.wall.length > 0 &&
    player.melds.some(
      (meld) =>
        meld.kind === "PONG" && player.hand.some((tile) => sameTileKind(tile, meld.tileKind)),
    )
  ) {
    actions.push("DECLARE_ADDED_KONG");
  }
  if (discardableTileIds(player.hand, state.wildcardKind).length > 0) {
    actions.push("DISCARD_TILE");
  }
  return actions;
}

export function continueTurn(state: RoundState, seat: Seat): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  if (!availableTurnActions(state, seat).includes("CONTINUE_TURN")) {
    return rejected("ACTION_NOT_AVAILABLE");
  }
  const next = cloneState(state);
  next.winPassedThisTurn = true;
  return accepted(next);
}

export function declareWin(state: RoundState, seat: Seat): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  if (state.winPassedThisTurn) return rejected("CANNOT_WIN");
  if (!hasCurrentDrawnTile(state, seat)) return rejected("CANNOT_WIN");
  const evaluation = currentWinEvaluation(state, seat);
  if (!evaluation.canWin || evaluation.winType === null) return rejected("CANNOT_WIN");

  const next = cloneState(state);
  const multipliers = Object.fromEntries(
    SEATS.map((playerSeat) => [playerSeat, playerAt(next, playerSeat).personalMultiplier]),
  ) as Record<Seat, PersonalMultiplier>;
  const laiyou = isLaiyouWin(state, seat);
  const deltas = calculateSelfDrawSettlement({
    baseScore: next.baseScore,
    winnerSeat: seat,
    winType: evaluation.winType,
    laiyou,
    personalMultipliers: multipliers,
  });
  applyScoreDeltas(next, deltas);
  next.phase = "ROUND_OVER";
  next.outcome = {
    kind: "WIN",
    winnerSeat: seat,
    winType: evaluation.winType,
    laiyou,
    scoreDeltas: deltas,
    nextDealerSeat: oppositeSeat(seat),
  };
  return accepted(next);
}

export function releaseWildcard(state: RoundState, seat: Seat, tileId: string): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  const player = playerAt(state, seat);
  const tile = player.hand.find((candidate) => candidate.id === tileId);
  if (tile === undefined) return rejected("TILE_NOT_IN_HAND");
  if (!sameTileKind(tile, state.wildcardKind)) return rejected("ACTION_NOT_AVAILABLE");
  if (state.wall.length === 0) return rejected("WALL_EMPTY");

  const next = cloneState(state);
  const nextPlayer = playerAt(next, seat);
  const index = nextPlayer.hand.findIndex((candidate) => candidate.id === tileId);
  const [released] = nextPlayer.hand.splice(index, 1);
  if (released === undefined) return rejected("TILE_NOT_IN_HAND");
  nextPlayer.releasedWildcards.push(released);
  nextPlayer.personalMultiplier = (nextPlayer.personalMultiplier * 2) as PersonalMultiplier;
  drawFromFront(next, seat);
  next.winPassedThisTurn = false;
  next.laiyouCandidate = { seat, tileId: next.lastDrawnTileId };
  return accepted(next);
}

function responseForDiscard(state: RoundState, discard: DiscardRecord): PendingResponse | null {
  for (const seat of SEATS) {
    if (seat === discard.sourceSeat) continue;
    const player = playerAt(state, seat);
    const matching = player.hand.filter((tile) => sameTileKind(tile, discard.tile));
    const actions: ResponseAction[] = [];
    if (sameTileKind(discard.tile, state.wildcardKind)) continue;
    if (sameTileKind(discard.tile, state.indicatorTile) && matching.length >= 2) {
      actions.push("CLAIM_INDICATOR_PONG_KONG");
    } else {
      if (matching.length >= 2) actions.push("CLAIM_PONG");
      if (matching.length >= 3 && state.wall.length > 0) actions.push("CLAIM_EXPOSED_KONG");
    }
    if (actions.length > 0) return { seat, actions };
  }
  return null;
}

export function discardTile(state: RoundState, seat: Seat, tileId: string): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  const player = playerAt(state, seat);
  const tile = player.hand.find((candidate) => candidate.id === tileId);
  if (tile === undefined) return rejected("TILE_NOT_IN_HAND");
  if (sameTileKind(tile, state.wildcardKind)) return rejected("WILDCARD_CANNOT_BE_DISCARDED");

  const next = cloneState(state);
  const nextPlayer = playerAt(next, seat);
  const index = nextPlayer.hand.findIndex((candidate) => candidate.id === tileId);
  const [discarded] = nextPlayer.hand.splice(index, 1);
  if (discarded === undefined) return rejected("TILE_NOT_IN_HAND");
  nextPlayer.discards.push(discarded);
  const discard: DiscardRecord = {
    id: `discard-${next.id}-${next.version + 1}`,
    tile: discarded,
    sourceSeat: seat,
  };
  next.lastDiscard = discard;
  const response = responseForDiscard(next, discard);
  if (response === null) {
    beginSeatTurn(next, nextSeat(seat), true);
  } else {
    next.phase = "DISCARD_RESPONSE";
    next.pendingResponse = response;
  }
  return accepted(next);
}

function removeMatchingTiles(player: RoundPlayer, kind: TileKind, count: number): Tile[] | null {
  const matches = player.hand.filter((tile) => sameTileKind(tile, kind)).slice(0, count);
  if (matches.length !== count) return null;
  const ids = new Set(matches.map((tile) => tile.id));
  player.hand = player.hand.filter((tile) => !ids.has(tile.id));
  return matches;
}

function claimResponse(state: RoundState, seat: Seat, action: ResponseAction): RuleResult {
  if (state.phase !== "DISCARD_RESPONSE" || state.lastDiscard === null) {
    return rejected("WRONG_PHASE");
  }
  if (state.pendingResponse?.seat !== seat) return rejected("NOT_CURRENT_PLAYER");
  if (!state.pendingResponse.actions.includes(action)) return rejected("ACTION_NOT_AVAILABLE");

  const next = cloneState(state);
  const discard = next.lastDiscard;
  if (discard === null) return rejected("WRONG_PHASE");
  const player = playerAt(next, seat);
  const count = action === "CLAIM_EXPOSED_KONG" ? 3 : 2;
  const claimed = removeMatchingTiles(player, discard.tile, count);
  if (claimed === null) return rejected("ACTION_NOT_AVAILABLE");
  const meldKind =
    action === "CLAIM_PONG"
      ? "PONG"
      : action === "CLAIM_EXPOSED_KONG"
        ? "EXPOSED_KONG"
        : "INDICATOR_PONG_KONG";
  player.melds.push({
    id: `meld-${next.id}-${next.version + 1}`,
    kind: meldKind,
    tileIds: [...claimed.map((tile) => tile.id), discard.tile.id],
    tileKind: { suit: discard.tile.suit, rank: discard.tile.rank },
    sourcePlayerId: `seat-${discard.sourceSeat}`,
    sourceDiscardId: discard.id,
    createdAtVersion: next.version + 1,
  });

  if (action !== "CLAIM_PONG") {
    const kind = action === "CLAIM_EXPOSED_KONG" ? "EXPOSED_KONG" : "INDICATOR_PONG_KONG";
    const deltas = calculateKongSettlement({
      baseScore: next.baseScore,
      actorSeat: seat,
      kind,
      sourceSeat: discard.sourceSeat,
    });
    applyScoreDeltas(next, deltas);
  }
  next.currentSeat = seat;
  next.phase = "TURN_DECISION";
  next.pendingResponse = null;
  next.lastDiscard = null;
  next.lastDrawnTileId = "";
  next.winPassedThisTurn = false;
  if (action === "CLAIM_EXPOSED_KONG" && drawFromFront(next, seat) === null) {
    return rejected("WALL_EMPTY");
  }
  return accepted(next);
}

export const claimPong = (state: RoundState, seat: Seat): RuleResult =>
  claimResponse(state, seat, "CLAIM_PONG");

export const claimExposedKong = (state: RoundState, seat: Seat): RuleResult =>
  claimResponse(state, seat, "CLAIM_EXPOSED_KONG");

export const claimIndicatorPongKong = (state: RoundState, seat: Seat): RuleResult =>
  claimResponse(state, seat, "CLAIM_INDICATOR_PONG_KONG");

export function passResponse(state: RoundState, seat: Seat): RuleResult {
  if (state.phase !== "DISCARD_RESPONSE" || state.lastDiscard === null) {
    return rejected("WRONG_PHASE");
  }
  if (state.pendingResponse?.seat !== seat) return rejected("NOT_CURRENT_PLAYER");
  const next = cloneState(state);
  const sourceSeat = next.lastDiscard?.sourceSeat;
  if (sourceSeat === undefined) return rejected("WRONG_PHASE");
  beginSeatTurn(next, nextSeat(sourceSeat), true);
  return accepted(next);
}

export function declareConcealedKong(state: RoundState, seat: Seat, kind: TileKind): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  if (!hasCurrentDrawnTile(state, seat)) return rejected("ACTION_NOT_AVAILABLE");
  if (state.wall.length === 0) return rejected("WALL_EMPTY");
  if (sameTileKind(kind, state.wildcardKind)) return rejected("ACTION_NOT_AVAILABLE");
  const next = cloneState(state);
  const player = playerAt(next, seat);
  const tiles = removeMatchingTiles(player, kind, 4);
  if (tiles === null) return rejected("ACTION_NOT_AVAILABLE");
  player.melds.push({
    id: `meld-${next.id}-${next.version + 1}`,
    kind: "CONCEALED_KONG",
    tileIds: tiles.map((tile) => tile.id),
    tileKind: kind,
    sourcePlayerId: null,
    sourceDiscardId: null,
    createdAtVersion: next.version + 1,
  });
  applyScoreDeltas(
    next,
    calculateKongSettlement({
      baseScore: next.baseScore,
      actorSeat: seat,
      kind: "CONCEALED_KONG",
      sourceSeat: null,
    }),
  );
  drawFromFront(next, seat);
  next.lastDiscard = null;
  next.winPassedThisTurn = false;
  return accepted(next);
}

export function declareAddedKong(
  state: RoundState,
  seat: Seat,
  meldId: string,
  tileId: string,
): RuleResult {
  if (state.phase !== "TURN_DECISION") return rejected("WRONG_PHASE");
  if (state.currentSeat !== seat) return rejected("NOT_CURRENT_PLAYER");
  if (!hasCurrentDrawnTile(state, seat)) return rejected("ACTION_NOT_AVAILABLE");
  if (state.wall.length === 0) return rejected("WALL_EMPTY");
  const next = cloneState(state);
  const player = playerAt(next, seat);
  const meld = player.melds.find(
    (candidate) => candidate.id === meldId && candidate.kind === "PONG",
  );
  const tileIndex = player.hand.findIndex((candidate) => candidate.id === tileId);
  const tile = player.hand[tileIndex];
  if (meld === undefined || tile === undefined || !sameTileKind(tile, meld.tileKind)) {
    return rejected("ACTION_NOT_AVAILABLE");
  }
  if (sameTileKind(tile, next.wildcardKind)) return rejected("ACTION_NOT_AVAILABLE");
  player.hand.splice(tileIndex, 1);
  meld.kind = "ADDED_KONG";
  meld.tileIds.push(tile.id);
  applyScoreDeltas(
    next,
    calculateKongSettlement({
      baseScore: next.baseScore,
      actorSeat: seat,
      kind: "ADDED_KONG",
      sourceSeat: null,
    }),
  );
  drawFromFront(next, seat);
  next.lastDiscard = null;
  next.winPassedThisTurn = false;
  return accepted(next);
}
