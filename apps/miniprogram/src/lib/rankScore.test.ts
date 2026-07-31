import { describe, expect, it } from "vitest";
import type { PublicCompetitiveProfile } from "@huanghuang/protocol";
import { rankScore } from "./rankScore.js";

const profile = (
  majorIndex: number,
  minorLabel: "Ⅴ" | "Ⅳ" | "Ⅲ" | "Ⅱ" | "Ⅰ" | null,
): PublicCompetitiveProfile => ({
  rankDisplay: {
    majorIndex: majorIndex as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
    majorName: "黑铁",
    minorLabel,
    displayName: "x",
  },
  achievements: {
    exposedKong: 0,
    indicatorPongKong: 0,
    addedKong: 0,
    concealedKong: 0,
    releaseWildcard: 0,
    hardLaiyou: 0,
    softLaiyou: 0,
  },
});

describe("rankScore", () => {
  it("scores null profile as -1 so new players sort last", () => {
    expect(rankScore(null)).toBe(-1);
  });

  it("increases with majorIndex", () => {
    expect(rankScore(profile(0, "Ⅰ"))).toBeLessThan(rankScore(profile(1, "Ⅴ")));
    expect(rankScore(profile(3, "Ⅴ"))).toBeLessThan(rankScore(profile(4, "Ⅴ")));
  });

  it("increases with minor label within a tier (Ⅴ lowest, Ⅰ highest)", () => {
    expect(rankScore(profile(2, "Ⅴ"))).toBeLessThan(rankScore(profile(2, "Ⅳ")));
    expect(rankScore(profile(2, "Ⅳ"))).toBeLessThan(rankScore(profile(2, "Ⅲ")));
    expect(rankScore(profile(2, "Ⅱ"))).toBeLessThan(rankScore(profile(2, "Ⅰ")));
  });

  it("treats null minor as the lowest step of its tier", () => {
    expect(rankScore(profile(0, null))).toBe(0);
    expect(rankScore(profile(0, null))).toBeLessThanOrEqual(rankScore(profile(0, "Ⅴ")));
  });
});
