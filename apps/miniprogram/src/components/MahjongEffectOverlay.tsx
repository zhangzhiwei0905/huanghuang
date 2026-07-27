import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { GameEffectCue, Seat } from "@huanghuang/protocol";
import lottie from "lottie-miniprogram";
import { loadMahjongAnimationData } from "../effects/mahjong/runtime";
import {
  dequeueEffect,
  enqueueEffect,
  relativeSeatPosition,
  stationAnchor,
  type QueuedEffect,
} from "../lib/effectAnchors";
import {
  effectPlacement,
  effectProgress,
  lottieResumeFrame,
  mahjongEffectKey,
  type EffectRect,
} from "../lib/mahjongEffect";
import "./MahjongEffectOverlay.scss";

const CANVAS_ID = "mahjong-effect-canvas";
/* Backing-store ceiling: beyond this the per-frame Canvas cost climbs without
   a visible sharpness gain on phone screens. */
const MAX_CANVAS_SIZE = 1024;

type CanvasNode = {
  width: number;
  height: number;
  getContext(type: "2d"): never;
};

type Animation = ReturnType<typeof lottie.loadAnimation>;

function viewportSize() {
  try {
    const system = Taro.getSystemInfoSync();
    return {
      width: system.windowWidth,
      height: system.windowHeight,
      pixelRatio: system.pixelRatio ?? 1,
    };
  } catch {
    return { width: 375, height: 667, pixelRatio: 1 };
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
  const [fading, setFading] = useState(false);
  const animationRef = useRef<Animation | null>(null);
  const queueRef = useRef<QueuedEffect[]>([]);
  /* Which cue is currently loaded on the canvas (may differ from the queue
     head for one render after a dequeue — the effect re-syncs immediately). */
  const activeCueRef = useRef<GameEffectCue | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Taro.nextTick(() => {
      Taro.createSelectorQuery()
        .select(`#${CANVAS_ID}`)
        .node((result) => {
          if (cancelled) return;
          try {
            const node = result.node as unknown as CanvasNode;
            const { pixelRatio } = viewportSize();
            const size = Math.min(
              MAX_CANVAS_SIZE,
              Math.round(512 * Math.max(1, Math.min(2, pixelRatio))),
            );
            node.width = size;
            node.height = size;
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

  /* Advance the queue when the server-side cue window ends. The projection
     drops the cue at the same instant; the timer is the local mirror that
     also covers "cue prop went null" (server advanced) by simply re-running
     the main effect below. */
  useEffect(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    const active = activeCueRef.current;
    if (active === null) return;
    const remaining = Date.parse(active.endsAt) - Date.now() + 50;
    if (remaining <= 0) return;
    clearTimerRef.current = setTimeout(() => {
      queueRef.current = dequeueEffect(queueRef.current);
      if (queueRef.current.length === 0) {
        activeCueRef.current = null;
        animationRef.current?.destroy();
        animationRef.current = null;
        setVisible(false);
      } else {
        // Force the main effect to pick up the new head even if the cue prop
        // hasn't changed yet (server sends the next cue slightly later).
        setVisible((v) => v);
        setFading(false);
        activeCueRef.current = null;
        animationRef.current?.destroy();
        animationRef.current = null;
        setPlacement((p) => ({ ...p }));
      }
    }, remaining);
    return () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [visible]);

  useEffect(() => {
    if (canvas === null) return;

    if (cue !== null && activeCueRef.current?.id !== cue.id) {
      const result = enqueueEffect(queueRef.current, cue);
      queueRef.current = result.items;
      if (result.preempted && animationRef.current !== null) {
        // Higher-priority cue (classic: kong straight into win) — fade the
        // outgoing animation instead of hard-cutting it, then start the new
        // one on the same canvas.
        setFading(true);
        animationRef.current.destroy();
        animationRef.current = null;
        activeCueRef.current = null;
      }
    }

    const current = queueRef.current[0];
    if (current === undefined) {
      if (activeCueRef.current !== null) {
        activeCueRef.current = null;
        animationRef.current?.destroy();
        animationRef.current = null;
        setVisible(false);
      }
      return;
    }
    if (activeCueRef.current?.id === current.cue.id) return;

    const now = Date.now();
    if (now >= Date.parse(current.cue.endsAt)) {
      // Window already passed (late delivery) — skip straight to the next.
      queueRef.current = dequeueEffect(queueRef.current);
      if (queueRef.current.length === 0) {
        activeCueRef.current = null;
        animationRef.current?.destroy();
        animationRef.current = null;
        setVisible(false);
      }
      return;
    }

    try {
      const viewport = viewportSize();
      const actorRect =
        current.cue.action === "WIN"
          ? null
          : stationAnchor(relativeSeatPosition(current.cue.actorSeat, selfSeat), viewport);
      setPlacement(effectPlacement(current.cue.action, actorRect, viewport));
      const animationData = loadMahjongAnimationData(
        mahjongEffectKey(current.cue.action),
        current.cue.tileKind,
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
      activeCueRef.current = current.cue;
      setFading(false);
      setVisible(true);
      animation.goToAndPlay(
        lottieResumeFrame(animationData, effectProgress(current.cue, now)),
        true,
      );
      // Hold the final frame once the (shorter) animation finishes inside the
      // (longer) server cue window — the cue itself clears the stage.
      animation.addEventListener("complete", () => {
        if (animationRef.current === animation) {
          animation.goToAndStop(animationData.op - 1, true);
        }
      });
    } catch (cause) {
      setVisible(false);
      activeCueRef.current = null;
      queueRef.current = dequeueEffect(queueRef.current);
      animationRef.current?.destroy();
      animationRef.current = null;
      console.error("Failed to play Mahjong effect", cause);
    }
  }, [canvas, cue, selfSeat, visible]);

  const style = {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    width: `${placement.width}px`,
    height: `${placement.height}px`,
  } as CSSProperties;

  const displayCue = activeCueRef.current ?? cue;
  const isWin = displayCue?.action === "WIN";
  return (
    <View
      className={`mahjong-effect-overlay${visible ? " is-visible" : ""}${
        fading ? " is-fading" : ""
      }${isWin ? " is-win" : ""}${displayCue?.laiyou === true ? " is-laiyou" : ""}`}
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
      {isWin && visible ? (
        <View
          className={`mahjong-effect-overlay__badge${
            displayCue?.winType === "HARD" ? " is-hard" : " is-soft"
          }${displayCue?.laiyou === true ? " is-laiyou" : ""}`}
        >
          {displayCue?.laiyou === true
            ? "来由！"
            : displayCue?.winType === "HARD"
              ? "硬胡"
              : "软胡"}
        </View>
      ) : null}
    </View>
  );
}
