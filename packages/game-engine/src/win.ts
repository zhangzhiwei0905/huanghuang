import type { Meld, Tile, TileKind, WinType } from "@huanghuang/protocol";
import { allTileKinds, compareTileKinds, sameTileKind, tileKindKey } from "./tiles.js";

export type DecompositionPart = {
  kind: "SEQUENCE" | "TRIPLET" | "PAIR";
  tileIds: string[];
};

export type WinEvaluationInput = {
  concealedTiles: Tile[];
  melds: Meld[];
  wildcardKind: TileKind;
  winningTileId: string;
};

export type WinEvaluation = {
  canWin: boolean;
  winType: WinType | null;
  wildcardUsedAsSubstitute: boolean;
  wildcardSubstituteKind: TileKind | null;
  decomposition: DecompositionPart[];
  rejectionCode: "TOO_MANY_WILDCARDS" | "INVALID_TILE_COUNT" | "NO_STANDARD_WIN" | null;
};

type TileBucket = {
  kind: TileKind;
  tiles: Tile[];
};

const noWin = (rejectionCode: NonNullable<WinEvaluation["rejectionCode"]>): WinEvaluation => ({
  canWin: false,
  winType: null,
  wildcardUsedAsSubstitute: false,
  wildcardSubstituteKind: null,
  decomposition: [],
  rejectionCode,
});

function toBuckets(tiles: readonly Tile[]): Map<string, TileBucket> {
  const buckets = new Map<string, TileBucket>();
  for (const tile of tiles) {
    const key = tileKindKey(tile);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { kind: { suit: tile.suit, rank: tile.rank }, tiles: [tile] });
    } else {
      bucket.tiles.push(tile);
    }
  }
  return buckets;
}

function cloneBuckets(source: Map<string, TileBucket>): Map<string, TileBucket> {
  return new Map(
    [...source].map(([key, bucket]) => [key, { kind: bucket.kind, tiles: [...bucket.tiles] }]),
  );
}

function takeTiles(bucket: TileBucket, count: number): Tile[] {
  if (bucket.tiles.length < count) {
    return [];
  }
  return bucket.tiles.splice(0, count);
}

function firstNonEmptyBucket(buckets: Map<string, TileBucket>): TileBucket | undefined {
  return [...buckets.values()]
    .filter((bucket) => bucket.tiles.length > 0)
    .sort((left, right) => compareTileKinds(left.kind, right.kind))[0];
}

function findGroups(
  buckets: Map<string, TileBucket>,
  groupsRemaining: number,
): DecompositionPart[] | null {
  if (groupsRemaining === 0) {
    return firstNonEmptyBucket(buckets) === undefined ? [] : null;
  }

  const first = firstNonEmptyBucket(buckets);
  if (first === undefined) {
    return null;
  }

  if (first.tiles.length >= 3) {
    const branch = cloneBuckets(buckets);
    const branchBucket = branch.get(tileKindKey(first.kind));
    if (branchBucket !== undefined) {
      const triplet = takeTiles(branchBucket, 3);
      const remaining = findGroups(branch, groupsRemaining - 1);
      if (remaining !== null) {
        return [{ kind: "TRIPLET", tileIds: triplet.map((tile) => tile.id) }, ...remaining];
      }
    }
  }

  if (first.kind.rank <= 7) {
    const secondKey = tileKindKey({
      suit: first.kind.suit,
      rank: (first.kind.rank + 1) as TileKind["rank"],
    });
    const thirdKey = tileKindKey({
      suit: first.kind.suit,
      rank: (first.kind.rank + 2) as TileKind["rank"],
    });
    const second = buckets.get(secondKey);
    const third = buckets.get(thirdKey);
    if (
      second !== undefined &&
      second.tiles.length > 0 &&
      third !== undefined &&
      third.tiles.length > 0
    ) {
      const branch = cloneBuckets(buckets);
      const branchFirst = branch.get(tileKindKey(first.kind));
      const branchSecond = branch.get(secondKey);
      const branchThird = branch.get(thirdKey);
      if (branchFirst === undefined || branchSecond === undefined || branchThird === undefined) {
        throw new Error("Sequence buckets disappeared while cloning state");
      }
      const firstTile = takeTiles(branchFirst, 1)[0];
      const secondTile = takeTiles(branchSecond, 1)[0];
      const thirdTile = takeTiles(branchThird, 1)[0];
      if (firstTile !== undefined && secondTile !== undefined && thirdTile !== undefined) {
        const remaining = findGroups(branch, groupsRemaining - 1);
        if (remaining !== null) {
          return [
            {
              kind: "SEQUENCE",
              tileIds: [firstTile.id, secondTile.id, thirdTile.id],
            },
            ...remaining,
          ];
        }
      }
    }
  }

  return null;
}

function findStandardDecomposition(
  tiles: readonly Tile[],
  requiredGroups: number,
): DecompositionPart[] | null {
  if (tiles.length !== requiredGroups * 3 + 2) {
    return null;
  }
  const buckets = toBuckets(tiles);
  const pairCandidates = [...buckets.values()]
    .filter((bucket) => bucket.tiles.length >= 2)
    .sort((left, right) => compareTileKinds(left.kind, right.kind));

  for (const pairCandidate of pairCandidates) {
    const branch = cloneBuckets(buckets);
    const branchBucket = branch.get(tileKindKey(pairCandidate.kind));
    if (branchBucket === undefined) {
      continue;
    }
    const pairTiles = takeTiles(branchBucket, 2);
    const groups = findGroups(branch, requiredGroups);
    if (groups !== null) {
      return [{ kind: "PAIR", tileIds: pairTiles.map((tile) => tile.id) }, ...groups];
    }
  }
  return null;
}

function isForbiddenAnyTilePair(
  decomposition: readonly DecompositionPart[],
  wildcardTileId: string,
  winningTileId: string,
): boolean {
  if (wildcardTileId === winningTileId) {
    return false;
  }
  const pair = decomposition.find((part) => part.kind === "PAIR");
  return (
    pair !== undefined &&
    pair.tileIds.includes(wildcardTileId) &&
    pair.tileIds.includes(winningTileId)
  );
}

export function evaluateWin(input: WinEvaluationInput): WinEvaluation {
  const requiredGroups = 4 - input.melds.length;
  if (requiredGroups < 0 || input.concealedTiles.length !== requiredGroups * 3 + 2) {
    return noWin("INVALID_TILE_COUNT");
  }

  const wildcardTiles = input.concealedTiles.filter((tile) =>
    sameTileKind(tile, input.wildcardKind),
  );
  if (wildcardTiles.length > 1) {
    return noWin("TOO_MANY_WILDCARDS");
  }

  const hardDecomposition = findStandardDecomposition(input.concealedTiles, requiredGroups);
  if (hardDecomposition !== null) {
    return {
      canWin: true,
      winType: "HARD",
      wildcardUsedAsSubstitute: false,
      wildcardSubstituteKind: null,
      decomposition: hardDecomposition,
      rejectionCode: null,
    };
  }

  const wildcardTile = wildcardTiles[0];
  if (wildcardTile === undefined) {
    return noWin("NO_STANDARD_WIN");
  }

  for (const substituteKind of allTileKinds()) {
    const substitutedTiles = input.concealedTiles.map((tile) =>
      tile.id === wildcardTile.id ? { ...tile, ...substituteKind } : tile,
    );
    const decomposition = findStandardDecomposition(substitutedTiles, requiredGroups);
    if (
      decomposition !== null &&
      !isForbiddenAnyTilePair(decomposition, wildcardTile.id, input.winningTileId)
    ) {
      return {
        canWin: true,
        winType: "SOFT",
        wildcardUsedAsSubstitute: true,
        wildcardSubstituteKind: substituteKind,
        decomposition,
        rejectionCode: null,
      };
    }
  }

  return noWin("NO_STANDARD_WIN");
}
