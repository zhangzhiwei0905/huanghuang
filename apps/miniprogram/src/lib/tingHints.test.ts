import type { DiscardTingProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { indexTingHints, orderTingWaits, tingCardAnchor } from "./tingHints";

const hints: DiscardTingProjection[] = [
  {
    discardTileId: "ting-tile",
    waits: [
      {
        tileKind: { suit: "WAN", rank: 3 },
        winType: "HARD",
        multiplier: 4,
        remainingCount: 2,
      },
    ],
  },
  { discardTileId: "ordinary-tile", waits: [] },
];

describe("ting hint presentation helpers", () => {
  it("indexes only physical discards that have waits", () => {
    const indexed = indexTingHints(hints);

    expect(indexed.get("ting-tile")).toEqual(hints[0]?.waits);
    expect(indexed.has("ordinary-tile")).toBe(false);
  });

  it("anchors edge tiles inward and middle tiles around their center", () => {
    const tileIds = ["a", "b", "c", "d", "e", "f", "g", "h"];

    expect(tingCardAnchor(tileIds, "a")).toEqual({
      alignment: "start",
      positionPercent: 6.25,
    });
    expect(tingCardAnchor(tileIds, "d")).toEqual({
      alignment: "center",
      positionPercent: 43.75,
    });
    expect(tingCardAnchor(tileIds, "h")).toEqual({
      alignment: "end",
      positionPercent: 93.75,
    });
    expect(tingCardAnchor(tileIds, "missing")).toBeNull();
  });

  it("shows hard waits before soft waits without changing their server values", () => {
    const waits: DiscardTingProjection["waits"] = [
      {
        tileKind: { suit: "WAN", rank: 9 },
        winType: "SOFT",
        multiplier: 8,
        remainingCount: 3,
      },
      {
        tileKind: { suit: "TIAO", rank: 9 },
        winType: "HARD",
        multiplier: 16,
        remainingCount: 1,
      },
    ];

    expect(orderTingWaits(waits)).toEqual([waits[1], waits[0]]);
    expect(waits[0]?.winType).toBe("SOFT");
  });
});
