import type { MeldKind, PlayerProjection, Seat, Tile } from "@huanghuang/protocol";

export type PlayerActionSnapshot = Record<
  Seat,
  {
    releasedTileIds: string[];
    melds: Record<string, MeldKind>;
  }
>;

export type PlayerActionNotice = {
  seat: Seat;
  action: "RELEASE_WILDCARD" | MeldKind;
  tiles: Tile[];
};

export const PLAYER_ACTION_LABELS: Record<PlayerActionNotice["action"], string> = {
  RELEASE_WILDCARD: "放赖",
  PONG: "碰",
  EXPOSED_KONG: "明杠",
  CONCEALED_KONG: "暗杠",
  ADDED_KONG: "补杠",
  INDICATOR_PONG_KONG: "亮牌碰杠",
};

export function createPlayerActionSnapshot(players: PlayerProjection[]): PlayerActionSnapshot {
  return Object.fromEntries(
    players.map((player) => [
      player.seat,
      {
        releasedTileIds: player.releasedWildcards.map((tile) => tile.id),
        melds: Object.fromEntries(player.melds.map((meld) => [meld.id, meld.kind])),
      },
    ]),
  ) as PlayerActionSnapshot;
}

export function detectPlayerActionNotice(
  previous: PlayerActionSnapshot,
  players: PlayerProjection[],
): PlayerActionNotice | null {
  let notice: PlayerActionNotice | null = null;

  for (const player of players) {
    const previousPlayer = previous[player.seat];
    const previousReleasedIds = new Set(previousPlayer.releasedTileIds);
    const releasedTile = player.releasedWildcards
      .filter((tile) => !previousReleasedIds.has(tile.id))
      .at(-1);
    if (releasedTile !== undefined) {
      notice = {
        seat: player.seat,
        action: "RELEASE_WILDCARD",
        tiles: [releasedTile],
      };
    }

    for (const meld of player.melds) {
      if (previousPlayer.melds[meld.id] === meld.kind) continue;
      notice = {
        seat: player.seat,
        action: meld.kind,
        tiles: meld.tileIds.map((id) => ({ id, ...meld.tileKind })),
      };
    }
  }

  return notice;
}
