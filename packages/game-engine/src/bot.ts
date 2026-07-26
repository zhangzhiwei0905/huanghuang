import type { BotDifficulty, Meld, Seat, Tile, TileKind, WinType } from "@huanghuang/protocol";
import { concealedKongKinds, discardableTileIds, releasableWildcardIds } from "./actions.js";
import { sameTileKind, type RandomInt } from "./tiles.js";

export type BotPublicPlayer = {
  seat: Seat;
  melds: Meld[];
  discards: Tile[];
  releasedWildcards: Tile[];
};

export type BotDecisionView = {
  seat: Seat;
  phase: "TURN_DECISION" | "DISCARD_RESPONSE";
  legalActions: readonly string[];
  botDifficulty: BotDifficulty;
  winType: WinType | null;
  hand: Tile[];
  melds: Meld[];
  releasedWildcards: Tile[];
  wildcardKind: TileKind;
  indicatorTile: Tile;
  wallRemaining: number;
  pendingDiscard: Tile | null;
  publicPlayers: readonly BotPublicPlayer[];
};

export type BotAction =
  | { type: "DECLARE_WIN" }
  | { type: "RELEASE_WILDCARD"; tileId: string }
  | { type: "DECLARE_CONCEALED_KONG"; tileKind: TileKind }
  | { type: "DECLARE_ADDED_KONG"; meldId: string; tileId: string }
  | { type: "DISCARD_TILE"; tileId: string }
  | { type: "CLAIM_PONG" }
  | { type: "CLAIM_EXPOSED_KONG" }
  | { type: "CLAIM_INDICATOR_PONG_KONG" }
  | { type: "PASS_RESPONSE" };

type HandRank = {
  shanten: number;
  improvements: number;
  shape: number;
};

const SUITS: readonly TileKind["suit"][] = ["WAN", "TIAO", "TONG"];
const TILE_KIND_COUNT = 27;

function kindIndex(kind: TileKind): number {
  return SUITS.indexOf(kind.suit) * 9 + kind.rank - 1;
}

function kindAt(index: number): TileKind {
  const suit = SUITS[Math.floor(index / 9)];
  if (suit === undefined) throw new Error(`Invalid tile kind index ${index}`);
  return { suit, rank: ((index % 9) + 1) as TileKind["rank"] };
}

function countAt(counts: readonly number[], index: number): number {
  return counts[index] ?? 0;
}

function adjustCount(counts: number[], index: number, delta: number): void {
  counts[index] = countAt(counts, index) + delta;
}

function tileCounts(tiles: readonly Tile[]): number[] {
  const counts = Array<number>(TILE_KIND_COUNT).fill(0);
  for (const tile of tiles) adjustCount(counts, kindIndex(tile), 1);
  return counts;
}

function standardShanten(
  counts: number[],
  openMelds: number,
  wildcardCount: number,
  cache: Map<string, number>,
): number {
  const cacheKey = `${openMelds}:${wildcardCount}:${counts.join("")}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  let best = 8;
  const visited = new Set<string>();

  function search(index: number, melds: number, pairs: number, incomplete: number): void {
    while (index < counts.length && countAt(counts, index) === 0) index += 1;
    const stateKey = `${index}:${melds}:${pairs}:${incomplete}:${counts.join("")}`;
    if (visited.has(stateKey)) return;
    visited.add(stateKey);
    if (index >= counts.length) {
      const totalMelds = Math.min(4, openMelds + melds);
      const usableIncomplete = Math.min(incomplete, 4 - totalMelds);
      const value = 8 - totalMelds * 2 - usableIncomplete - Math.min(pairs, 1) - wildcardCount;
      best = Math.min(best, value);
      return;
    }

    const rankIndex = index % 9;
    adjustCount(counts, index, -1);
    search(index, melds, pairs, incomplete);
    adjustCount(counts, index, 1);

    if (countAt(counts, index) >= 3) {
      adjustCount(counts, index, -3);
      search(index, melds + 1, pairs, incomplete);
      adjustCount(counts, index, 3);
    }

    if (rankIndex <= 6 && countAt(counts, index + 1) > 0 && countAt(counts, index + 2) > 0) {
      adjustCount(counts, index, -1);
      adjustCount(counts, index + 1, -1);
      adjustCount(counts, index + 2, -1);
      search(index, melds + 1, pairs, incomplete);
      adjustCount(counts, index, 1);
      adjustCount(counts, index + 1, 1);
      adjustCount(counts, index + 2, 1);
    }

    if (countAt(counts, index) >= 2) {
      adjustCount(counts, index, -2);
      search(index, melds, pairs + 1, incomplete);
      search(index, melds, pairs, incomplete + 1);
      adjustCount(counts, index, 2);
    }

    if (rankIndex <= 7 && countAt(counts, index + 1) > 0) {
      adjustCount(counts, index, -1);
      adjustCount(counts, index + 1, -1);
      search(index, melds, pairs, incomplete + 1);
      adjustCount(counts, index, 1);
      adjustCount(counts, index + 1, 1);
    }

    if (rankIndex <= 6 && countAt(counts, index + 2) > 0) {
      adjustCount(counts, index, -1);
      adjustCount(counts, index + 2, -1);
      search(index, melds, pairs, incomplete + 1);
      adjustCount(counts, index, 1);
      adjustCount(counts, index + 2, 1);
    }
  }

  search(0, 0, 0, 0);
  cache.set(cacheKey, best);
  return best;
}

function shapeScore(counts: readonly number[]): number {
  let score = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    if (count === 0) continue;
    if (count >= 3) score += 18;
    else if (count === 2) score += 8;

    const rankIndex = index % 9;
    if (rankIndex <= 7 && (counts[index + 1] ?? 0) > 0)
      score += Math.min(count, counts[index + 1] ?? 0) * 4;
    if (rankIndex <= 6 && (counts[index + 2] ?? 0) > 0)
      score += Math.min(count, counts[index + 2] ?? 0) * 2;
    if (
      count === 1 &&
      (rankIndex === 0 || (counts[index - 1] ?? 0) === 0) &&
      (rankIndex >= 8 || (counts[index + 1] ?? 0) === 0) &&
      (rankIndex <= 1 || (counts[index - 2] ?? 0) === 0) &&
      (rankIndex >= 7 || (counts[index + 2] ?? 0) === 0)
    ) {
      score -= 3;
    }
  }
  return score;
}

function publicTileIds(view: BotDecisionView): Map<string, TileKind> {
  const visible = new Map<string, TileKind>();
  visible.set(view.indicatorTile.id, view.indicatorTile);
  for (const player of view.publicPlayers) {
    for (const tile of [...player.discards, ...player.releasedWildcards]) {
      visible.set(tile.id, tile);
    }
    for (const meld of player.melds) {
      for (const tileId of meld.tileIds) visible.set(tileId, meld.tileKind);
    }
  }
  return visible;
}

function knownTileCounts(view: BotDecisionView): number[] {
  const counts = Array<number>(TILE_KIND_COUNT).fill(0);
  for (const tile of view.hand) adjustCount(counts, kindIndex(tile), 1);
  for (const kind of publicTileIds(view).values()) adjustCount(counts, kindIndex(kind), 1);
  return counts;
}

function rankHand(
  view: BotDecisionView,
  hand: readonly Tile[],
  knownCounts: readonly number[],
  cache: Map<string, number>,
  openMelds = view.melds.length,
): HandRank {
  const wildcardCount = Math.min(
    1,
    hand.filter((tile) => sameTileKind(tile, view.wildcardKind)).length,
  );
  const ordinaryTiles = hand.filter((tile) => !sameTileKind(tile, view.wildcardKind));
  const counts = tileCounts(ordinaryTiles);
  const shanten = standardShanten([...counts], openMelds, wildcardCount, cache);

  let improvements = 0;
  for (let index = 0; index < TILE_KIND_COUNT; index += 1) {
    const remaining = Math.max(0, 4 - countAt(knownCounts, index));
    if (remaining === 0) continue;
    const kind = kindAt(index);
    const nextWildcardCount = wildcardCount + (sameTileKind(kind, view.wildcardKind) ? 1 : 0);
    const nextCounts = [...counts];
    if (!sameTileKind(kind, view.wildcardKind)) adjustCount(nextCounts, index, 1);
    if (standardShanten(nextCounts, openMelds, Math.min(1, nextWildcardCount), cache) < shanten) {
      improvements += remaining;
    }
  }

  return { shanten, improvements, shape: shapeScore(counts) };
}

function compareRank(left: HandRank, right: HandRank): number {
  return (
    left.shanten - right.shanten ||
    right.improvements - left.improvements ||
    right.shape - left.shape
  );
}

export function chooseBotDiscard(view: BotDecisionView, randomInt: RandomInt): string | null {
  const legalIds = new Set(discardableTileIds(view.hand, view.wildcardKind));
  const candidates = view.hand.filter((tile) => legalIds.has(tile.id));
  if (candidates.length === 0) return null;

  const knownCounts = knownTileCounts(view);
  const cache = new Map<string, number>();
  const ranked = candidates.map((tile) => ({
    tile,
    rank: rankHand(
      view,
      view.hand.filter((candidate) => candidate.id !== tile.id),
      knownCounts,
      cache,
    ),
  }));
  ranked.sort((left, right) => compareRank(left.rank, right.rank));
  const best = ranked[0];
  if (best === undefined) return null;
  const tied = ranked.filter((candidate) => compareRank(candidate.rank, best.rank) === 0);
  return tied[randomInt(tied.length)]?.tile.id ?? best.tile.id;
}

function shouldClaimPong(view: BotDecisionView, randomInt: RandomInt): boolean {
  const discard = view.pendingDiscard;
  if (discard === null) return false;
  const matching = view.hand.filter((tile) => sameTileKind(tile, discard)).slice(0, 2);
  if (matching.length !== 2) return false;
  const claimedIds = new Set(matching.map((tile) => tile.id));
  const afterClaim = view.hand.filter((tile) => !claimedIds.has(tile.id));
  const knownCounts = knownTileCounts(view);
  const cache = new Map<string, number>();
  const baseline = rankHand(view, view.hand, knownCounts, cache);
  const postDiscardRanks = afterClaim
    .filter((tile) => !sameTileKind(tile, view.wildcardKind))
    .map((tile) =>
      rankHand(
        view,
        afterClaim.filter((candidate) => candidate.id !== tile.id),
        knownCounts,
        cache,
        view.melds.length + 1,
      ),
    );
  postDiscardRanks.sort(compareRank);
  const claimed = postDiscardRanks[0];
  if (claimed === undefined || claimed.shanten > baseline.shanten) return false;
  if (claimed.shanten < baseline.shanten) return true;
  return claimed.improvements > baseline.improvements || randomInt(4) !== 0;
}

export function chooseBotAction(view: BotDecisionView, randomInt: RandomInt): BotAction | null {
  if (view.phase === "DISCARD_RESPONSE") {
    if (view.legalActions.includes("CLAIM_INDICATOR_PONG_KONG")) {
      return { type: "CLAIM_INDICATOR_PONG_KONG" };
    }
    if (view.legalActions.includes("CLAIM_EXPOSED_KONG")) {
      return { type: "CLAIM_EXPOSED_KONG" };
    }
    if (view.legalActions.includes("CLAIM_PONG") && shouldClaimPong(view, randomInt)) {
      return { type: "CLAIM_PONG" };
    }
    return view.legalActions.includes("PASS_RESPONSE") ? { type: "PASS_RESPONSE" } : null;
  }

  if (
    view.legalActions.includes("DECLARE_WIN") &&
    (view.botDifficulty === "HIGH" || view.winType === "HARD")
  ) {
    return { type: "DECLARE_WIN" };
  }

  const wildcardIds = releasableWildcardIds({
    hand: view.hand,
    wildcardKind: view.wildcardKind,
    wallRemaining: view.wallRemaining,
  });
  const releaseSingleWildcard = view.melds.length === 4 && wildcardIds.length === 1;
  if (
    view.legalActions.includes("RELEASE_WILDCARD") &&
    (wildcardIds.length >= 2 || releaseSingleWildcard)
  ) {
    const tileId = wildcardIds[0];
    return tileId === undefined ? null : { type: "RELEASE_WILDCARD", tileId };
  }

  if (view.legalActions.includes("DECLARE_CONCEALED_KONG")) {
    const tileKind = concealedKongKinds({
      hand: view.hand,
      wildcardKind: view.wildcardKind,
      wallRemaining: view.wallRemaining,
    })[0];
    if (tileKind !== undefined) return { type: "DECLARE_CONCEALED_KONG", tileKind };
  }

  if (view.legalActions.includes("DECLARE_ADDED_KONG")) {
    for (const meld of view.melds) {
      if (meld.kind !== "PONG") continue;
      const tile = view.hand.find((candidate) => sameTileKind(candidate, meld.tileKind));
      if (tile !== undefined && !sameTileKind(tile, view.wildcardKind)) {
        return { type: "DECLARE_ADDED_KONG", meldId: meld.id, tileId: tile.id };
      }
    }
  }

  if (view.legalActions.includes("DISCARD_TILE")) {
    const tileId = chooseBotDiscard(view, randomInt);
    if (tileId !== null) return { type: "DISCARD_TILE", tileId };
  }
  return null;
}
