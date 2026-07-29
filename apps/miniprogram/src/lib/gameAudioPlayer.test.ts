import Taro from "@tarojs/taro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAudioFileUrls } from "./cloudAudio";
import { createGameAudioPlayer } from "./gameAudioPlayer.js";

vi.mock("@tarojs/taro", () => {
  const fileSystemManager = {
    // Cache-hit by default: most tests don't care about the local file
    // cache and just want play() to reach context.play() the same way it
    // always has. Tests that specifically exercise the cache-miss /
    // download path override this per-test.
    accessSync: vi.fn(() => undefined),
    mkdirSync: vi.fn(() => undefined),
  };
  return {
    default: {
      createInnerAudioContext: vi.fn(),
      env: { USER_DATA_PATH: "/mock/user-data" },
      getFileSystemManager: vi.fn(() => fileSystemManager),
      downloadFile: vi.fn(),
      cloud: {
        init: vi.fn(),
        getTempFileURL: vi.fn(async ({ fileList }: { fileList: string[] }) => ({
          fileList: fileList.map((fileID) => ({
            fileID,
            tempFileURL: `https://mock.example/${encodeURIComponent(fileID)}`,
            maxAge: 600,
            status: 0,
            errMsg: "getTempFileURL:ok",
          })),
        })),
      },
    },
  };
});

type ErrorHandler = () => void;
type EndedHandler = () => void;

function createAudioContextMock() {
  let errorHandler: ErrorHandler | null = null;
  let endedHandler: EndedHandler | null = null;
  return {
    autoplay: false,
    loop: false,
    obeyMuteSwitch: true,
    startTime: 0,
    src: "",
    play: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    onError: vi.fn((handler: ErrorHandler) => {
      errorHandler = handler;
    }),
    onEnded: vi.fn((handler: EndedHandler) => {
      endedHandler = handler;
    }),
    offError: vi.fn((handler?: ErrorHandler) => {
      if (handler === undefined || handler === errorHandler) errorHandler = null;
    }),
    offEnded: vi.fn((handler?: EndedHandler) => {
      if (handler === undefined || handler === endedHandler) endedHandler = null;
    }),
    emitError: () => errorHandler?.(),
    emitEnded: () => endedHandler?.(),
  };
}

function mockContexts(count: number) {
  const contexts = Array.from({ length: count }, () => createAudioContextMock());
  const mocked = vi.mocked(Taro.createInnerAudioContext);
  for (const context of contexts) {
    mocked.mockReturnValueOnce(context as unknown as ReturnType<typeof Taro.createInnerAudioContext>);
  }
  return contexts;
}

describe("game audio player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateAudioFileUrls();
    vi.mocked(Taro.getFileSystemManager().accessSync).mockReset().mockReturnValue(undefined);
    vi.mocked(Taro.getFileSystemManager().mkdirSync).mockReset().mockReturnValue(undefined);
    vi.mocked(Taro.downloadFile).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("warms two contexts and lets two short cues finish without interruption", async () => {
    const [firstAudio, secondAudio] = mockContexts(2);
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    });

    player.play("tile-wan-1.mp3");
    player.play("tile-wan-2.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(1);
      expect(secondAudio.play).toHaveBeenCalledTimes(1);
    });

    expect(firstAudio.src).toContain("tile-wan-1.mp3");
    expect(secondAudio.src).toContain("tile-wan-2.mp3");
    expect(firstAudio.stop).not.toHaveBeenCalled();
    expect(secondAudio.stop).not.toHaveBeenCalled();

    firstAudio.emitEnded();
    secondAudio.emitEnded();
    expect(firstAudio.destroy).not.toHaveBeenCalled();
    expect(secondAudio.destroy).not.toHaveBeenCalled();
    expect(firstAudio.offEnded).toHaveBeenCalledTimes(1);
    expect(secondAudio.offEnded).toHaveBeenCalledTimes(1);

    player.destroy();
    expect(firstAudio.destroy).toHaveBeenCalledTimes(1);
    expect(secondAudio.destroy).toHaveBeenCalledTimes(1);
  });

  it("never drops a play() call: a third simultaneous cue gets a freshly created context", async () => {
    const [firstAudio, secondAudio, thirdAudio] = mockContexts(3);
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    });

    player.play("tile-wan-1.mp3");
    player.play("tile-wan-2.mp3");
    player.play("tile-wan-3.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(1);
      expect(secondAudio.play).toHaveBeenCalledTimes(1);
      expect(thirdAudio.play).toHaveBeenCalledTimes(1);
    });

    // The pool grew instead of silently dropping the third call.
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(3);
    expect(thirdAudio.src).toContain("tile-wan-3.mp3");

    player.destroy();
    expect(firstAudio.destroy).toHaveBeenCalledTimes(1);
    expect(secondAudio.destroy).toHaveBeenCalledTimes(1);
    expect(thirdAudio.destroy).toHaveBeenCalledTimes(1);
  });

  it("plays a clip to its natural end without a stop-timer cutting it short", async () => {
    const [audio] = mockContexts(1);
    const player = createGameAudioPlayer();

    player.play("action-pong.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(1);
    });

    // No timer should ever call stop() on its own; only emitEnded() (the
    // clip finishing on its own) or destroy() should.
    vi.advanceTimersByTime(5000);
    expect(audio.stop).not.toHaveBeenCalled();
    expect(audio.destroy).not.toHaveBeenCalled();

    audio.emitEnded();
    expect(audio.offEnded).toHaveBeenCalledTimes(1);
    expect(audio.offError).toHaveBeenCalledTimes(1);
    expect(audio.stop).not.toHaveBeenCalled();
    expect(audio.destroy).not.toHaveBeenCalled();

    player.destroy();
  });

  it("reuses an idle pooled context for the next cue instead of creating another one", async () => {
    const [audio] = mockContexts(1);
    const player = createGameAudioPlayer();

    // No warmup(): the pool starts empty, so this first play() must create
    // a context from scratch.
    player.play("action-pong.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(1);
    });
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(1);
    audio.emitEnded();

    player.play("action-kong.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(2);
    });

    // Only one context was ever created — the second play() reused the
    // idle one instead of creating another.
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(1);
    expect(audio.src).toContain("action-kong.mp3");
    player.destroy();
  });

  it("bounds the idle pool: contexts beyond the reuse limit are destroyed, not leaked", async () => {
    const contexts = mockContexts(5);
    const player = createGameAudioPlayer();

    for (const fileName of [
      "tile-wan-1.mp3",
      "tile-wan-2.mp3",
      "tile-wan-3.mp3",
      "tile-wan-4.mp3",
      "tile-wan-5.mp3",
    ] as const) {
      player.play(fileName);
    }
    await vi.waitFor(() => {
      for (const context of contexts) expect(context.play).toHaveBeenCalledTimes(1);
    });
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(5);

    for (const context of contexts) context.emitEnded();

    // Idle pool caps at 4: exactly one of the five finished contexts must
    // have been destroyed on return instead of being kept around forever.
    const destroyedCount = contexts.filter((context) => context.destroy.mock.calls.length > 0).length;
    expect(destroyedCount).toBe(1);

    player.destroy();
    for (const context of contexts) {
      expect(context.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("stops active playbacks and destroys every pooled context on destroy()", async () => {
    const [firstAudio, secondAudio] = mockContexts(2);
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    });
    player.play("action-pong.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(1);
    });
    player.destroy();

    expect(firstAudio.stop).toHaveBeenCalledTimes(1);
    expect(firstAudio.destroy).toHaveBeenCalledTimes(1);
    expect(secondAudio.destroy).toHaveBeenCalledTimes(1);
  });

  it("never creates an audio context if the player is destroyed before URLs resolve", async () => {
    type TempFileUrlResult = Awaited<ReturnType<typeof Taro.cloud.getTempFileURL>>;
    let releaseTempFileUrl: (result: TempFileUrlResult) => void = () => undefined;
    const pending = new Promise<TempFileUrlResult>((resolve) => {
      releaseTempFileUrl = resolve;
    });
    vi.mocked(Taro.cloud.getTempFileURL).mockImplementationOnce(
      ({ fileList }: { fileList: string[] }) =>
        pending.then((result) => {
          void fileList;
          return result;
        }),
    );
    const player = createGameAudioPlayer();

    player.play("action-pong.mp3");
    player.destroy();
    releaseTempFileUrl({
      fileList: [
        {
          fileID: "action-pong.mp3",
          tempFileURL: "https://mock.example/action-pong.mp3",
          maxAge: 600,
          status: 0,
          errMsg: "getTempFileURL:ok",
        },
      ],
      errMsg: "getTempFileURL:ok",
    });
    await vi.waitFor(() => {
      expect(Taro.cloud.getTempFileURL).toHaveBeenCalledTimes(1);
    });

    expect(Taro.createInnerAudioContext).not.toHaveBeenCalled();
  });

  it("uses the local file cache when warmup() finds an already-downloaded copy", async () => {
    const [audio] = mockContexts(1);
    vi.mocked(Taro.getFileSystemManager().accessSync).mockReturnValue(undefined);
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.getFileSystemManager().accessSync).toHaveBeenCalledWith(
        "/mock/user-data/audio/tile-wan-1.mp3",
      );
    });

    player.play("tile-wan-1.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(1);
    });

    expect(audio.src).toBe("/mock/user-data/audio/tile-wan-1.mp3");
    expect(Taro.downloadFile).not.toHaveBeenCalled();

    player.destroy();
  });

  it("downloads and caches a clip locally on a cache miss, falling back to the cloud URL meanwhile", async () => {
    const [firstPlayAudio, laterPlayAudio] = mockContexts(2);
    vi.mocked(Taro.getFileSystemManager().accessSync).mockImplementation((path: string) => {
      if (path === "/mock/user-data/audio/tile-wan-1.mp3") {
        throw new Error("fail no such file or directory");
      }
    });
    let resolveDownload: () => void = () => undefined;
    const downloadPending = new Promise<void>((resolve) => {
      resolveDownload = resolve;
    });
    vi.mocked(Taro.downloadFile).mockImplementation(
      () =>
        downloadPending.then(() => ({
          filePath: "/mock/user-data/audio/tile-wan-1.mp3",
          tempFilePath: "",
          statusCode: 200,
          errMsg: "downloadFile:ok",
        })) as unknown as ReturnType<typeof Taro.downloadFile>,
    );
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.downloadFile).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "/mock/user-data/audio/tile-wan-1.mp3" }),
      );
    });

    // Cache miss hasn't resolved yet — play() must not stall waiting for the
    // download, it falls back to the cloud temp URL immediately.
    player.play("tile-wan-1.mp3");
    await vi.waitFor(() => {
      expect(firstPlayAudio.play).toHaveBeenCalledTimes(1);
    });
    expect(firstPlayAudio.src).toContain("https://mock.example/");

    resolveDownload();
    // Flush the download promise's .then chain (Promise microtasks resolve
    // independently of the faked setTimeout/setInterval clock) so the local
    // cache is populated before the next play() call reads it.
    for (let flush = 0; flush < 5; flush += 1) {
      await Promise.resolve();
    }

    player.play("tile-wan-1.mp3");
    await vi.waitFor(() => {
      expect(laterPlayAudio.play).toHaveBeenCalledTimes(1);
    });
    expect(laterPlayAudio.src).toBe("/mock/user-data/audio/tile-wan-1.mp3");

    player.destroy();
  });
});
