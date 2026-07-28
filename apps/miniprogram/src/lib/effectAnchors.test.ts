import { describe, expect, it } from "vitest";
import { relativeSeatPosition, stationEffectAnchor } from "./effectAnchors.js";

const VIEWPORT = { width: 844, height: 390 };

describe("effect station anchors", () => {
  it("maps absolute seats into the viewer's relative positions", () => {
    expect(relativeSeatPosition(0, 0)).toBe(0);
    expect(relativeSeatPosition(1, 0)).toBe(1);
    expect(relativeSeatPosition(0, 1)).toBe(3);
    expect(relativeSeatPosition(3, 2)).toBe(1);
  });

  it("keeps every synchronous anchor inside the landscape viewport", () => {
    for (const position of [0, 1, 2, 3] as const) {
      const anchor = stationEffectAnchor(position, VIEWPORT);
      expect(anchor.left).toBeGreaterThanOrEqual(0);
      expect(anchor.top).toBeGreaterThanOrEqual(0);
      expect(anchor.left + anchor.width).toBeLessThanOrEqual(VIEWPORT.width + 1);
      expect(anchor.top + anchor.height).toBeLessThanOrEqual(VIEWPORT.height + 1);
    }
  });

  it("mirrors the top, side and self station bands", () => {
    const opposite = stationEffectAnchor(2, VIEWPORT);
    const right = stationEffectAnchor(1, VIEWPORT);
    const self = stationEffectAnchor(0, VIEWPORT);

    expect(opposite.left + opposite.width / 2).toBeCloseTo(VIEWPORT.width / 2, 0);
    expect(right.top).toBeCloseTo(VIEWPORT.height * 0.29, 1);
    expect(self.top + self.height).toBeLessThanOrEqual(VIEWPORT.height - 62);
  });
});
