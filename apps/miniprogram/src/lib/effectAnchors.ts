import type { Seat } from "@huanghuang/protocol";
import type { EffectRect, EffectViewport } from "./mahjongEffect";

export type RelativeSeatPosition = 0 | 1 | 2 | 3;

export function relativeSeatPosition(seat: Seat, selfSeat: Seat): RelativeSeatPosition {
  return ((seat - selfSeat + 4) % 4) as RelativeSeatPosition;
}

/**
 * Synchronous approximation of `.player-station.pos-*` in room/index.scss.
 * The cards are absolutely positioned and their entrance animation changes
 * only opacity, so querying `boundingClientRect()` before every effect adds
 * latency without improving the anchor.
 */
export function stationEffectAnchor(
  position: RelativeSeatPosition,
  viewport: EffectViewport,
): EffectRect {
  const vmin = Math.min(viewport.width, viewport.height) / 100;
  const rawWidth = position === 0 ? Math.max(27 * vmin, 118) : Math.max(30 * vmin, 132);
  const widthCap = position === 0 ? Math.min(31 * vmin, 136) : Math.min(36 * vmin, 156);
  const width = Math.min(rawWidth, widthCap);
  const height = Math.min(10 * vmin, 64);

  if (position === 2) {
    return {
      left: (viewport.width - width) / 2,
      top: 1.2 * vmin,
      width,
      height,
    };
  }
  if (position === 3) {
    return {
      left: Math.max(10 * vmin, vmin),
      top: viewport.height * 0.29,
      width,
      height,
    };
  }
  if (position === 1) {
    return {
      left: viewport.width - vmin - width,
      top: viewport.height * 0.29,
      width,
      height,
    };
  }
  return {
    left: viewport.width - 1.2 * vmin - width,
    top: viewport.height - Math.max(16 * vmin, 64) - height,
    width,
    height,
  };
}
