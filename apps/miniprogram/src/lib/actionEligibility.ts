import type { Meld, PlayerProjection, RoomProjection, Tile, TileKind } from "@huanghuang/protocol";

export type ConcealedKongPayload = { suit: TileKind["suit"]; rank: TileKind["rank"] };
export type AddedKongPayload = { meldId: string; tileId: string };

function sameKind(tile: { suit: string; rank: number }, kind: TileKind | null): boolean {
  return kind !== null && tile.suit === kind.suit && tile.rank === kind.rank;
}

function tileKey(tile: { suit: string; rank: number }): string {
  return `${tile.suit}-${tile.rank}`;
}

export function pendingResponseTile(room: RoomProjection): Tile | null {
  if (room.roundPhase !== "DISCARD_RESPONSE" || room.currentSeat === null) return null;
  const discarder = room.players[room.currentSeat];
  if (discarder === undefined) return null;
  return discarder.discards.length > 0
    ? (discarder.discards[discarder.discards.length - 1] ?? null)
    : null;
}

export function concealedKongGroups(hand: Tile[], wildcardKind: TileKind | null): Tile[][] {
  const eligible = hand.filter((tile) => !sameKind(tile, wildcardKind));
  const grouped = new Map<string, Tile[]>();
  for (const tile of eligible) {
    const key = tileKey(tile);
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [tile]);
    else list.push(tile);
  }
  return [...grouped.values()]
    .filter((tiles) => tiles.length >= 4)
    .map((tiles) => tiles.slice(0, 4));
}

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

export function deriveConcealedKongPayload(
  room: RoomProjection,
  self: PlayerProjection,
  selectedTile: Tile | null,
): ConcealedKongPayload | null {
  if (!room.legalActions.includes("DECLARE_CONCEALED_KONG")) return null;
  const groups = concealedKongGroups(self.hand ?? [], room.wildcardKind);
  if (groups.length === 0) return null;
  const preferred =
    selectedTile === null
      ? groups[0]
      : (groups.find((group) => group.some((tile) => tile.id === selectedTile.id)) ?? groups[0]);
  if (preferred === undefined || preferred[0] === undefined) return null;
  return { suit: preferred[0].suit, rank: preferred[0].rank };
}

export function deriveAddedKongPayload(
  room: RoomProjection,
  self: PlayerProjection,
  selectedTile: Tile | null,
): AddedKongPayload | null {
  if (!room.legalActions.includes("DECLARE_ADDED_KONG")) return null;
  const hand = self.hand ?? [];
  const candidates = hand.filter((tile) => findAddedKongMeld(self.melds, tile) !== null);
  if (candidates.length === 0) return null;
  const tile =
    selectedTile !== null && candidates.some((item) => item.id === selectedTile.id)
      ? selectedTile
      : candidates[0];
  if (tile === undefined) return null;
  const meld = findAddedKongMeld(self.melds, tile);
  if (meld === null) return null;
  return { meldId: meld.id, tileId: tile.id };
}
