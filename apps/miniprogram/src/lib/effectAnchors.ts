import type { GameEffectCue, Seat } from "@huanghuang/protocol";

/* Seat anchors for effect placement.
 *
 * Why not `createSelectorQuery().boundingClientRect()`? Two reasons:
 *  1. The query is async and races the `station-in` entrance animation — a
 *     first-turn pong reads the rect mid-animation and the effect lands
 *     offset from the avatar.
 *  2. The station cards are absolutely positioned in a landscape-locked
 *     layout, so their geometry is fully derivable from the viewport.
 *
 * The formulas below mirror the `.player-station.pos-*` rules in
 * `pages/room/index.scss`. The `station-in` animation is opacity-only, so a
 * computed anchor matches the rendered card at every frame. If the scss
 * geometry changes (offsets, width clamps, 29% vertical band, self bottom
 * clearance), update these constants — both sides cite each other.
 *
 * Self-position note: cues carry the *absolute* seat, while the layout
 * positions are relative to the viewer. Callers pass the relative position
 * (0=self, 1=right, 2=opposite, 3=left), matching `relativePosition()` in
 * the room page.
 */

export type RelativePosition = 0 | 1 | 2 | 3;

export type AnchorViewport = {
  width: number;
  height: number;
};

export type AnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/* Mirrors room/index.scss `.player-station`: width max(30vmin,132px) capped
   by min(36vmin,156px); self variant max(27vmin,118px) / min(31vmin,136px).
   Landscape-locked page ⇒ vmin = height/100. */
function stationSize(
  position: RelativePosition,
  viewport: AnchorViewport,
): {
  width: number;
  height: number;
} {
  const vmin = Math.min(viewport.width, viewport.height) / 100;
  const raw = position === 0 ? Math.max(27 * vmin, 118) : Math.max(30 * vmin, 132);
  const cap = position === 0 ? Math.min(31 * vmin, 136) : Math.min(36 * vmin, 156);
  const width = Math.min(raw, cap);
  // Card height is content-driven (~avatar 6.2vmin + padding 1.6vmin);
  // effect placement only needs a sane vertical center, so approximate.
  const height = Math.min(10 * vmin, 64);
  return { width, height };
}

/**
 * Approximate the on-screen rect of a player station card. Safe-area insets
 * are unknown in this pure module; the edge positions (left/right) keep the
 * same 1vmin base offset as the scss, which is close enough for effect
 * anchoring (the placement logic clamps into the viewport anyway).
 */
export function stationAnchor(position: RelativePosition, viewport: AnchorViewport): AnchorRect {
  const { width, height } = stationSize(position, viewport);
  const vmin = Math.min(viewport.width, viewport.height) / 100;
  switch (position) {
    case 2: // opposite: top center
      return {
        left: (viewport.width - width) / 2,
        top: 1.2 * vmin,
        width,
        height,
      };
    case 3: // left: 29% from top, left edge
      return {
        left: Math.max(10 * vmin, 1 * vmin),
        top: viewport.height * 0.29,
        width,
        height,
      };
    case 1: // right: 29% from top, right edge
      return {
        left: viewport.width - 1 * vmin - width,
        top: viewport.height * 0.29,
        width,
        height,
      };
    case 0: // self: bottom right, above the hand tray
      return {
        left: viewport.width - 1.2 * vmin - width,
        top: viewport.height - Math.max(16 * vmin, 64) - height,
        width,
        height,
      };
  }
}

export function relativeSeatPosition(seat: Seat, selfSeat: Seat): RelativePosition {
  return ((seat - selfSeat + 4) % 4) as RelativePosition;
}

/* ---- Effect cue queue ---- */

export type EffectPriority = 0 | 1 | 2;

export function effectPriority(cue: Pick<GameEffectCue, "action">): EffectPriority {
  if (cue.action === "WIN") return 2;
  if (cue.action === "PONG") return 0;
  return 1;
}

export type QueuedEffect = {
  cue: GameEffectCue;
  priority: EffectPriority;
};

/**
 * Visual-only queue for effect cues. The server serializes cues (one
 * pendingEffectTransition at a time), so the queue depth stays ≤2 in
 * practice — this exists to give a follow-up cue (classically kong→win) a
 * graceful cross-fade instead of a hard destroy.
 *
 * Policy:
 * - Empty queue → play immediately.
 * - Higher priority than the current item → preempt (caller cross-fades).
 * - Otherwise → becomes the pending item. Queue depth is capped at 2: a
 *   higher-priority arrival replaces the existing pending item; an equal or
 *   lower-priority arrival still takes the pending slot (newest wins,
 *   matching "latest state is authoritative" projection semantics).
 */
export function enqueueEffect(
  queue: readonly QueuedEffect[],
  cue: GameEffectCue,
): { items: QueuedEffect[]; preempted: boolean } {
  const item: QueuedEffect = { cue, priority: effectPriority(cue) };
  if (queue.length === 0) return { items: [item], preempted: false };
  const [current, pending] = queue;
  if (item.priority > current.priority) {
    return { items: [item, ...queue.slice(1)], preempted: true };
  }
  if (pending !== undefined && item.priority > pending.priority) {
    return { items: [current, item], preempted: false };
  }
  return { items: [current, item], preempted: false };
}

export function dequeueEffect(queue: readonly QueuedEffect[]): QueuedEffect[] {
  return queue.slice(1);
}
