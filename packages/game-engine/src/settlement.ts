import type { BaseScore, PersonalMultiplier, Seat, WinType } from "@huanghuang/protocol";

export type ScoreDelta = {
  seat: Seat;
  delta: number;
  reason: "SELF_DRAW" | "EXPOSED_KONG" | "CONCEALED_KONG" | "ADDED_KONG" | "INDICATOR_PONG_KONG";
};

export type KongSettlementKind =
  "EXPOSED_KONG" | "CONCEALED_KONG" | "ADDED_KONG" | "INDICATOR_PONG_KONG";

const SEATS: readonly Seat[] = [0, 1, 2, 3];

function assertZeroSum(deltas: readonly ScoreDelta[]): void {
  const sum = deltas.reduce((total, item) => total + item.delta, 0);
  if (sum !== 0) {
    throw new Error(`Settlement must be zero-sum, received ${sum}`);
  }
}

export const LAIYOU_MULTIPLIER = 2;

export function calculateSelfDrawSettlement(options: {
  baseScore: BaseScore;
  winnerSeat: Seat;
  winType: WinType;
  /**
   * Whether the winning tile is the one drawn right after releasing a wildcard
   * ("来由"). It multiplies the whole payment on top of the win-type and
   * personal multipliers, so the theoretical ceiling is 2 * 16 * 2 = 64.
   */
  laiyou: boolean;
  personalMultipliers: Readonly<Record<Seat, PersonalMultiplier>>;
}): ScoreDelta[] {
  const winMultiplier = options.winType === "HARD" ? 2 : 1;
  const laiyouMultiplier = options.laiyou ? LAIYOU_MULTIPLIER : 1;
  const winnerMultiplier = options.personalMultipliers[options.winnerSeat];
  const payments = SEATS.filter((seat) => seat !== options.winnerSeat).map((seat) => ({
    seat,
    amount:
      options.baseScore *
      winMultiplier *
      laiyouMultiplier *
      winnerMultiplier *
      options.personalMultipliers[seat],
  }));
  const winnerAmount = payments.reduce((total, payment) => total + payment.amount, 0);
  const deltas: ScoreDelta[] = [
    { seat: options.winnerSeat, delta: winnerAmount, reason: "SELF_DRAW" },
    ...payments.map(({ seat, amount }) => ({ seat, delta: -amount, reason: "SELF_DRAW" as const })),
  ];
  assertZeroSum(deltas);
  return deltas;
}

export function calculateKongSettlement(options: {
  baseScore: BaseScore;
  actorSeat: Seat;
  kind: KongSettlementKind;
  sourceSeat: Seat | null;
}): ScoreDelta[] {
  if (options.kind === "EXPOSED_KONG" || options.kind === "INDICATOR_PONG_KONG") {
    if (options.sourceSeat === null || options.sourceSeat === options.actorSeat) {
      throw new Error("A discard-triggered kong requires a different source seat");
    }
    const amount = options.baseScore * 3;
    const deltas: ScoreDelta[] = [
      { seat: options.actorSeat, delta: amount, reason: options.kind },
      { seat: options.sourceSeat, delta: -amount, reason: options.kind },
    ];
    assertZeroSum(deltas);
    return deltas;
  }

  const multiplier = options.kind === "CONCEALED_KONG" ? 2 : 1;
  const amountPerPayer = options.baseScore * multiplier;
  const payers = SEATS.filter((seat) => seat !== options.actorSeat);
  const deltas: ScoreDelta[] = [
    {
      seat: options.actorSeat,
      delta: amountPerPayer * payers.length,
      reason: options.kind,
    },
    ...payers.map((seat) => ({ seat, delta: -amountPerPayer, reason: options.kind })),
  ];
  assertZeroSum(deltas);
  return deltas;
}
