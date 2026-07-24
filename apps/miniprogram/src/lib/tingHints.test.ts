import type { DiscardTingProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { indexTingHints, tingCardAnchor } from "./tingHints";

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
});
