import Taro from "@tarojs/taro";
import { invalidateAudioFileUrls, resolveAudioFileUrls } from "./cloudAudio";
import type { GameAudioFileName } from "./gameAudioEvents";

type AudioWindow = {
  startTime: number;
  duration: number;
};

const AUDIO_WINDOWS: Record<GameAudioFileName, AudioWindow> = {
  "action-added-kong.mp3": { startTime: 0.62, duration: 0.72 },
  "action-kong.mp3": { startTime: 0.77, duration: 0.37 },
  "action-pong.mp3": { startTime: 0.83, duration: 0.33 },
  "action-release-wildcard.mp3": { startTime: 0.76, duration: 0.73 },
  "action-win.mp3": { startTime: 0.69, duration: 0.62 },
  "chaotiangang.mp3": { startTime: 0.62, duration: 0.7 },
  "gaokuaidian.mp3": { startTime: 0, duration: 2.92 },
  "ruanhu.mp3": { startTime: 0, duration: 2.53 },
  "woyijingtingle.mp3": { startTime: 0, duration: 3.44 },
  "yinghu.mp3": { startTime: 0, duration: 2.53 },
  "tile-tiao-1.mp3": { startTime: 0.79, duration: 0.54 },
  "tile-tiao-2.mp3": { startTime: 0.98, duration: 0.55 },
  "tile-tiao-3.mp3": { startTime: 0.81, duration: 0.55 },
  "tile-tiao-4.mp3": { startTime: 0.88, duration: 0.69 },
  "tile-tiao-5.mp3": { startTime: 0.93, duration: 0.54 },
  "tile-tiao-6.mp3": { startTime: 0.85, duration: 0.51 },
  "tile-tiao-7.mp3": { startTime: 0.93, duration: 0.63 },
  "tile-tiao-8.mp3": { startTime: 0.84, duration: 0.59 },
  "tile-tiao-9.mp3": { startTime: 0.79, duration: 0.6 },
  "tile-tong-1.mp3": { startTime: 0.79, duration: 0.41 },
  "tile-tong-2.mp3": { startTime: 0.77, duration: 0.48 },
  "tile-tong-3.mp3": { startTime: 0.99, duration: 0.49 },
  "tile-tong-4.mp3": { startTime: 0.77, duration: 0.55 },
  "tile-tong-5.mp3": { startTime: 0.7, duration: 0.48 },
  "tile-tong-6.mp3": { startTime: 0.73, duration: 0.52 },
  "tile-tong-7.mp3": { startTime: 0.77, duration: 0.44 },
  "tile-tong-8.mp3": { startTime: 0.73, duration: 0.48 },
  "tile-tong-9.mp3": { startTime: 0.6, duration: 0.55 },
  "tile-wan-1.mp3": { startTime: 0.95, duration: 0.4 },
  "tile-wan-2.mp3": { startTime: 0.95, duration: 0.46 },
  "tile-wan-3.mp3": { startTime: 1.05, duration: 0.44 },
  "tile-wan-4.mp3": { startTime: 0.97, duration: 0.47 },
  "tile-wan-5.mp3": { startTime: 0.93, duration: 0.5 },
  "tile-wan-6.mp3": { startTime: 0.95, duration: 0.5 },
  "tile-wan-7.mp3": { startTime: 0.67, duration: 0.48 },
  "tile-wan-8.mp3": { startTime: 1.12, duration: 0.51 },
  "tile-wan-9.mp3": { startTime: 0.93, duration: 0.52 },
};

const AUDIO_FILE_NAMES = Object.keys(AUDIO_WINDOWS) as GameAudioFileName[];
const POOL_SIZE = 2;

type AudioContext = ReturnType<typeof Taro.createInnerAudioContext>;
type PlaybackTimer = ReturnType<typeof setTimeout>;
type ActivePlayback = {
  slot: AudioSlot;
  timer: PlaybackTimer | null;
  endedHandler: () => void;
  errorHandler: () => void;
  destroyed: boolean;
};
type AudioSlot = {
  context: AudioContext;
  playback: ActivePlayback | null;
};

export type GameAudioPlayer = {
  play: (fileName: GameAudioFileName) => void;
  warmup: () => void;
  destroy: () => void;
};

export function createGameAudioPlayer(): GameAudioPlayer {
  const slots: AudioSlot[] = [];
  const leadInSafetySeconds = 0.05;
  let playerDestroyed = false;

  function createSlot(): AudioSlot | null {
    if (playerDestroyed || slots.length >= POOL_SIZE) return null;
    try {
      const context = Taro.createInnerAudioContext({ useWebAudioImplement: true });
      context.autoplay = false;
      context.loop = false;
      context.obeyMuteSwitch = true;
      const slot: AudioSlot = { context, playback: null };
      slots.push(slot);
      return slot;
    } catch {
      return null;
    }
  }

  function acquireSlot(): AudioSlot | null {
    return slots.find((slot) => slot.playback === null) ?? createSlot();
  }

  function dispose(playback: ActivePlayback, stop: boolean): void {
    if (playback.destroyed) return;
    playback.destroyed = true;
    if (playback.timer !== null) {
      clearTimeout(playback.timer);
      playback.timer = null;
    }
    const { context } = playback.slot;
    context.offEnded(playback.endedHandler);
    context.offError(playback.errorHandler);
    if (stop) context.stop();
    context.src = "";
    if (playback.slot.playback === playback) playback.slot.playback = null;
  }

  function start(fileName: GameAudioFileName, urls: Map<string, string>): void {
    if (playerDestroyed) return;
    const src = urls.get(fileName);
    if (src === undefined) return;
    const slot = acquireSlot();
    // More than two simultaneous short calls means the table is moving
    // faster than speech can remain useful. Drop the excess instead of
    // queueing history or interrupting either cue already being spoken.
    if (slot === null) return;

    const clip = AUDIO_WINDOWS[fileName];
    const playback: ActivePlayback = {
      slot,
      timer: null,
      endedHandler: () => undefined,
      errorHandler: () => undefined,
      destroyed: false,
    };
    playback.endedHandler = () => dispose(playback, false);
    playback.errorHandler = () => {
      invalidateAudioFileUrls();
      dispose(playback, false);
    };
    slot.playback = playback;

    const { context } = slot;
    context.startTime = Math.max(0, clip.startTime - leadInSafetySeconds);
    context.src = src;
    context.onEnded(playback.endedHandler);
    context.onError(playback.errorHandler);
    playback.timer = setTimeout(
      () => dispose(playback, true),
      Math.ceil((clip.duration + leadInSafetySeconds) * 1000),
    );

    try {
      context.play();
    } catch {
      dispose(playback, false);
    }
  }

  return {
    play(fileName) {
      if (playerDestroyed) return;
      void resolveAudioFileUrls(AUDIO_FILE_NAMES).then((urls) => start(fileName, urls));
    },
    warmup() {
      void resolveAudioFileUrls(AUDIO_FILE_NAMES).then(() => {
        if (playerDestroyed) return;
        while (slots.length < POOL_SIZE) {
          if (createSlot() === null) break;
        }
      });
    },
    destroy() {
      playerDestroyed = true;
      for (const slot of slots.splice(0)) {
        if (slot.playback !== null) dispose(slot.playback, true);
        slot.context.offEnded();
        slot.context.offError();
        slot.context.destroy();
      }
    },
  };
}
