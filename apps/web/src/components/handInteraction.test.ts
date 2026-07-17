import { describe, expect, it } from "vitest";
import { decideTilePress } from "./handInteraction.js";

const ordinaryTile = { id: "wan-3", suit: "WAN" as const, rank: 3 as const };
const otherTile = { id: "tiao-6", suit: "TIAO" as const, rank: 6 as const };
const wildcardTile = { id: "tong-4", suit: "TONG" as const, rank: 4 as const };
const wildcardKind = { suit: "TONG" as const, rank: 4 as const };

describe("decideTilePress", () => {
  it("selects the first tile and switches selection to another physical tile", () => {
    expect(
      decideTilePress({
        tile: ordinaryTile,
        selectedTileId: null,
        wildcardKind,
        canDiscard: true,
        locked: false,
      }),
    ).toEqual({ kind: "select", tileId: ordinaryTile.id });

    expect(
      decideTilePress({
        tile: otherTile,
        selectedTileId: ordinaryTile.id,
        wildcardKind,
        canDiscard: true,
        locked: false,
      }),
    ).toEqual({ kind: "select", tileId: otherTile.id });
  });

  it("confirms a legal discard on the second press of the same ordinary tile", () => {
    expect(
      decideTilePress({
        tile: ordinaryTile,
        selectedTileId: ordinaryTile.id,
        wildcardKind,
        canDiscard: true,
        locked: false,
      }),
    ).toEqual({ kind: "discard", tileId: ordinaryTile.id });
  });

  it("keeps a wildcard selected so release still requires its explicit action", () => {
    expect(
      decideTilePress({
        tile: wildcardTile,
        selectedTileId: wildcardTile.id,
        wildcardKind,
        canDiscard: true,
        locked: false,
      }),
    ).toEqual({ kind: "keep-selection", tileId: wildcardTile.id });
  });

  it("does not submit when discard is illegal or interaction is locked", () => {
    expect(
      decideTilePress({
        tile: ordinaryTile,
        selectedTileId: ordinaryTile.id,
        wildcardKind,
        canDiscard: false,
        locked: false,
      }),
    ).toEqual({ kind: "keep-selection", tileId: ordinaryTile.id });

    expect(
      decideTilePress({
        tile: ordinaryTile,
        selectedTileId: null,
        wildcardKind,
        canDiscard: true,
        locked: true,
      }),
    ).toEqual({ kind: "ignore" });
  });
});
