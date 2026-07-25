import type { DiscardTingProjection, TingWaitProjection } from "@huanghuang/protocol";

export type TingCardAlignment = "start" | "center" | "end";

export type TingCardAnchor = {
  alignment: TingCardAlignment;
  positionPercent: number;
};

export function indexTingHints(
  hints: readonly DiscardTingProjection[],
): Map<string, readonly TingWaitProjection[]> {
  return new Map(
    hints
      .filter((hint) => hint.waits.length > 0)
      .map((hint) => [hint.discardTileId, hint.waits] as const),
  );
}

export function orderTingWaits(
  waits: readonly TingWaitProjection[],
): readonly TingWaitProjection[] {
  return [...waits].sort((left, right) => {
    const leftPriority = left.winType === "HARD" ? 0 : 1;
    const rightPriority = right.winType === "HARD" ? 0 : 1;
    return leftPriority - rightPriority;
  });
}

export function tingCardAnchor(
  orderedTileIds: readonly string[],
  selectedTileId: string | null,
): TingCardAnchor | null {
  if (selectedTileId === null || orderedTileIds.length === 0) return null;
  const index = orderedTileIds.indexOf(selectedTileId);
  if (index < 0) return null;
  const positionPercent = ((index + 0.5) / orderedTileIds.length) * 100;
  return {
    alignment: positionPercent < 25 ? "start" : positionPercent > 75 ? "end" : "center",
    positionPercent,
  };
}
