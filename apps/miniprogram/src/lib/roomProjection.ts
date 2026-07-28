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
  };
  if (
    projection.schemaVersion === 9 &&
    legacy.effectCue !== undefined &&
    legacy.competitiveMatch !== undefined
  ) {
    return projection;
  }

  const players = Array.isArray(projection.players)
    ? projection.players.map((player) => ({
        ...player,
        competitiveProfile: player.competitiveProfile ?? null,
      }))
    : projection.players;
  const lobbySeats = Array.isArray(projection.lobbySeats)
    ? projection.lobbySeats.map((seat) => ({
        ...seat,
        competitiveProfile: seat.competitiveProfile ?? null,
      }))
    : projection.lobbySeats;
  const roundSettlement = projection.roundSettlement;

  return {
    ...projection,
    schemaVersion: 9,
    effectCue: legacy.effectCue ?? null,
    competitiveMatch: legacy.competitiveMatch ?? null,
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
