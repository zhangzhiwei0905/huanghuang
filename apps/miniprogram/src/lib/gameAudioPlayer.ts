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

type AudioContext = ReturnType<typeof Taro.createInnerAudioContext>;
type PlaybackTimer = ReturnType<typeof setTimeout>;
type ActivePlayback = {
  context: AudioContext;
  timer: PlaybackTimer | null;
  destroyed: boolean;
};

export type GameAudioPlayer = {
  play: (fileName: GameAudioFileName) => void;
  destroy: () => void;
};

export function createGameAudioPlayer(): GameAudioPlayer {
  const activePlaybacks = new Set<ActivePlayback>();
  const leadInSafetySeconds = 0.05;
  let playerDestroyed = false;

  function dispose(playback: ActivePlayback, stop: boolean): void {
    if (playback.destroyed) return;
    playback.destroyed = true;
    if (playback.timer !== null) {
      clearTimeout(playback.timer);
      playback.timer = null;
    }
    activePlaybacks.delete(playback);
    if (stop) playback.context.stop();
    playback.context.destroy();
  }

  return {
    play(fileName) {
      const clip = AUDIO_WINDOWS[fileName];
      void resolveAudioFileUrls(AUDIO_FILE_NAMES).then((urls) => {
        if (playerDestroyed) return;
        const src = urls.get(fileName);
        if (src === undefined) return;

        const context = Taro.createInnerAudioContext({ useWebAudioImplement: true });
        const playback: ActivePlayback = {
          context,
          timer: null,
          destroyed: false,
        };
        activePlaybacks.add(playback);

        context.autoplay = false;
        context.loop = false;
        context.obeyMuteSwitch = true;
        context.startTime = Math.max(0, clip.startTime - leadInSafetySeconds);
        context.src = src;
        context.onEnded(() => dispose(playback, false));
        context.onError(() => {
          // Most likely a stale cloud temp URL (10-minute expiry on a
          // private bucket) — drop the cache so the next play() call
          // re-resolves instead of retrying the same dead URL forever.
          invalidateAudioFileUrls();
          dispose(playback, false);
        });
        playback.timer = setTimeout(
          () => dispose(playback, true),
          Math.ceil((clip.duration + leadInSafetySeconds) * 1000),
        );

        try {
          context.play();
        } catch {
          dispose(playback, false);
        }
      });
    },
    destroy() {
      playerDestroyed = true;
      for (const playback of [...activePlaybacks]) {
        dispose(playback, true);
      }
    },
  };
}
