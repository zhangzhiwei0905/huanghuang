import type { GameEffectAction, GameEffectCue, TileKind } from "@huanghuang/protocol";

export type MahjongEffectKey = "peng" | "gang" | "bu-gang" | "fang-lai" | "hu-pai";

const EFFECT_VISUAL_DURATION_MS = {
  PONG: 450,
  EXPOSED_KONG: 700,
  CONCEALED_KONG: 700,
  INDICATOR_PONG_KONG: 700,
  ADDED_KONG: 650,
  RELEASE_WILDCARD: 800,
  WIN: 1_050,
} satisfies Record<GameEffectAction, number>;

export type EffectRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type EffectViewport = {
  width: number;
  height: number;
};

export type LottieTiming = {
  ip: number;
  op: number;
  fr: number;
};

export function mahjongEffectKey(action: GameEffectAction): MahjongEffectKey {
  if (action === "PONG") return "peng";
  if (action === "ADDED_KONG") return "bu-gang";
  if (action === "RELEASE_WILDCARD") return "fang-lai";
  if (action === "WIN") return "hu-pai";
  return "gang";
}

export function effectVisualEndsAt(
  cue: Pick<GameEffectCue, "action" | "startedAt" | "endsAt">,
): number {
  const startedAt = Date.parse(cue.startedAt);
  return Math.min(Date.parse(cue.endsAt), startedAt + EFFECT_VISUAL_DURATION_MS[cue.action]);
}

export function tileKindCode(tileKind: TileKind | null): string {
  if (tileKind === null) return "s5";
  const suit = tileKind.suit === "WAN" ? "m" : tileKind.suit === "TONG" ? "p" : "s";
  return `${suit}${tileKind.rank}`;
}

export function effectProgress(
  cue: Pick<GameEffectCue, "startedAt" | "endsAt">,
  now: number,
): number {
  const startedAt = Date.parse(cue.startedAt);
  const endsAt = Date.parse(cue.endsAt);
  const duration = Math.max(1, endsAt - startedAt);
  return Math.max(0, Math.min(1, (now - startedAt) / duration));
}

export function stretchLottieTiming<T extends LottieTiming>(
  animationData: T,
  durationMs: number,
): T {
  const frameCount = Math.max(1, animationData.op - animationData.ip);
  animationData.fr = frameCount / Math.max(0.001, durationMs / 1000);
  return animationData;
}

export function lottieResumeFrame(
  animationData: Pick<LottieTiming, "ip" | "op">,
  progress: number,
): number {
  const normalized = Math.max(0, Math.min(1, progress));
  return animationData.ip + (animationData.op - animationData.ip) * normalized;
}

export function effectPlacement(
  action: GameEffectAction,
  actorRect: EffectRect | null,
  viewport: EffectViewport,
): EffectRect {
  if (action === "WIN") {
    const size = Math.round(Math.min(420, viewport.width * 0.58, viewport.height * 0.8));
    return {
      left: (viewport.width - size) / 2,
      top: (viewport.height - size) / 2,
      width: size,
      height: size,
    };
  }

  const sizing =
    action === "PONG"
      ? { min: 136, max: 168, heightRatio: 0.38 }
      : action === "ADDED_KONG"
        ? { min: 166, max: 208, heightRatio: 0.49 }
        : action === "RELEASE_WILDCARD"
          ? { min: 170, max: 214, heightRatio: 0.5 }
          : { min: 158, max: 198, heightRatio: 0.46 };
  const size = Math.round(
    Math.min(sizing.max, Math.max(sizing.min, viewport.height * sizing.heightRatio)),
  );
  const compact = action === "PONG";
  const edgeGap = 8;
  if (actorRect === null) {
    return {
      left: Math.max(edgeGap, (viewport.width - size) / 2),
      top: Math.max(edgeGap, (viewport.height - size) / 2),
      width: size,
      height: size,
    };
  }

  // The authored action sits near the middle of its square canvas. Let the
  // compact pong stage overlap the station edge slightly so the visible badge
  // reads as belonging to the avatar instead of floating in the table center.
  const overlap = compact ? Math.min(16, Math.round(size * 0.1)) : -edgeGap;
  let left = actorRect.left + actorRect.width - overlap;
  if (left + size > viewport.width - edgeGap) left = actorRect.left - size + overlap;
  left = Math.max(edgeGap, Math.min(left, viewport.width - size - edgeGap));
  const top = Math.max(
    edgeGap,
    Math.min(actorRect.top + actorRect.height / 2 - size / 2, viewport.height - size - edgeGap),
  );
  return { left, top, width: size, height: size };
}
