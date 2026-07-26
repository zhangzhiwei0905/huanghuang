import Taro from "@tarojs/taro";
import actionAddedKong from "../assets/audio/action-added-kong.mp3";
import actionKong from "../assets/audio/action-kong.mp3";
import actionPong from "../assets/audio/action-pong.mp3";
import actionReleaseWildcard from "../assets/audio/action-release-wildcard.mp3";
import actionWin from "../assets/audio/action-win.mp3";
import chaotiangang from "../assets/audio/chaotiangang.mp3";
import gaokuaidian from "../assets/audio/gaokuaidian.mp3";
import ruanhu from "../assets/audio/ruanhu.mp3";
import tileTiao1 from "../assets/audio/tile-tiao-1.mp3";
import tileTiao2 from "../assets/audio/tile-tiao-2.mp3";
import tileTiao3 from "../assets/audio/tile-tiao-3.mp3";
import tileTiao4 from "../assets/audio/tile-tiao-4.mp3";
import tileTiao5 from "../assets/audio/tile-tiao-5.mp3";
import tileTiao6 from "../assets/audio/tile-tiao-6.mp3";
import tileTiao7 from "../assets/audio/tile-tiao-7.mp3";
import tileTiao8 from "../assets/audio/tile-tiao-8.mp3";
import tileTiao9 from "../assets/audio/tile-tiao-9.mp3";
import tileTong1 from "../assets/audio/tile-tong-1.mp3";
import tileTong2 from "../assets/audio/tile-tong-2.mp3";
import tileTong3 from "../assets/audio/tile-tong-3.mp3";
import tileTong4 from "../assets/audio/tile-tong-4.mp3";
import tileTong5 from "../assets/audio/tile-tong-5.mp3";
import tileTong6 from "../assets/audio/tile-tong-6.mp3";
import tileTong7 from "../assets/audio/tile-tong-7.mp3";
import tileTong8 from "../assets/audio/tile-tong-8.mp3";
import tileTong9 from "../assets/audio/tile-tong-9.mp3";
import tileWan1 from "../assets/audio/tile-wan-1.mp3";
import tileWan2 from "../assets/audio/tile-wan-2.mp3";
import tileWan3 from "../assets/audio/tile-wan-3.mp3";
import tileWan4 from "../assets/audio/tile-wan-4.mp3";
import tileWan5 from "../assets/audio/tile-wan-5.mp3";
import tileWan6 from "../assets/audio/tile-wan-6.mp3";
import tileWan7 from "../assets/audio/tile-wan-7.mp3";
import tileWan8 from "../assets/audio/tile-wan-8.mp3";
import tileWan9 from "../assets/audio/tile-wan-9.mp3";
import woyijingtingle from "../assets/audio/woyijingtingle.mp3";
import yinghu from "../assets/audio/yinghu.mp3";
import type { GameAudioFileName } from "./gameAudioEvents";

const AUDIO_SOURCES: Record<GameAudioFileName, string> = {
  "action-added-kong.mp3": actionAddedKong,
  "action-kong.mp3": actionKong,
  "action-pong.mp3": actionPong,
  "action-release-wildcard.mp3": actionReleaseWildcard,
  "action-win.mp3": actionWin,
  "chaotiangang.mp3": chaotiangang,
  "gaokuaidian.mp3": gaokuaidian,
  "ruanhu.mp3": ruanhu,
  "woyijingtingle.mp3": woyijingtingle,
  "yinghu.mp3": yinghu,
  "tile-tiao-1.mp3": tileTiao1,
  "tile-tiao-2.mp3": tileTiao2,
  "tile-tiao-3.mp3": tileTiao3,
  "tile-tiao-4.mp3": tileTiao4,
  "tile-tiao-5.mp3": tileTiao5,
  "tile-tiao-6.mp3": tileTiao6,
  "tile-tiao-7.mp3": tileTiao7,
  "tile-tiao-8.mp3": tileTiao8,
  "tile-tiao-9.mp3": tileTiao9,
  "tile-tong-1.mp3": tileTong1,
  "tile-tong-2.mp3": tileTong2,
  "tile-tong-3.mp3": tileTong3,
  "tile-tong-4.mp3": tileTong4,
  "tile-tong-5.mp3": tileTong5,
  "tile-tong-6.mp3": tileTong6,
  "tile-tong-7.mp3": tileTong7,
  "tile-tong-8.mp3": tileTong8,
  "tile-tong-9.mp3": tileTong9,
  "tile-wan-1.mp3": tileWan1,
  "tile-wan-2.mp3": tileWan2,
  "tile-wan-3.mp3": tileWan3,
  "tile-wan-4.mp3": tileWan4,
  "tile-wan-5.mp3": tileWan5,
  "tile-wan-6.mp3": tileWan6,
  "tile-wan-7.mp3": tileWan7,
  "tile-wan-8.mp3": tileWan8,
  "tile-wan-9.mp3": tileWan9,
};

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
      context.src = AUDIO_SOURCES[fileName];
      context.onEnded(() => dispose(playback, false));
      context.onError(() => dispose(playback, false));
      playback.timer = setTimeout(
        () => dispose(playback, true),
        Math.ceil((clip.duration + leadInSafetySeconds) * 1000),
      );

      try {
        context.play();
      } catch {
        dispose(playback, false);
      }
    },
    destroy() {
      for (const playback of [...activePlaybacks]) {
        dispose(playback, true);
      }
    },
  };
}
