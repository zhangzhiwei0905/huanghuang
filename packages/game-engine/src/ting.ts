import type { Meld, Tile, TileKind, WinType } from "@huanghuang/protocol";
import { discardableTileIds } from "./actions.js";
import { allTileKinds, sameTileKind, tileKindKey } from "./tiles.js";
import { evaluateWin } from "./win.js";

export type TingWait = {
  tileKind: TileKind;
  winType: WinType;
};

export type DiscardTingOption = {
  discardTileId: string;
  waits: TingWait[];
};

export function analyzeDiscardTingOptions(input: {
  concealedTiles: readonly Tile[];
  melds: readonly Meld[];
  wildcardKind: TileKind;
}): DiscardTingOption[] {
  return discardableTileIds(input.concealedTiles, input.wildcardKind).map((discardTileId) => {
    const tilesAfterDiscard = input.concealedTiles.filter((tile) => tile.id !== discardTileId);
    const alreadyHasWildcard = tilesAfterDiscard.some((tile) =>
      sameTileKind(tile, input.wildcardKind),
    );
    const waits = allTileKinds().flatMap((tileKind): TingWait[] => {
      if (alreadyHasWildcard && sameTileKind(tileKind, input.wildcardKind)) {
        return [];
      }
      const winningTile: Tile = {
        id: `ting-${discardTileId}-${tileKindKey(tileKind)}`,
        ...tileKind,
      };
      const evaluation = evaluateWin({
        concealedTiles: [...tilesAfterDiscard, winningTile],
        melds: [...input.melds],
        wildcardKind: input.wildcardKind,
        winningTileId: winningTile.id,
      });
      return evaluation.canWin && evaluation.winType !== null
        ? [{ tileKind, winType: evaluation.winType }]
        : [];
    });
    return { discardTileId, waits };
  });
}
