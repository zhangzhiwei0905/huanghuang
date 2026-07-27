import Taro from "@tarojs/taro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAudioFileUrls } from "./cloudAudio";
import { createGameAudioPlayer } from "./gameAudioPlayer.js";

vi.mock("@tarojs/taro", () => ({
  default: {
    createInnerAudioContext: vi.fn(),
    cloud: {
      init: vi.fn(),
      getTempFileURL: vi.fn(
        async ({ fileList }: { fileList: string[] }) => ({
          fileList: fileList.map((fileID) => ({
            fileID,
            tempFileURL: `https://mock.example/${encodeURIComponent(fileID)}`,
            maxAge: 600,
            status: 0,
            errMsg: "getTempFileURL:ok",
          })),
        }),
      ),
    },
  },
}));

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
    emitError: () => errorHandler?.(),
    emitEnded: () => endedHandler?.(),
  };
}

describe("game audio player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateAudioFileUrls();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves cloud URLs before skipping leading silence and starting rapid cues", async () => {
    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext)
      .mockReturnValueOnce(firstAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>)
      .mockReturnValueOnce(
        secondAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
      );
    const player = createGameAudioPlayer();

    player.play("tile-wan-1.mp3");
    player.play("tile-wan-2.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(1);
      expect(secondAudio.play).toHaveBeenCalledTimes(1);
    });

    expect(firstAudio.startTime).toBeCloseTo(0.9);
    expect(secondAudio.startTime).toBeCloseTo(0.9);
    expect(firstAudio.src).toContain("tile-wan-1.mp3");
    expect(secondAudio.src).toContain("tile-wan-2.mp3");
    expect(firstAudio.stop).not.toHaveBeenCalled();
    expect(secondAudio.stop).not.toHaveBeenCalled();

    player.destroy();
  });

  it("stops every active cue when the page player is destroyed", async () => {
    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext)
      .mockReturnValueOnce(firstAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>)
      .mockReturnValueOnce(
        secondAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
      );
    const player = createGameAudioPlayer();

    player.play("action-pong.mp3");
    player.play("action-kong.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(1);
      expect(secondAudio.play).toHaveBeenCalledTimes(1);
    });
    player.destroy();
    vi.runAllTimers();

    expect(firstAudio.stop).toHaveBeenCalledTimes(1);
    expect(secondAudio.stop).toHaveBeenCalledTimes(1);
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

  it("warmup pre-creates pool contexts and play() reuses them", async () => {
    const pooledAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext).mockReturnValue(
      pooledAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
    );
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    });

    player.play("action-pong.mp3");
    await vi.waitFor(() => {
      expect(pooledAudio.play).toHaveBeenCalledTimes(1);
    });
    // Pool reuse means no third context was created for the first play.
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);

    player.destroy();
    // One context is idle in the pool; the playing one is stopped + destroyed
    // (destroy path uses stop=true which never releases back to the pool).
    expect(pooledAudio.destroy).toHaveBeenCalledTimes(2);
  });

  it("returns a pooled context to the pool on natural end instead of destroying it", async () => {
    const pooledAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext).mockReturnValue(
      pooledAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
    );
    const player = createGameAudioPlayer();

    player.warmup();
    await vi.waitFor(() => {
      expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    });

    player.play("tile-wan-1.mp3");
    await vi.waitFor(() => {
      expect(pooledAudio.play).toHaveBeenCalledTimes(1);
    });
    pooledAudio.emitEnded();
    expect(pooledAudio.destroy).not.toHaveBeenCalled();
    expect(pooledAudio.stop).toHaveBeenCalled();

    // Next play reuses the returned context — still no new creation.
    player.play("tile-wan-2.mp3");
    await vi.waitFor(() => {
      expect(pooledAudio.play).toHaveBeenCalledTimes(2);
    });
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);

    player.destroy();
  });

  it("warmup is a silent no-op when the cloud resolve fails", async () => {
    vi.mocked(Taro.cloud.getTempFileURL).mockRejectedValueOnce(new Error("network down"));
    const player = createGameAudioPlayer();

    expect(() => player.warmup()).not.toThrow();
    await vi.waitFor(() => {
      expect(Taro.cloud.getTempFileURL).toHaveBeenCalledTimes(1);
    });
    // The shared cache resolved to an empty map; warmup still fills the pool
    // so later plays skip context creation even though URLs are missing.
    player.destroy();
  });
});
