import type { CompetitiveMultiplier, RoomProjection } from "@huanghuang/protocol";

function competitiveMultiplier(value: number): CompetitiveMultiplier {
  if (
    value === 1 ||
    value === 2 ||
    value === 4 ||
    value === 8 ||
    value === 16 ||
    value === 32 ||
    value === 64
  ) {
    return value;
  }
  throw new Error(`Invalid competitive multiplier ${String(value)}`);
}

export function normalizeRoomProjection(projection: RoomProjection): RoomProjection {
  const legacy = projection as RoomProjection & {
    effectCue?: RoomProjection["effectCue"];
    competitiveMatch?: RoomProjection["competitiveMatch"];
    teamMatchmaking?: RoomProjection["teamMatchmaking"];
  };
  if (
    projection.schemaVersion === 10 &&
    legacy.effectCue !== undefined &&
    legacy.competitiveMatch !== undefined &&
    legacy.teamMatchmaking !== undefined &&
    (!Array.isArray(projection.players) ||
      projection.players.every((player) => player.playerId !== undefined)) &&
    (!Array.isArray(projection.lobbySeats) ||
      projection.lobbySeats.every((seat) => seat.playerId !== undefined)) &&
    (!Array.isArray(projection.spectators) ||
      projection.spectators.every((spectator) => spectator.playerId !== undefined))
  ) {
    return projection;
  }

  const players = Array.isArray(projection.players)
    ? projection.players.map((player) => ({
        ...player,
        playerId: player.playerId ?? null,
        competitiveProfile: player.competitiveProfile ?? null,
      }))
    : projection.players;
  const lobbySeats = Array.isArray(projection.lobbySeats)
    ? projection.lobbySeats.map((seat) => ({
        ...seat,
        playerId: seat.playerId ?? null,
        competitiveProfile: seat.competitiveProfile ?? null,
      }))
    : projection.lobbySeats;
  const roundSettlement = projection.roundSettlement;
  const spectators = Array.isArray(projection.spectators)
    ? projection.spectators.map((spectator) => ({
        ...spectator,
        playerId: spectator.playerId ?? null,
      }))
    : projection.spectators;

  return {
    ...projection,
    schemaVersion: 10,
    effectCue: legacy.effectCue ?? null,
    competitiveMatch: legacy.competitiveMatch ?? null,
    teamMatchmaking: legacy.teamMatchmaking ?? null,
    ...(spectators === undefined ? {} : { spectators }),
    ...(players === undefined ? {} : { players }),
    ...(lobbySeats === undefined ? {} : { lobbySeats }),
    ...(roundSettlement == null
      ? {}
      : {
          roundSettlement: {
            ...roundSettlement,
            payments: roundSettlement.payments.map((payment) => ({
              ...payment,
              payerEffectiveMultiplier:
                payment.payerEffectiveMultiplier ??
                competitiveMultiplier(payment.amount / roundSettlement.baseScore),
            })),
            competitiveSettlement: roundSettlement.competitiveSettlement ?? null,
          },
        }),
  } as RoomProjection;
}
