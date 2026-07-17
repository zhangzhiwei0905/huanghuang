import type { CommandEnvelope } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import {
  hasValidTileSelection,
  isPrimaryGameAction,
  primaryActionButtons,
} from "./actionButtons.js";

function actions(...values: CommandEnvelope["type"][]): CommandEnvelope["type"][] {
  return values;
}

describe("primaryActionButtons", () => {
  it("renders nothing when no primary action is legal", () => {
    expect(primaryActionButtons(actions("PASS_RESPONSE"))).toEqual([]);
  });

  it("keeps only the legal turn actions in the requested visual order", () => {
    expect(
      primaryActionButtons(
        actions("DECLARE_WIN", "CONTINUE_TURN", "RELEASE_WILDCARD", "DISCARD_TILE"),
      ).map(({ kind, label }) => ({ kind, label })),
    ).toEqual([
      { kind: "discard", label: "出牌" },
      { kind: "wildcard", label: "放赖" },
      { kind: "win", label: "自摸" },
    ]);
  });

  it("shows only pong and kong for a discard response", () => {
    expect(
      primaryActionButtons(actions("CLAIM_EXPOSED_KONG", "CLAIM_PONG", "PASS_RESPONSE")),
    ).toEqual([
      { kind: "pong", action: "CLAIM_PONG", label: "碰", detail: "碰牌" },
      { kind: "kong", action: "CLAIM_EXPOSED_KONG", label: "杠", detail: "明杠" },
    ]);
  });

  it("maps the indicator claim to pong and preserves its special detail", () => {
    expect(primaryActionButtons(actions("CLAIM_INDICATOR_PONG_KONG"))).toEqual([
      {
        kind: "pong",
        action: "CLAIM_INDICATOR_PONG_KONG",
        label: "碰",
        detail: "亮牌碰杠",
      },
    ]);
  });

  it("keeps auxiliary actions outside the primary action family", () => {
    expect(isPrimaryGameAction("DISCARD_TILE")).toBe(true);
    expect(isPrimaryGameAction("PASS_RESPONSE")).toBe(false);
    expect(isPrimaryGameAction("CONTINUE_TURN")).toBe(false);
  });

  it("requires a non-wildcard tile for discard and the wildcard tile for release", () => {
    const wildcard = { suit: "TIAO" as const, rank: 3 as const };
    const wildcardTile = { id: "wildcard-1", ...wildcard };
    const ordinaryTile = { id: "ordinary-1", suit: "WAN" as const, rank: 5 as const };

    expect(hasValidTileSelection("DISCARD_TILE", null, wildcard)).toBe(false);
    expect(hasValidTileSelection("DISCARD_TILE", wildcardTile, wildcard)).toBe(false);
    expect(hasValidTileSelection("DISCARD_TILE", ordinaryTile, wildcard)).toBe(true);
    expect(hasValidTileSelection("RELEASE_WILDCARD", ordinaryTile, wildcard)).toBe(false);
    expect(hasValidTileSelection("RELEASE_WILDCARD", wildcardTile, wildcard)).toBe(true);
  });
});
