import type { Seat, Tile, TileKind } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  availableTurnActions,
  claimExposedKong,
  claimIndicatorPongKong,
  claimPong,
  createRound,
  declareAddedKong,
  declareConcealedKong,
  declareWin,
  discardTile,
  passResponse,
  releaseWildcard,
  type RoundState,
  type RuleResult,
} from "./round.js";
import { chooseBotAction, chooseBotDiscard, type BotAction, type BotDecisionView } from "./bot.js";
import type { RandomInt } from "./tiles.js";

function tile(id: string, suit: TileKind["suit"], rank: TileKind["rank"]): Tile {
  return { id, suit, rank };
}

function view(options: Partial<BotDecisionView> & Pick<BotDecisionView, "hand">): BotDecisionView {
  return {
    seat: 0,
    phase: "TURN_DECISION",
    legalActions: ["DISCARD_TILE"],
    botDifficulty: "HIGH",
    winType: null,
    melds: [],
    releasedWildcards: [],
    wildcardKind: { suit: "TIAO", rank: 8 },
    indicatorTile: tile("indicator", "TIAO", 7),
    wallRemaining: 40,
    pendingDiscard: null,
    publicPlayers: [],
    ...options,
  };
}

const first: RandomInt = () => 0;

function seededRandom(seed: number): RandomInt {
  let state = seed >>> 0;
  return (max) => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return max <= 1 ? 0 : state % max;
  };
}

function botView(state: RoundState, seat: Seat): BotDecisionView {
  return {
    seat,
    phase: state.phase === "DISCARD_RESPONSE" ? "DISCARD_RESPONSE" : "TURN_DECISION",
    legalActions:
      state.phase === "DISCARD_RESPONSE"
        ? [...(state.pendingResponse?.actions ?? []), "PASS_RESPONSE"]
        : availableTurnActions(state, seat),
    botDifficulty: "HIGH",
    winType: null,
    hand: state.players[seat].hand,
    melds: state.players[seat].melds,
    releasedWildcards: state.players[seat].releasedWildcards,
    wildcardKind: state.wildcardKind,
    indicatorTile: state.indicatorTile,
    wallRemaining: state.wall.length,
    pendingDiscard: state.lastDiscard?.tile ?? null,
    publicPlayers: ([0, 1, 2, 3] as const).map((publicSeat) => ({
      seat: publicSeat,
      melds: state.players[publicSeat].melds,
      discards: state.players[publicSeat].discards,
      releasedWildcards: state.players[publicSeat].releasedWildcards,
    })),
  };
}

function applyBotAction(state: RoundState, seat: Seat, action: BotAction): RuleResult {
  switch (action.type) {
    case "DECLARE_WIN":
      return declareWin(state, seat);
    case "RELEASE_WILDCARD":
      return releaseWildcard(state, seat, action.tileId);
    case "DECLARE_CONCEALED_KONG":
      return declareConcealedKong(state, seat, action.tileKind);
    case "DECLARE_ADDED_KONG":
      return declareAddedKong(state, seat, action.meldId, action.tileId);
    case "DISCARD_TILE":
      return discardTile(state, seat, action.tileId);
    case "CLAIM_PONG":
      return claimPong(state, seat);
    case "CLAIM_EXPOSED_KONG":
      return claimExposedKong(state, seat);
    case "CLAIM_INDICATOR_PONG_KONG":
      return claimIndicatorPongKong(state, seat);
    case "PASS_RESPONSE":
      return passResponse(state, seat);
  }
}

describe("balanced bot strategy", () => {
  it("keeps a useful drawn tile and discards an isolated tile instead", () => {
    const drawn = tile("drawn-wan-6", "WAN", 6);
    const hand = [
      tile("wan-1", "WAN", 1),
      tile("wan-2", "WAN", 2),
      tile("wan-3", "WAN", 3),
      tile("wan-4", "WAN", 4),
      tile("wan-5", "WAN", 5),
      tile("tiao-2", "TIAO", 2),
      tile("tiao-3", "TIAO", 3),
      tile("tiao-4", "TIAO", 4),
      tile("tong-7-a", "TONG", 7),
      tile("tong-7-b", "TONG", 7),
      tile("isolated-tong-1", "TONG", 1),
      tile("isolated-tiao-9", "TIAO", 9),
      tile("isolated-tong-9", "TONG", 9),
      drawn,
    ];

    const selected = chooseBotDiscard(view({ hand }), first);

    expect(selected).not.toBe(drawn.id);
    expect(["isolated-tong-1", "isolated-tiao-9", "isolated-tong-9"]).toContain(selected);
  });

  it("uses injected randomness when physical duplicates have the same value", () => {
    const hand = [tile("wan-9-a", "WAN", 9), tile("wan-9-b", "WAN", 9)];
    const chooseLast: RandomInt = (max) => Math.max(0, max - 1);

    expect(chooseBotDiscard(view({ hand }), first)).toBe("wan-9-a");
    expect(chooseBotDiscard(view({ hand }), chooseLast)).toBe("wan-9-b");
  });

  it("declares a win and releases an excess wildcard before discarding", () => {
    const normalHand = [tile("normal", "WAN", 1)];
    expect(
      chooseBotAction(
        view({ hand: normalHand, legalActions: ["DECLARE_WIN", "DISCARD_TILE"] }),
        first,
      ),
    ).toEqual({ type: "DECLARE_WIN" });

    const wildcardKind: TileKind = { suit: "TIAO", rank: 8 };
    const wildcardHand = [
      tile("wildcard-a", wildcardKind.suit, wildcardKind.rank),
      tile("wildcard-b", wildcardKind.suit, wildcardKind.rank),
      tile("normal", "WAN", 1),
    ];
    expect(
      chooseBotAction(
        view({
          hand: wildcardHand,
          wildcardKind,
          legalActions: ["RELEASE_WILDCARD", "DISCARD_TILE"],
        }),
        first,
      ),
    ).toEqual({ type: "RELEASE_WILDCARD", tileId: "wildcard-a" });
  });

  it("lets low difficulty bots take hard wins but decline soft wins", () => {
    const normalHand = [tile("normal", "WAN", 1)];
    expect(
      chooseBotAction(
        view({
          hand: normalHand,
          legalActions: ["DECLARE_WIN", "DISCARD_TILE"],
          botDifficulty: "LOW",
          winType: "HARD",
        }),
        first,
      ),
    ).toEqual({ type: "DECLARE_WIN" });
    expect(
      chooseBotAction(
        view({
          hand: normalHand,
          legalActions: ["DECLARE_WIN", "DISCARD_TILE"],
          botDifficulty: "LOW",
          winType: "SOFT",
        }),
        first,
      ),
    ).toEqual({ type: "DISCARD_TILE", tileId: "normal" });
  });

  it("passes a pong that would leave a worse post-claim hand", () => {
    const discard = tile("discard", "WAN", 9);
    const responseView = view({
      hand: [
        tile("wan-9-a", "WAN", 9),
        tile("wan-9-b", "WAN", 9),
        tile("wan-1", "WAN", 1),
        tile("wan-2", "WAN", 2),
        tile("wan-3", "WAN", 3),
        tile("wan-4", "WAN", 4),
        tile("wan-5", "WAN", 5),
        tile("wan-6", "WAN", 6),
        tile("tiao-1", "TIAO", 1),
        tile("tiao-2", "TIAO", 2),
        tile("tiao-3", "TIAO", 3),
        tile("tong-4", "TONG", 4),
        tile("tong-5", "TONG", 5),
      ],
      phase: "DISCARD_RESPONSE",
      legalActions: ["CLAIM_PONG", "PASS_RESPONSE"],
      pendingDiscard: discard,
    });

    expect(chooseBotAction(responseView, first)).toEqual({ type: "PASS_RESPONSE" });
  });

  it("releases a lone wildcard when four open melds make it a dead pair wait", () => {
    const wildcardKind: TileKind = { suit: "TIAO", rank: 8 };
    const melds = Array.from({ length: 4 }, (_, index) => ({
      id: `meld-${index}`,
      kind: "PONG" as const,
      tileIds: [`meld-${index}-a`, `meld-${index}-b`, `meld-${index}-c`],
      tileKind: { suit: "WAN" as const, rank: (index + 1) as TileKind["rank"] },
      sourcePlayerId: "seat-1",
      sourceDiscardId: `discard-${index}`,
      createdAtVersion: index + 1,
    }));
    const wildcard = tile("lone-wildcard", wildcardKind.suit, wildcardKind.rank);

    expect(
      chooseBotAction(
        view({
          hand: [wildcard, tile("drawn", "TONG", 3)],
          melds,
          wildcardKind,
          legalActions: ["RELEASE_WILDCARD", "DISCARD_TILE"],
        }),
        first,
      ),
    ).toEqual({ type: "RELEASE_WILDCARD", tileId: wildcard.id });
  });

  it("takes guaranteed kong value during a discard response", () => {
    const discard = tile("discard", "TONG", 5);
    const responseView = view({
      hand: [tile("match-a", "TONG", 5), tile("match-b", "TONG", 5), tile("match-c", "TONG", 5)],
      phase: "DISCARD_RESPONSE",
      legalActions: ["CLAIM_EXPOSED_KONG", "CLAIM_PONG", "PASS_RESPONSE"],
      pendingDiscard: discard,
    });

    expect(chooseBotAction(responseView, first)).toEqual({ type: "CLAIM_EXPOSED_KONG" });
  });

  it("finishes seeded rounds legally and produces bot wins", () => {
    let wins = 0;
    const rounds = 12;

    for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
      const randomInt = seededRandom(roundIndex + 1);
      let state = createRound({
        id: `simulated-${roundIndex}`,
        dealerSeat: (roundIndex % 4) as Seat,
        baseScore: 2,
        randomInt,
      });

      for (let step = 0; state.outcome === null && step < 500; step += 1) {
        const seat =
          state.phase === "DISCARD_RESPONSE" ? state.pendingResponse?.seat : state.currentSeat;
        if (seat === undefined) throw new Error("Simulation lost its acting seat");
        const action = chooseBotAction(botView(state, seat), randomInt);
        if (action === null) throw new Error("Bot did not choose a legal action");
        const result = applyBotAction(state, seat, action);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`Bot action was rejected: ${result.code}`);
        state = result.state;
      }

      expect(state.outcome).not.toBeNull();
      if (state.outcome?.kind === "WIN") wins += 1;
    }

    expect(wins).toBeGreaterThan(0);
  }, 30_000);
});
