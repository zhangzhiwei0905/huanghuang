import type { TileKind } from "@huanghuang/protocol";
import {
  tileKindCode,
  type LottieTiming,
  type MahjongEffectKey,
} from "../../lib/mahjongEffect";

type MahjongAnimationLayer = Record<string, unknown> & {
  nm?: string;
  meta?: Record<string, unknown> & {
    tileSlot?: string;
    tileCode?: string;
  };
};

export type MahjongAnimationData = LottieTiming &
  Record<string, unknown> & {
    layers?: MahjongAnimationLayer[];
    meta?: Record<string, unknown>;
  };

type TileFacesRuntime = {
  applyTileCode(
    animationData: MahjongAnimationData,
    tileBySlot: { claim: string; wild: string },
  ): MahjongAnimationData;
};

const tileFaces = require("./tile-faces.cjs") as TileFacesRuntime;

const animationLoaders: Record<MahjongEffectKey, () => MahjongAnimationData> = {
  peng: () => require("./data/peng.cjs") as MahjongAnimationData,
  gang: () => require("./data/gang.cjs") as MahjongAnimationData,
  "bu-gang": () => require("./data/bu-gang.cjs") as MahjongAnimationData,
  "fang-lai": () => require("./data/fang-lai.cjs") as MahjongAnimationData,
  "hu-pai": () => require("./data/hu-pai.cjs") as MahjongAnimationData,
};

const COMPACT_PONG_LAYER_NAMES = new Set([
  "碰 · 动作章",
  "彩屑 1",
  "彩屑 3",
  "彩屑 5",
  "彩屑 7",
  "彩屑 9",
  "冲击波 11",
  "冲击波 12",
]);

function cloneAnimationData(animationData: MahjongAnimationData): MahjongAnimationData {
  return JSON.parse(JSON.stringify(animationData)) as MahjongAnimationData;
}

function compactPongAnimation(animationData: MahjongAnimationData): MahjongAnimationData {
  return {
    ...animationData,
    ip: 18,
    layers: (animationData.layers ?? [])
      .filter((layer) => COMPACT_PONG_LAYER_NAMES.has(layer.nm ?? ""))
      .map((layer) => JSON.parse(JSON.stringify(layer)) as MahjongAnimationLayer),
    meta: {
      ...animationData.meta,
      presentation: "compact-text-only",
    },
  };
}

export function loadMahjongAnimationData(
  key: MahjongEffectKey,
  tileKind: TileKind | null,
): MahjongAnimationData {
  const source = animationLoaders[key]();
  let animationData: MahjongAnimationData;

  if (key === "peng") {
    // The compact pong feedback intentionally contains no tile face. Besides
    // matching the table's restrained visual language, dropping the three tile
    // layers and most particles materially reduces per-frame Canvas work.
    animationData = compactPongAnimation(source);
  } else if (key === "hu-pai") {
    // Win has no runtime tile slots, so avoid walking the large celebration
    // data through the tile substitution runtime before playback.
    animationData = cloneAnimationData(source);
  } else {
    const tileCode = tileKindCode(tileKind);
    animationData = tileFaces.applyTileCode(source, {
      claim: tileCode,
      wild: tileCode,
    });
  }

  // Animations play at their authored frame rate (60fps). The server cue
  // window is longer than the animation; the final frame simply holds until
  // the cue expires. `stretchLottieTiming` survives only for mid-cue resume
  // math in lib/mahjongEffect (lottieResumeFrame works in frame space and is
  // framerate-independent).
  return animationData;
}
