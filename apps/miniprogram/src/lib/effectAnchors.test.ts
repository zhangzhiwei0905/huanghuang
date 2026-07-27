import type { GameEffectCue } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  dequeueEffect,
  effectPriority,
  enqueueEffect,
  relativeSeatPosition,
  stationAnchor,
} from "./effectAnchors.js";

const VIEWPORT = { width: 844, height: 390 }; // iPhone 14 landscape

function cue(id: string, action: GameEffectCue["action"]): GameEffectCue {
  return {
    id,
    action,
    actorSeat: 0,
    tileKind: null,
    winType: null,
    laiyou: false,
    startedAt: "2026-07-27T00:00:00.000Z",
    endsAt: "2026-07-27T00:00:02.000Z",
  };
}

describe("stationAnchor", () => {
  it("centers the opposite station at the top", () => {
    const anchor = stationAnchor(2, VIEWPORT);
    expect(anchor.left + anchor.width / 2).toBeCloseTo(VIEWPORT.width / 2, 0);
    expect(anchor.top).toBeCloseTo(390 * 0.012, 1);
  });

  it("keeps left/right stations in the 29% vertical band near the edges", () => {
    const left = stationAnchor(3, VIEWPORT);
    const right = stationAnchor(1, VIEWPORT);
    expect(left.top).toBeCloseTo(VIEWPORT.height * 0.29, 1);
    expect(right.top).toBeCloseTo(VIEWPORT.height * 0.29, 1);
    expect(left.left).toBeLessThan(VIEWPORT.width * 0.1);
    expect(right.left + right.width).toBeGreaterThan(VIEWPORT.width * 0.9);
  });

  it("places self above the hand tray at the bottom right", () => {
    const self = stationAnchor(0, VIEWPORT);
    expect(self.top + self.height).toBeLessThanOrEqual(VIEWPORT.height - 62);
    expect(self.left + self.width).toBeCloseTo(VIEWPORT.width - 390 * 0.012, 0);
  });

  it("every anchor stays inside the viewport", () => {
    for (const position of [0, 1, 2, 3] as const) {
      const anchor = stationAnchor(position, VIEWPORT);
      expect(anchor.left).toBeGreaterThanOrEqual(0);
      expect(anchor.top).toBeGreaterThanOrEqual(0);
      expect(anchor.left + anchor.width).toBeLessThanOrEqual(VIEWPORT.width + 1);
      expect(anchor.top + anchor.height).toBeLessThanOrEqual(VIEWPORT.height + 1);
    }
  });
});

describe("relativeSeatPosition", () => {
  it("maps absolute seats to viewer-relative positions", () => {
    expect(relativeSeatPosition(0, 0)).toBe(0);
    expect(relativeSeatPosition(1, 0)).toBe(1);
    expect(relativeSeatPosition(2, 0)).toBe(2);
    expect(relativeSeatPosition(3, 0)).toBe(3);
    expect(relativeSeatPosition(0, 1)).toBe(3);
    expect(relativeSeatPosition(3, 2)).toBe(1);
  });
});

describe("effect queue", () => {
  it("plays immediately when idle", () => {
    const result = enqueueEffect([], cue("a", "PONG"));
    expect(result.items.map((item) => item.cue.id)).toEqual(["a"]);
    expect(result.preempted).toBe(false);
  });

  it("queues a same-or-lower priority follow-up", () => {
    const playing = enqueueEffect([], cue("a", "EXPOSED_KONG")).items;
    const result = enqueueEffect(playing, cue("b", "PONG"));
    expect(result.items.map((item) => item.cue.id)).toEqual(["a", "b"]);
    expect(result.preempted).toBe(false);
  });

  it("preempts the current effect for a win", () => {
    const playing = enqueueEffect([], cue("a", "ADDED_KONG")).items;
    const result = enqueueEffect(playing, cue("b", "WIN"));
    expect(result.items.map((item) => item.cue.id)).toEqual(["b"]);
    expect(result.preempted).toBe(true);
  });

  it("keeps the pending slot to the newest arrival (queue depth ≤ 2)", () => {
    let items = enqueueEffect([], cue("a", "PONG")).items;
    items = enqueueEffect(items, cue("b", "PONG")).items;
    items = enqueueEffect(items, cue("c", "PONG")).items;
    expect(items.map((item) => item.cue.id)).toEqual(["a", "c"]);
  });

  it("replaces a lower-priority pending item with a higher-priority arrival", () => {
    let items = enqueueEffect([], cue("a", "EXPOSED_KONG")).items;
    items = enqueueEffect(items, cue("b", "PONG")).items;
    items = enqueueEffect(items, cue("c", "EXPOSED_KONG")).items;
    expect(items.map((item) => item.cue.id)).toEqual(["a", "c"]);
  });

  it("dequeue advances to the pending effect", () => {
    let items = enqueueEffect([], cue("a", "PONG")).items;
    items = enqueueEffect(items, cue("b", "WIN")).items;
    // WIN preempts, so "a" is dropped; a fresh enqueue after it finishes:
    items = dequeueEffect(items);
    expect(items).toEqual([]);
  });

  it("ranks priorities WIN > kong-family > pong", () => {
    expect(effectPriority(cue("w", "WIN"))).toBe(2);
    expect(effectPriority(cue("k", "CONCEALED_KONG"))).toBe(1);
    expect(effectPriority(cue("r", "RELEASE_WILDCARD"))).toBe(1);
    expect(effectPriority(cue("p", "PONG"))).toBe(0);
  });
});
