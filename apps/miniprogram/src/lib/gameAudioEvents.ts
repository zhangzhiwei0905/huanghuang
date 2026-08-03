import type {
  GameEffectCue,
  MeldKind,
  RoomProjection,
  Seat,
  Tile,
  WinType,
} from "@huanghuang/protocol";

type TileRank = Tile["rank"];

// "action-win.mp3" is intentionally absent: no code path below ever selects
// it (winAudioFileName only returns yinghu.mp3/ruanhu.mp3, effectAudioFileName
// never routes WIN through meldAudioFileName), so it's a dead asset — see
// scripts/trim-audio.mjs for the full dead-asset list and rationale.
export type GameAudioFileName =
  | `tile-wan-${TileRank}.mp3`
  | `tile-tiao-${TileRank}.mp3`
  | `tile-tong-${TileRank}.mp3`
  | "action-pong.mp3"
  | "action-kong.mp3"
  | "action-release-wildcard.mp3"
  | "action-added-kong.mp3"
  | "yinghu.mp3"
  | "ruanhu.mp3"
  | "chaotiangang.mp3"
  | "gkd-xmz.mp3";

type PlayerAudioSnapshot = {
  discardIds: Set<string>;
  releasedWildcardIds: Set<string>;
  meldKinds: Map<string, MeldKind>;
};

export type GameAudioSnapshot = {
  roomId: string;
  roundId: string | null;
  version: number;
  players: Partial<Record<Seat, PlayerAudioSnapshot>>;
  settlementRoundId: string | null;
  effectCue: Pick<GameEffectCue, "id" | "action" | "winType"> | null;
};

export type GameAudioTracker = {
  snapshot: GameAudioSnapshot | null;
  armed: boolean;
};

const TILE_SUIT_FILE_PREFIX: Record<Tile["suit"], "wan" | "tiao" | "tong"> = {
  WAN: "wan",
  TIAO: "tiao",
  TONG: "tong",
};

export function tileAudioFileName(tile: Pick<Tile, "suit" | "rank">): GameAudioFileName {
  return `tile-${TILE_SUIT_FILE_PREFIX[tile.suit]}-${tile.rank}.mp3`;
}

function meldAudioFileName(kind: MeldKind): GameAudioFileName {
  if (kind === "PONG") return "action-pong.mp3";
  if (kind === "ADDED_KONG") return "action-added-kong.mp3";
  if (kind === "INDICATOR_PONG_KONG") return "chaotiangang.mp3";
  return "action-kong.mp3";
}

const WIN_AUDIO_FILE: Record<WinType, GameAudioFileName> = {
  HARD: "yinghu.mp3",
  SOFT: "ruanhu.mp3",
};

// 来由 is its own semantic audio event, currently mapped onto the plain hard/soft
// win clips. When dedicated 来由 audio lands, only this table changes — remember
// to also add the new file name(s) to AUDIO_FILE_NAMES in gameAudioPlayer.ts
// (so they get warmed up/cached) and to AUDIO_WINDOWS in
// scripts/trim-audio.mjs (so a trimmed clip actually exists to play).
const LAIYOU_AUDIO_FILE: Record<WinType, GameAudioFileName> = {
  HARD: "yinghu.mp3",
  SOFT: "ruanhu.mp3",
};

export function winAudioFileName(winType: WinType | null, laiyou: boolean): GameAudioFileName {
  const table = laiyou ? LAIYOU_AUDIO_FILE : WIN_AUDIO_FILE;
  return table[winType ?? "SOFT"];
}

function effectAudioFileName(cue: GameEffectCue): GameAudioFileName {
  if (cue.action === "RELEASE_WILDCARD") return "action-release-wildcard.mp3";
  if (cue.action === "WIN") return winAudioFileName(cue.winType, cue.laiyou);
  return meldAudioFileName(cue.action);
}

const VOICE_MESSAGE_AUDIO: Record<string, GameAudioFileName> = {
  搞快点: "gkd-xmz.mp3",
};

export function voiceMessageAudioFileName(message: string): GameAudioFileName | null {
  return VOICE_MESSAGE_AUDIO[message] ?? null;
}

export const VOICE_MESSAGES: { label: string; text: string }[] = [
  { label: "催", text: "搞快点" },
];

export function createGameAudioSnapshot(room: RoomProjection): GameAudioSnapshot {
  return {
    roomId: room.roomId,
    roundId: room.roundId,
    version: room.version,
    players: Object.fromEntries(
      room.players.map((player) => [
        player.seat,
        {
          discardIds: new Set(player.discards.map((tile) => tile.id)),
          releasedWildcardIds: new Set(player.releasedWildcards.map((tile) => tile.id)),
          meldKinds: new Map(player.melds.map((meld) => [meld.id, meld.kind])),
        },
      ]),
    ) as Partial<Record<Seat, PlayerAudioSnapshot>>,
    settlementRoundId: room.roundSettlement?.roundId ?? null,
    effectCue:
      room.effectCue === null
        ? null
        : {
            id: room.effectCue.id,
            action: room.effectCue.action,
            winType: room.effectCue.winType,
          },
  };
}

export function detectGameAudioFiles(
  previous: GameAudioSnapshot,
  room: RoomProjection,
): GameAudioFileName[] {
  if (
    previous.roomId !== room.roomId ||
    previous.roundId === null ||
    previous.roundId !== room.roundId ||
    room.version !== previous.version + 1
  ) {
    return [];
  }

  const files: GameAudioFileName[] = [];
  const newEffectCue =
    room.effectCue !== null && room.effectCue.id !== previous.effectCue?.id ? room.effectCue : null;
  if (newEffectCue !== null) files.push(effectAudioFileName(newEffectCue));

  // The server publishes the cue first, then applies the already-accepted
  // state transition in the next room version. The cue start owns the action
  // voice; suppress the matching public-state diff when the cue completes.
  const completingEffect = previous.effectCue !== null && room.effectCue === null;
  for (const player of room.players) {
    const before = previous.players[player.seat];
    if (before === undefined) continue;

    for (const tile of player.discards) {
      if (!before.discardIds.has(tile.id)) files.push(tileAudioFileName(tile));
    }
    if (!completingEffect) {
      for (const tile of player.releasedWildcards) {
        if (!before.releasedWildcardIds.has(tile.id)) {
          files.push("action-release-wildcard.mp3");
        }
      }
      for (const meld of player.melds) {
        if (before.meldKinds.get(meld.id) !== meld.kind) {
          files.push(meldAudioFileName(meld.kind));
        }
      }
    }
  }

  const settlement = room.roundSettlement;
  if (
    !completingEffect &&
    settlement?.kind === "WIN" &&
    settlement.roundId !== previous.settlementRoundId
  ) {
    files.push(winAudioFileName(settlement.winType, settlement.laiyou));
  }
  return files;
}

export function createGameAudioTracker(): GameAudioTracker {
  return { snapshot: null, armed: false };
}

export function updateGameAudioTracker(
  tracker: GameAudioTracker,
  room: RoomProjection | null,
  connected: boolean,
): GameAudioFileName[] {
  const previous = tracker.snapshot;
  const wasArmed = tracker.armed;
  tracker.snapshot = room === null ? null : createGameAudioSnapshot(room);
  tracker.armed = room !== null && connected;

  if (room === null || !connected || !wasArmed || previous === null) return [];
  return detectGameAudioFiles(previous, room);
}
