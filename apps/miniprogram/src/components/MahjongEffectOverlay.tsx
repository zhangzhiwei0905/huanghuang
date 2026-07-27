import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { GameEffectCue } from "@huanghuang/protocol";
import lottie from "lottie-miniprogram";
import { loadMahjongAnimationData } from "../effects/mahjong/runtime";
import {
  effectPlacement,
  effectProgress,
  lottieResumeFrame,
  mahjongEffectKey,
  type EffectRect,
} from "../lib/mahjongEffect";
import "./MahjongEffectOverlay.scss";

const CANVAS_ID = "mahjong-effect-canvas";
const CANVAS_SIZE = 512;

type CanvasNode = {
  width: number;
  height: number;
  getContext(type: "2d"): never;
};

type Animation = ReturnType<typeof lottie.loadAnimation>;

function viewportSize() {
  try {
    const system = Taro.getSystemInfoSync();
    return { width: system.windowWidth, height: system.windowHeight };
  } catch {
    return { width: 375, height: 667 };
  }
}

function rectFromResult(result: unknown): EffectRect | null {
  if (result === null || typeof result !== "object") return null;
  const rect = result as Partial<EffectRect>;
  if (
    typeof rect.left !== "number" ||
    typeof rect.top !== "number" ||
    typeof rect.width !== "number" ||
    typeof rect.height !== "number"
  ) {
    return null;
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function MahjongEffectOverlay({ cue }: { cue: GameEffectCue | null }) {
  const [canvas, setCanvas] = useState<CanvasNode | null>(null);
  const [placement, setPlacement] = useState<EffectRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [visible, setVisible] = useState(false);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    let cancelled = false;
    Taro.nextTick(() => {
      Taro.createSelectorQuery()
        .select(`#${CANVAS_ID}`)
        .node((result) => {
          if (cancelled) return;
          try {
            const node = result.node as unknown as CanvasNode;
            node.width = CANVAS_SIZE;
            node.height = CANVAS_SIZE;
            lottie.setup(node);
            setCanvas(node);
          } catch (cause) {
            console.error("Failed to initialize Mahjong effect canvas", cause);
          }
        })
        .exec();
    });
    return () => {
      cancelled = true;
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, []);

  useEffect(() => {
    animationRef.current?.destroy();
    animationRef.current = null;
    setVisible(false);
    if (cue === null || canvas === null) return;

    let cancelled = false;
    const play = (actorRect: EffectRect | null) => {
      if (cancelled) return;
      const now = Date.now();
      const endsAt = Date.parse(cue.endsAt);
      if (now >= endsAt) return;

      try {
        const viewport = viewportSize();
        setPlacement(effectPlacement(cue.action, actorRect, viewport));
        const durationMs = Math.max(1, endsAt - Date.parse(cue.startedAt));
        const animationData = loadMahjongAnimationData(
          mahjongEffectKey(cue.action),
          cue.tileKind,
          durationMs,
        );
        const animation = lottie.loadAnimation({
          renderer: "canvas",
          loop: false,
          autoplay: false,
          animationData,
          rendererSettings: {
            context: canvas.getContext("2d"),
            clearCanvas: true,
          },
        });
        animationRef.current = animation;
        setVisible(true);
        animation.goToAndPlay(lottieResumeFrame(animationData, effectProgress(cue, now)), true);
      } catch (cause) {
        setVisible(false);
        animationRef.current?.destroy();
        animationRef.current = null;
        console.error("Failed to play Mahjong effect", cause);
      }
    };

    if (cue.action === "WIN") {
      play(null);
    } else {
      Taro.createSelectorQuery()
        .select(`#player-station-${cue.actorSeat}`)
        .boundingClientRect((result) => play(rectFromResult(result)))
        .exec();
    }

    return () => {
      cancelled = true;
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [canvas, cue?.id]);

  const style = {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    width: `${placement.width}px`,
    height: `${placement.height}px`,
  } as CSSProperties;

  return (
    <View
      className={`mahjong-effect-overlay${visible ? " is-visible" : ""}${
        cue?.action === "WIN" ? " is-win" : ""
      }`}
      aria-hidden
    >
      <View className="mahjong-effect-overlay__stage" style={style}>
        <Canvas
          id={CANVAS_ID}
          canvasId={CANVAS_ID}
          type="2d"
          className="mahjong-effect-overlay__canvas"
        />
      </View>
    </View>
  );
}
