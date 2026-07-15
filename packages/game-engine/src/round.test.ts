import type { Seat, Tile, TileKind } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  availableTurnActions,
  claimPong,
  createRound,
  declareWin,
  discardTile,
  passResponse,
  releaseWildcard,
  type RoundState,
} from "./round.js";
import { sameTileKind } from "./tiles.js";

const deterministicRandom = (max: number): number => (max <= 1 ? 0 : Math.floor(max / 2));

function replaceHand(state: RoundState, seat: Seat, hand: Tile[]): RoundState {
  const copy = structuredClone(state);
  copy.players[seat].hand = hand;
  return copy;
}

const makeTile = (id: string, kind: TileKind): Tile => ({ id, ...kind });

describe("round state machine", () => {
  it("deals 14 tiles to the dealer, 13 to others and removes one indicator", () => {
    const state = createRound({
      id: "round-1",
      dealerSeat: 2,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    expect(state.players[2].hand).toHaveLength(14);
    expect(state.players[0].hand).toHaveLength(13);
    expect(state.players[1].hand).toHaveLength(13);
    expect(state.players[3].hand).toHaveLength(13);
    expect(state.wall).toHaveLength(54);
    expect(state.wall.some((tile) => tile.id === state.indicatorTile.id)).toBe(false);
    expect(state.currentSeat).toBe(2);
  });

  it("rejects discarding a wildcard", () => {
    const state = createRound({
      id: "round-2",
      dealerSeat: 0,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    const wildcard = state.players[0].hand.find((tile) => sameTileKind(tile, state.wildcardKind));
    if (wildcard === undefined) {
      const replacement = makeTile("forced-wildcard", state.wildcardKind);
      state.players[0].hand[0] = replacement;
    }
    const target = state.players[0].hand.find((tile) => sameTileKind(tile, state.wildcardKind))!;
    expect(discardTile(state, 0, target.id)).toEqual({
      ok: false,
      code: "WILDCARD_CANNOT_BE_DISCARDED",
    });
  });

  it("allows releasing a wildcard after a pong and draws a replacement", () => {
    const state = createRound({
      id: "round-3",
      dealerSeat: 0,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    const kind: TileKind = { suit: "TIAO", rank: 3 };
    const wildcard = makeTile("wildcard", state.wildcardKind);
    const sourceHand = [
      makeTile("discard-me", kind),
      ...Array.from({ length: 13 }, (_, index) =>
        makeTile(`source-${index}`, { suit: "TONG", rank: ((index % 9) + 1) as TileKind["rank"] }),
      ),
    ];
    const responderHand = [
      makeTile("match-a", kind),
      makeTile("match-b", kind),
      wildcard,
      ...Array.from({ length: 10 }, (_, index) =>
        makeTile(`responder-${index}`, {
          suit: "WAN",
          rank: ((index % 9) + 1) as TileKind["rank"],
        }),
      ),
    ];
    let prepared = replaceHand(state, 0, sourceHand);
    prepared = replaceHand(prepared, 1, responderHand);
    const discarded = discardTile(prepared, 0, "discard-me");
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.pendingResponse?.seat).toBe(1);
    const pong = claimPong(discarded.state, 1);
    expect(pong.ok).toBe(true);
    if (!pong.ok) return;
    const beforeWall = pong.state.wall.length;
    const released = releaseWildcard(pong.state, 1, "wildcard");
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.state.players[1].personalMultiplier).toBe(2);
    expect(released.state.players[1].releasedWildcards.map((tile) => tile.id)).toContain(
      "wildcard",
    );
    expect(released.state.wall).toHaveLength(beforeWall - 1);
    expect(released.state.phase).toBe("TURN_DECISION");
  });

  it("allows consecutive wildcard releases when the replacement is another wildcard", () => {
    const state = createRound({
      id: "round-consecutive-wildcards",
      dealerSeat: 0,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    const firstWildcard = makeTile("wildcard-first", state.wildcardKind);
    const secondWildcard = makeTile("wildcard-second", state.wildcardKind);
    const nextNormal = makeTile("normal-after-wildcards", { suit: "TONG", rank: 1 });
    state.players[0].hand[0] = firstWildcard;
    state.wall = [secondWildcard, nextNormal, ...state.wall];
    const wallBefore = state.wall.length;

    const firstRelease = releaseWildcard(state, 0, firstWildcard.id);
    expect(firstRelease.ok).toBe(true);
    if (!firstRelease.ok) return;
    expect(availableTurnActions(firstRelease.state, 0)).toContain("RELEASE_WILDCARD");

    const secondRelease = releaseWildcard(firstRelease.state, 0, secondWildcard.id);
    expect(secondRelease.ok).toBe(true);
    if (!secondRelease.ok) return;
    expect(secondRelease.state.players[0].personalMultiplier).toBe(4);
    expect(secondRelease.state.players[0].releasedWildcards.map((tile) => tile.id)).toEqual([
      firstWildcard.id,
      secondWildcard.id,
    ]);
    expect(secondRelease.state.wall).toHaveLength(wallBefore - 2);
    expect(secondRelease.state.lastDrawnTileId).toBe(nextNormal.id);
  });

  it("forbids self-draw immediately after pong and enables it after a wildcard replacement draw", () => {
    const state = createRound({
      id: "round-pong-self-draw",
      dealerSeat: 0,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    const pongKind: TileKind = { suit: "TIAO", rank: 3 };
    const wildcardKind: TileKind = { suit: "WAN", rank: 9 };
    const wildcard = makeTile("pong-wildcard", wildcardKind);
    state.wildcardKind = wildcardKind;
    state.indicatorTile = makeTile("forced-indicator", { suit: "WAN", rank: 8 });
    state.wall = [makeTile("winning-draw", { suit: "WAN", rank: 3 }), ...state.wall];
    const sourceHand = [
      makeTile("pong-discard", pongKind),
      ...Array.from({ length: 13 }, (_, index) =>
        makeTile(`pong-source-${index}`, {
          suit: "TONG",
          rank: ((index % 9) + 1) as TileKind["rank"],
        }),
      ),
    ];
    const responderHand = [
      makeTile("pong-match-a", pongKind),
      makeTile("pong-match-b", pongKind),
      makeTile("wan-1", { suit: "WAN", rank: 1 }),
      makeTile("wan-2", { suit: "WAN", rank: 2 }),
      wildcard,
      makeTile("wan-4", { suit: "WAN", rank: 4 }),
      makeTile("wan-5", { suit: "WAN", rank: 5 }),
      makeTile("wan-6", { suit: "WAN", rank: 6 }),
      makeTile("tong-7-a", { suit: "TONG", rank: 7 }),
      makeTile("tong-7-b", { suit: "TONG", rank: 7 }),
      makeTile("tong-7-c", { suit: "TONG", rank: 7 }),
      makeTile("tiao-9-a", { suit: "TIAO", rank: 9 }),
      makeTile("tiao-9-b", { suit: "TIAO", rank: 9 }),
    ];
    let prepared = replaceHand(state, 0, sourceHand);
    prepared = replaceHand(prepared, 1, responderHand);

    const discarded = discardTile(prepared, 0, "pong-discard");
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    const pong = claimPong(discarded.state, 1);
    expect(pong.ok).toBe(true);
    if (!pong.ok) return;

    expect(availableTurnActions(pong.state, 1)).not.toContain("DECLARE_WIN");
    expect(declareWin(pong.state, 1)).toEqual({ ok: false, code: "CANNOT_WIN" });

    const released = releaseWildcard(pong.state, 1, wildcard.id);
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(availableTurnActions(released.state, 1)).toContain("DECLARE_WIN");
    const win = declareWin(released.state, 1);
    expect(win.ok).toBe(true);
    if (!win.ok) return;
    expect(win.state.outcome).toMatchObject({ kind: "WIN", winnerSeat: 1, winType: "HARD" });
  });

  it("starts the next player turn when the only response passes", () => {
    const state = createRound({
      id: "round-4",
      dealerSeat: 0,
      baseScore: 2,
      randomInt: deterministicRandom,
    });
    const kind: TileKind = { suit: "TONG", rank: 6 };
    state.players[0].hand[0] = makeTile("discard", kind);
    state.players[1].hand[0] = makeTile("match-1", kind);
    state.players[1].hand[1] = makeTile("match-2", kind);
    const discarded = discardTile(state, 0, "discard");
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    const passed = passResponse(discarded.state, 1);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.state.currentSeat).toBe(1);
    expect(passed.state.phase).toBe("TURN_DECISION");
    expect(passed.state.players[1].hand).toHaveLength(14);
  });
});
