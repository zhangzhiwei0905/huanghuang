import type { TileKind } from "@huanghuang/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MahjongTile, tileArtworkFilename, tileArtworkUrl } from "./MahjongTile.js";

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const SUITS = [
  { suit: "WAN", prefix: "wan" },
  { suit: "TIAO", prefix: "tiao" },
  { suit: "TONG", prefix: "tong" },
] as const;

describe("mahjong tile artwork", () => {
  it("maps every suited tile to the expected SVG filename", () => {
    for (const { suit, prefix } of SUITS) {
      for (const rank of RANKS) {
        const tile: TileKind = { suit, rank };
        expect(tileArtworkFilename(tile)).toBe(`${prefix}-${rank}.svg`);
      }
    }
  });

  it("resolves an imported SVG URL for all 27 tile kinds", () => {
    for (const { suit } of SUITS) {
      for (const rank of RANKS) {
        const tile: TileKind = { suit, rank };
        expect(tileArtworkUrl(tile)).toMatch(/^(?:data:image\/svg\+xml|\/)/);
      }
    }
  });

  it("keeps wildcard identity and accessibility on the SVG tile component", () => {
    const wildcardKind: TileKind = { suit: "TIAO", rank: 3 };
    const markup = renderToStaticMarkup(
      createElement(MahjongTile, {
        tile: { id: "wildcard-kind-preview", ...wildcardKind },
        wildcardKind,
        compact: true,
      }),
    );

    expect(markup).toContain("tile-face-artwork");
    expect(markup).toContain("is-wildcard");
    expect(markup).toContain("is-compact");
    expect(markup).toContain('aria-label="3条，赖子"');
    expect(markup).toContain("tile-badge");
  });
});
