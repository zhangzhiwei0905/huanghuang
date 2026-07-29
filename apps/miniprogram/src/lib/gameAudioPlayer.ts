import Taro from "@tarojs/taro";
import { invalidateAudioFileUrls, resolveAudioFileUrls } from "./cloudAudio";
import type { GameAudioFileName } from "./gameAudioEvents";

// Every clip in huanghuang-audio/mp3-trimmed/ (see scripts/trim-audio.mjs) is
// already cut down to just its "action" window and starts sounding at 0, so
// playback here just plays each clip to its natural end (onEnded) instead of
// re-deriving a startTime/duration window and racing a stop-timer against
// network + decode latency.
//
// `action-win.mp3`, `laiyou.mp3`, and `pre-audio.mp3` are intentionally
// absent from this list: no code path in gameAudioEvents.ts ever produces
// them, so they are dead assets that are neither trimmed, cached, nor
// resolved.
const AUDIO_FILE_NAMES: GameAudioFileName[] = [
  "tile-wan-1.mp3",
  "tile-wan-2.mp3",
  "tile-wan-3.mp3",
  "tile-wan-4.mp3",
  "tile-wan-5.mp3",
  "tile-wan-6.mp3",
  "tile-wan-7.mp3",
  "tile-wan-8.mp3",
  "tile-wan-9.mp3",
  "tile-tiao-1.mp3",
  "tile-tiao-2.mp3",
  "tile-tiao-3.mp3",
  "tile-tiao-4.mp3",
  "tile-tiao-5.mp3",
  "tile-tiao-6.mp3",
  "tile-tiao-7.mp3",
  "tile-tiao-8.mp3",
  "tile-tiao-9.mp3",
  "tile-tong-1.mp3",
  "tile-tong-2.mp3",
  "tile-tong-3.mp3",
  "tile-tong-4.mp3",
  "tile-tong-5.mp3",
  "tile-tong-6.mp3",
  "tile-tong-7.mp3",
  "tile-tong-8.mp3",
  "tile-tong-9.mp3",
  "action-pong.mp3",
  "action-kong.mp3",
  "action-release-wildcard.mp3",
  "action-added-kong.mp3",
  "chaotiangang.mp3",
  "yinghu.mp3",
  "ruanhu.mp3",
  "gaokuaidian.mp3",
  "woyijingtingle.mp3",
];

// Bump this directory whenever the cache-writing contract changes. Older
// versions downloaded directly into the playable path, so an interrupted
// download could leave a truncated file that accessSync() later accepted as
// a valid cache hit.
const AUDIO_CACHE_SUBDIR = "audio-v2";
// Idle contexts are recycled up to this many at a time; anything beyond it
// is destroyed instead of pooled. This bounds memory, not concurrency — a
// play() call always gets a context (new one created if the pool is empty),
// it just may not be handed back into the idle pool once it ends.
const MAX_IDLE_POOL_SIZE = 4;
// Contexts pre-created by warmup() so the first couple of overlapping cues
// don't pay context-creation cost.
const WARM_POOL_SIZE = 2;

type AudioContext = ReturnType<typeof Taro.createInnerAudioContext>;
type ActivePlayback = {
  context: AudioContext;
  endedHandler: () => void;
  errorHandler: () => void;
  destroyed: boolean;
};

export type GameAudioPlayer = {
  play: (fileName: GameAudioFileName) => void;
  /** Pre-resolve cloud URLs, pre-download local file cache copies, and
      pre-create warm contexts. Silent no-op on failure — play() keeps its
      lazy fallback path. */
  warmup: () => void;
  destroy: () => void;
};

function configureContext(context: AudioContext): void {
  context.autoplay = false;
  context.loop = false;
  context.obeyMuteSwitch = true;
  context.startTime = 0;
}

function audioCacheDir(): string | null {
  const base = Taro.env?.USER_DATA_PATH;
  if (base === undefined || base.length === 0) return null;
  return `${base}/${AUDIO_CACHE_SUBDIR}`;
}

function localAudioPath(fileName: GameAudioFileName): string | null {
  const dir = audioCacheDir();
  return dir === null ? null : `${dir}/${fileName}`;
}

export function createGameAudioPlayer(): GameAudioPlayer {
  const activePlaybacks = new Set<ActivePlayback>();
  const idlePool: AudioContext[] = [];
  // fileName -> confirmed-present local file path. Populated by warmup();
  // play() uses this synchronously and only falls back to the (async) cloud
  // temp URL when a name isn't in here yet.
  const localReady = new Map<GameAudioFileName, string>();
  let playerDestroyed = false;
  let warmupStarted = false;

  function releaseContext(context: AudioContext): void {
    if (playerDestroyed || idlePool.length >= MAX_IDLE_POOL_SIZE) {
      context.destroy();
      return;
    }
    // The clip already reached its natural end (or was never started) by
    // the time a context is released here — stop() is only ever called on
    // the forced-teardown path in dispose(), never here, so a still-playing
    // cue is never cut short.
    context.src = "";
    idlePool.push(context);
  }

  function acquireContext(): AudioContext {
    // FIFO: reuse the longest-idle context first.
    const pooled = idlePool.shift();
    if (pooled !== undefined) return pooled;
    // Pool empty: never drop the play() call, just create another context.
    const context = Taro.createInnerAudioContext({ useWebAudioImplement: true });
    configureContext(context);
    return context;
  }

  function dispose(playback: ActivePlayback, stop: boolean): void {
    if (playback.destroyed) return;
    playback.destroyed = true;
    activePlaybacks.delete(playback);
    const { context } = playback;
    context.offEnded(playback.endedHandler);
    context.offError(playback.errorHandler);
    if (stop) {
      context.stop();
      context.destroy();
    } else {
      releaseContext(context);
    }
  }

  function start(fileName: GameAudioFileName, src: string): void {
    if (playerDestroyed) return;
    const context = acquireContext();
    const playback: ActivePlayback = {
      context,
      endedHandler: () => undefined,
      errorHandler: () => undefined,
      destroyed: false,
    };
    playback.endedHandler = () => dispose(playback, false);
    playback.errorHandler = () => {
      // Most likely a stale local file or an expired cloud temp URL
      // (10-minute expiry on a private bucket) — drop both caches so the
      // next play() re-downloads / re-resolves instead of retrying the
      // same dead source forever.
      localReady.delete(fileName);
      invalidateAudioFileUrls();
      dispose(playback, false);
    };
    activePlaybacks.add(playback);

    context.onEnded(playback.endedHandler);
    context.onError(playback.errorHandler);
    context.src = src;

    try {
      context.play();
    } catch {
      dispose(playback, false);
    }
  }

  async function ensureLocalCache(fileName: GameAudioFileName, cloudUrl: string): Promise<void> {
    if (playerDestroyed || localReady.has(fileName)) return;
    const localPath = localAudioPath(fileName);
    if (localPath === null) return;
    const fsm = Taro.getFileSystemManager();
    try {
      fsm.accessSync(localPath);
      localReady.set(fileName, localPath);
      return;
    } catch {
      // Not cached locally yet — fall through and download it.
    }
    try {
      // Download to WeChat's temporary area first. Writing the network stream
      // directly to localPath makes a partial file indistinguishable from a
      // complete cache entry after interruption or process suspension.
      const result = await Taro.downloadFile({ url: cloudUrl });
      if (
        playerDestroyed ||
        result.statusCode < 200 ||
        result.statusCode >= 300 ||
        result.tempFilePath.length === 0
      ) {
        return;
      }
      const savedPath = fsm.saveFileSync(result.tempFilePath, localPath);
      if (!playerDestroyed) localReady.set(fileName, savedPath || localPath);
    } catch {
      // Network or final-save failure — play() keeps working via the cloud
      // temp URL fallback, just without the local-cache speedup this time.
    }
  }

  function ensureCacheDir(): void {
    const dir = audioCacheDir();
    if (dir === null) return;
    try {
      Taro.getFileSystemManager().mkdirSync(dir, true);
    } catch {
      // Already exists, or platform doesn't support it (e.g. the vitest
      // mock) — either way there's nothing to recover, downloadFile below
      // will simply fail and fall back to the cloud URL path.
    }
  }

  return {
    play(fileName) {
      if (playerDestroyed) return;
      const localPath = localReady.get(fileName);
      if (localPath !== undefined) {
        start(fileName, localPath);
        return;
      }
      void resolveAudioFileUrls(AUDIO_FILE_NAMES).then((urls) => {
        if (playerDestroyed) return;
        const src = urls.get(fileName);
        if (src === undefined) return;
        start(fileName, src);
      });
    },
    warmup() {
      if (playerDestroyed || warmupStarted) return;
      warmupStarted = true;
      void resolveAudioFileUrls(AUDIO_FILE_NAMES).then((urls) => {
        if (playerDestroyed) return;
        ensureCacheDir();
        for (const fileName of AUDIO_FILE_NAMES) {
          const cloudUrl = urls.get(fileName);
          if (cloudUrl !== undefined) void ensureLocalCache(fileName, cloudUrl);
        }
        while (idlePool.length < WARM_POOL_SIZE) {
          try {
            const context = Taro.createInnerAudioContext({ useWebAudioImplement: true });
            configureContext(context);
            idlePool.push(context);
          } catch {
            break;
          }
        }
      });
    },
    destroy() {
      playerDestroyed = true;
      for (const playback of [...activePlaybacks]) {
        dispose(playback, true);
      }
      for (const context of idlePool.splice(0)) {
        context.destroy();
      }
    },
  };
}
