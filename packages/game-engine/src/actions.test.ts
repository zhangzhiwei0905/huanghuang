import type { Tile } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { concealedKongKinds, discardableTileIds, releasableWildcardIds } from "./actions.js";

const make = (id: string, rank: Tile["rank"]): Tile => ({ id, suit: "WAN", rank });

describe("legal tile actions", () => {
  it("never exposes wildcard tiles as ordinary discards", () => {
    const hand = [make("wild", 5), make("normal", 6)];
    expect(discardableTileIds(hand, { suit: "WAN", rank: 5 })).toEqual(["normal"]);
  });

  it("allows every wildcard in hand to be released while replacement tiles exist", () => {
    const hand = [make("wild", 5), make("normal", 6)];
    expect(
      releasableWildcardIds({
        hand,
        wildcardKind: { suit: "WAN", rank: 5 },
        wallRemaining: 1,
      }),
    ).toEqual(["wild"]);
    expect(
      releasableWildcardIds({
        hand,
        wildcardKind: { suit: "WAN", rank: 5 },
        wallRemaining: 0,
      }),
    ).toEqual([]);
  });

  it("does not treat four wildcard copies as a concealed kong", () => {
    const hand = [make("w1", 5), make("w2", 5), make("w3", 5), make("w4", 5)];
    expect(
      concealedKongKinds({ hand, wildcardKind: { suit: "WAN", rank: 5 }, wallRemaining: 8 }),
    ).toEqual([]);
  });
});
