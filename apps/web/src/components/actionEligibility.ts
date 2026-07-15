import type { Meld, PlayerProjection, RoomProjection, Tile, TileKind } from "@huanghuang/protocol";

export type ConcealedKongPayload = { suit: TileKind["suit"]; rank: TileKind["rank"] };
export type AddedKongPayload = { meldId: string; tileId: string };

export type HandHighlight = {
  /** Hand tiles eligible as a pong / indicator-pong-kong source (2-tile match). */
  pongTileIds: Set<string>;
  /** Hand tiles eligible as an exposed-kong / concealed-kong / added-kong source. */
  kongTileIds: Set<string>;
};

function sameKind(tile: { suit: string; rank: number }, kind: TileKind | null): boolean {
  return kind !== null && tile.suit === kind.suit && tile.rank === kind.rank;
}

function tileKey(tile: { suit: string; rank: number }): string {
  return `${tile.suit}-${tile.rank}`;
}

/**
 * The discard currently awaiting a claim response, or null when the room is
 * not in DISCARD_RESPONSE. During DISCARD_RESPONSE the engine keeps
 * `currentSeat` pointed at the discarder, so their last discard is the
 * pending tile.
 */
export function pendingResponseTile(room: RoomProjection): Tile | null {
  if (room.roundPhase !== "DISCARD_RESPONSE" || room.currentSeat === null) return null;
  const discarder = room.players[room.currentSeat];
  if (discarder === undefined) return null;
  return discarder.discards.at(-1) ?? null;
}

/**
 * Groups of exactly 4 same-suit-same-rank hand tiles eligible for a
 * concealed kong, excluding the wildcard kind. Multiple distinct groups can
 * be returned when the hand happens to contain two different completed
 * quads at once.
 */
export function concealedKongGroups(hand: Tile[], wildcardKind: TileKind | null): Tile[][] {
  const eligible = hand.filter((tile) => !sameKind(tile, wildcardKind));
  const grouped = new Map<string, Tile[]>();
  for (const tile of eligible) {
    const key = tileKey(tile);
    const list = grouped.get(key);
    if (list === undefined) {
      grouped.set(key, [tile]);
    } else {
      list.push(tile);
    }
  }
  return [...grouped.values()]
    .filter((tiles) => tiles.length >= 4)
    .map((tiles) => tiles.slice(0, 4));
}

/**
 * Hand tiles matching an existing self PONG meld's suit/rank, excluding the
 * wildcard kind — these are the candidate source tiles for an added kong.
 */
export function addedKongSourceTiles(
  hand: Tile[],
  melds: Meld[],
  wildcardKind: TileKind | null,
): Tile[] {
  const pongKinds = melds.filter((meld) => meld.kind === "PONG").map((meld) => meld.tileKind);
  return hand.filter(
    (tile) => !sameKind(tile, wildcardKind) && pongKinds.some((kind) => sameKind(tile, kind)),
  );
}

/** The self PONG meld matching a tile's suit/rank, if any. */
export function findAddedKongMeld(
  melds: Meld[],
  tile: { suit: string; rank: number },
): Meld | null {
  return (
    melds.find(
      (meld) =>
        meld.kind === "PONG" &&
        meld.tileKind.suit === tile.suit &&
        meld.tileKind.rank === tile.rank,
    ) ?? null
  );
}

/**
 * Derives which hand tiles should be highlighted as legal pong/kong source
 * tiles, based purely on `room.legalActions` and the player's own hand.
 * Only computes the branch(es) relevant to whichever actions are currently
 * legal, so nothing is highlighted when the matching action isn't legal.
 */
export function handHighlightGroups(room: RoomProjection, self: PlayerProjection): HandHighlight {
  const pongTileIds = new Set<string>();
  const kongTileIds = new Set<string>();
  const hand = self.hand ?? [];
  const legal = room.legalActions;
  const pendingTile = pendingResponseTile(room);

  if (pendingTile !== null) {
    if (legal.includes("CLAIM_EXPOSED_KONG")) {
      hand
        .filter((tile) => sameKind(tile, pendingTile))
        .slice(0, 3)
        .forEach((tile) => kongTileIds.add(tile.id));
    }
    if (legal.includes("CLAIM_PONG") || legal.includes("CLAIM_INDICATOR_PONG_KONG")) {
      hand
        .filter((tile) => sameKind(tile, pendingTile))
        .slice(0, 2)
        .forEach((tile) => pongTileIds.add(tile.id));
    }
  }

  if (legal.includes("DECLARE_CONCEALED_KONG")) {
    for (const group of concealedKongGroups(hand, room.wildcardKind)) {
      for (const tile of group) kongTileIds.add(tile.id);
    }
  }

  if (legal.includes("DECLARE_ADDED_KONG")) {
    for (const tile of addedKongSourceTiles(hand, self.melds, room.wildcardKind)) {
      kongTileIds.add(tile.id);
    }
  }

  return { pongTileIds, kongTileIds };
}

/**
 * Builds the DECLARE_CONCEALED_KONG payload. Prefers `preferredTileId` (the
 * user's manually selected tile) when it belongs to an eligible group,
 * otherwise falls back to the first eligible group found in the hand.
 */
export function deriveConcealedKongPayload(
  hand: Tile[],
  wildcardKind: TileKind | null,
  preferredTileId: string | null,
): ConcealedKongPayload | null {
  const groups = concealedKongGroups(hand, wildcardKind);
  if (groups.length === 0) return null;
  const preferredGroup =
    preferredTileId === null
      ? undefined
      : groups.find((group) => group.some((tile) => tile.id === preferredTileId));
  const source = (preferredGroup ?? groups[0])?.[0];
  return source === undefined ? null : { suit: source.suit, rank: source.rank };
}

/**
 * Builds the DECLARE_ADDED_KONG payload. Prefers `preferredTileId` when it
 * is an eligible source tile, otherwise falls back to the first eligible
 * hand tile found.
 */
export function deriveAddedKongPayload(
  hand: Tile[],
  melds: Meld[],
  wildcardKind: TileKind | null,
  preferredTileId: string | null,
): AddedKongPayload | null {
  const candidates = addedKongSourceTiles(hand, melds, wildcardKind);
  if (candidates.length === 0) return null;
  const preferred =
    preferredTileId === null ? undefined : candidates.find((tile) => tile.id === preferredTileId);
  const tile = preferred ?? candidates[0];
  if (tile === undefined) return null;
  const meld = findAddedKongMeld(melds, tile);
  return meld === null ? null : { meldId: meld.id, tileId: tile.id };
}
