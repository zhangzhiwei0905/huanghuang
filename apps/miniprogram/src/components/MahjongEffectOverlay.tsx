import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { GameEffectCue, Seat } from "@huanghuang/protocol";
import lottie from "lottie-miniprogram";
import { loadMahjongAnimationData } from "../effects/mahjong/runtime";
import { relativeSeatPosition, stationEffectAnchor } from "../lib/effectAnchors";
import {
  effectPlacement,
  effectProgress,
  effectVisualEndsAt,
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

export function MahjongEffectOverlay({
  cue,
  selfSeat,
}: {
  cue: GameEffectCue | null;
  selfSeat: Seat;
}) {
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
    let animation: Animation | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const hideAndDestroy = () => {
      if (animation === null) return;
      const completedAnimation = animation;
      animation = null;
      completedAnimation.removeEventListener("complete", hideAndDestroy);
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (animationRef.current === completedAnimation) {
        if (!cancelled) setVisible(false);
        animationRef.current = null;
      }
      completedAnimation.destroy();
    };

    const play = (actorRect: EffectRect | null) => {
      if (cancelled) return;
      const now = Date.now();
      const startedAt = Date.parse(cue.startedAt);
      const visualEndsAt = effectVisualEndsAt(cue);
      if (now >= visualEndsAt) return;

      try {
        const viewport = viewportSize();
        setPlacement(effectPlacement(cue.action, actorRect, viewport));
        const durationMs = Math.max(1, visualEndsAt - startedAt);
        const animationData = loadMahjongAnimationData(
          mahjongEffectKey(cue.action),
          cue.tileKind,
          durationMs,
        );
        animation = lottie.loadAnimation({
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
        animation.addEventListener("complete", hideAndDestroy);
        setVisible(true);
        const resumeFrame = lottieResumeFrame(
          animationData,
          effectProgress(
            { startedAt: cue.startedAt, endsAt: new Date(visualEndsAt).toISOString() },
            now,
          ),
        );
        animation.goToAndPlay(resumeFrame, true);
        hideTimer = setTimeout(hideAndDestroy, Math.max(1, visualEndsAt - now));
      } catch (cause) {
        hideAndDestroy();
        setVisible(false);
        animationRef.current = null;
        console.error("Failed to play Mahjong effect", cause);
      }
    };

    const viewport = viewportSize();
    const actorRect =
      cue.action === "WIN"
        ? null
        : stationEffectAnchor(relativeSeatPosition(cue.actorSeat, selfSeat), viewport);
    play(actorRect);

    return () => {
      cancelled = true;
      hideAndDestroy();
      if (hideTimer !== null) clearTimeout(hideTimer);
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [canvas, cue?.id, selfSeat]);

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
