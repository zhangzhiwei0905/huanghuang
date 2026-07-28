import type { TileKind } from "@huanghuang/protocol";
import {
  stretchLottieTiming,
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

type PresentationProfile = {
  outPoint: number;
  name: string;
};

const tileFaces = require("./tile-faces.cjs") as TileFacesRuntime;

const animationLoaders: Record<MahjongEffectKey, () => MahjongAnimationData> = {
  peng: () => require("./data/peng.cjs") as MahjongAnimationData,
  gang: () => require("./data/gang.cjs") as MahjongAnimationData,
  "bu-gang": () => require("./data/bu-gang.cjs") as MahjongAnimationData,
  "fang-lai": () => require("./data/fang-lai.cjs") as MahjongAnimationData,
  "hu-pai": () => require("./data/hu-pai.cjs") as MahjongAnimationData,
};

// Each outPoint lands right after its badge/主体 has settled into a legible
// final state, before the source asset's authored hold-and-fade tail. The
// overlay's own 90ms CSS opacity transition supplies the disappearance, so
// there is no need to play out an authored fade here. See
// .trellis/tasks/07-27-mahjong-effect-redesign/design.md for the per-frame
// rationale behind each cut.
const presentationProfiles: Record<MahjongEffectKey, PresentationProfile> = {
  peng: { outPoint: 27, name: "collision-badge" },
  gang: { outPoint: 42, name: "four-tile-slam" },
  "bu-gang": { outPoint: 39, name: "slot-lock-in" },
  "fang-lai": { outPoint: 48, name: "double-strike-lightning" },
  "hu-pai": { outPoint: 63, name: "seal-drop-celebration" },
};

function cloneAnimationData(animationData: MahjongAnimationData): MahjongAnimationData {
  return JSON.parse(JSON.stringify(animationData)) as MahjongAnimationData;
}

function applyPresentation(
  key: MahjongEffectKey,
  animationData: MahjongAnimationData,
): MahjongAnimationData {
  const profile = presentationProfiles[key];
  return {
    ...animationData,
    op: Math.min(profile.outPoint, animationData.op),
    meta: {
      ...animationData.meta,
      presentation: profile.name,
    },
  };
}

export function loadMahjongAnimationData(
  key: MahjongEffectKey,
  tileKind: TileKind | null,
  durationMs: number,
): MahjongAnimationData {
  const source = animationLoaders[key]();
  let animationData: MahjongAnimationData;

  if (key === "peng" || key === "hu-pai") {
    // Pong intentionally uses no tile faces, while win has no runtime tile
    // slots. Avoid walking either animation through the substitution runtime.
    animationData = cloneAnimationData(source);
  } else {
    const tileCode = tileKindCode(tileKind);
    animationData = tileFaces.applyTileCode(source, {
      claim: tileCode,
      wild: tileCode,
    });
  }

  return stretchLottieTiming(applyPresentation(key, animationData), durationMs);
}
