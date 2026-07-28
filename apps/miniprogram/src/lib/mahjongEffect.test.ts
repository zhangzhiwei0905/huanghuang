import type { GameEffectAction, GameEffectCue } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  effectPlacement,
  effectProgress,
  effectVisualEndsAt,
  lottieResumeFrame,
  mahjongEffectKey,
  stretchLottieTiming,
  tileKindCode,
} from "./mahjongEffect.js";
import { loadMahjongAnimationData } from "../effects/mahjong/runtime.js";

function cue(overrides: Partial<GameEffectCue> = {}): GameEffectCue {
  return {
    id: "effect-1",
    action: "PONG",
    actorSeat: 0,
    tileKind: { suit: "TIAO", rank: 5 },
    winType: null,
    laiyou: false,
    startedAt: "2026-07-27T00:00:00.000Z",
    endsAt: "2026-07-27T00:00:02.000Z",
    ...overrides,
  };
}

describe("mahjong effects", () => {
  it.each([
    ["PONG", "peng"],
    ["EXPOSED_KONG", "gang"],
    ["CONCEALED_KONG", "gang"],
    ["INDICATOR_PONG_KONG", "gang"],
    ["ADDED_KONG", "bu-gang"],
    ["RELEASE_WILDCARD", "fang-lai"],
    ["WIN", "hu-pai"],
  ] satisfies [GameEffectAction, string][])("maps %s to %s", (action, key) => {
    expect(mahjongEffectKey(action)).toBe(key);
  });

  it("maps protocol suits to the generated tile-face codes", () => {
    expect(tileKindCode({ suit: "WAN", rank: 1 })).toBe("m1");
    expect(tileKindCode({ suit: "TONG", rank: 5 })).toBe("p5");
    expect(tileKindCode({ suit: "TIAO", rank: 9 })).toBe("s9");
    expect(tileKindCode(null)).toBe("s5");
  });

  it("calculates reconnect progress and clamps it to the cue window", () => {
    expect(effectProgress(cue(), Date.parse("2026-07-26T23:59:59.000Z"))).toBe(0);
    expect(effectProgress(cue(), Date.parse("2026-07-27T00:00:01.000Z"))).toBe(0.5);
    expect(effectProgress(cue(), Date.parse("2026-07-27T00:00:03.000Z"))).toBe(1);
  });

  it.each([
    ["PONG", 450],
    ["EXPOSED_KONG", 700],
    ["CONCEALED_KONG", 700],
    ["INDICATOR_PONG_KONG", 700],
    ["ADDED_KONG", 650],
    ["RELEASE_WILDCARD", 800],
    ["WIN", 1_050],
  ] satisfies [GameEffectAction, number][])(
    "caps %s rendering at the interaction deadline of %dms",
    (action, durationMs) => {
      expect(effectVisualEndsAt(cue({ action }))).toBe(
        Date.parse("2026-07-27T00:00:00.000Z") + durationMs,
      );
    },
  );

  it("stretches the source frame rate and resumes at the matching frame", () => {
    const data = stretchLottieTiming({ ip: 10, op: 70, fr: 60 }, 3_000);

    expect(data.fr).toBe(20);
    expect(lottieResumeFrame(data, 0.5)).toBe(40);
  });

  it("keeps win effects square in the viewport and pong close to the actor", () => {
    const viewport = { width: 844, height: 390 };
    expect(effectPlacement("WIN", null, viewport)).toEqual({
      left: 266,
      top: 39,
      width: 312,
      height: 312,
    });
    expect(
      effectPlacement("PONG", { left: 700, top: 120, width: 100, height: 60 }, viewport),
    ).toEqual({
      left: 567,
      top: 76,
      width: 148,
      height: 148,
    });
  });

  it("uses a compact collision-badge pong animation without runtime tile layers", () => {
    const data = loadMahjongAnimationData("peng", { suit: "WAN", rank: 1 }, 2_000);

    expect(data.ip).toBe(0);
    expect(data.op).toBe(27);
    expect(data.fr).toBe(13.5);
    expect(data.meta?.presentation).toBe("collision-badge");
    expect(data.layers?.map((layer) => layer.nm)).toEqual([
      "碰 · 动作章",
      "粉屑 1",
      "粉屑 2",
      "粉屑 3",
      "粉屑 4",
      "粉屑 5",
      "粉屑 6",
      "冲击环",
      "对撞弧 左",
      "对撞弧 右",
    ]);
    expect(data.layers?.some((layer) => layer.meta?.tileSlot !== undefined)).toBe(false);
  });

  it("continues substituting authoritative tiles for effects that display them", () => {
    const data = loadMahjongAnimationData("gang", { suit: "WAN", rank: 1 }, 2_200);
    const tileLayers = data.layers?.filter((layer) => layer.meta?.tileSlot === "claim") ?? [];

    expect(tileLayers).toHaveLength(4);
    expect(tileLayers.every((layer) => layer.meta?.tileCode === "m1")).toBe(true);
  });
});
