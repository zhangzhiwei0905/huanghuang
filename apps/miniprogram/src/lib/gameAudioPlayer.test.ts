import Taro from "@tarojs/taro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAudioFileUrls } from "./cloudAudio";
import { createGameAudioPlayer } from "./gameAudioPlayer.js";

vi.mock("@tarojs/taro", () => ({
  default: {
    createInnerAudioContext: vi.fn(),
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

describe("game audio player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateAudioFileUrls();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("warms two contexts and lets two short cues finish without interruption", async () => {
    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext)
      .mockReturnValueOnce(firstAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>)
      .mockReturnValueOnce(
        secondAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
      );
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

    expect(firstAudio.startTime).toBeCloseTo(0.9);
    expect(secondAudio.startTime).toBeCloseTo(0.9);
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

  it("drops a third simultaneous cue instead of queueing or creating another context", async () => {
    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext)
      .mockReturnValueOnce(firstAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>)
      .mockReturnValueOnce(
        secondAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
      );
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
    });

    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(2);
    expect(firstAudio.src).not.toContain("tile-wan-3.mp3");
    expect(secondAudio.src).not.toContain("tile-wan-3.mp3");

    firstAudio.emitEnded();
    player.play("tile-wan-4.mp3");
    await vi.waitFor(() => {
      expect(firstAudio.play).toHaveBeenCalledTimes(2);
    });
    expect(firstAudio.src).toContain("tile-wan-4.mp3");
    player.destroy();
  });

  it("returns a timed-out clip to its slot and clears old event listeners", async () => {
    const audio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext).mockReturnValueOnce(
      audio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
    );
    const player = createGameAudioPlayer();

    player.play("action-pong.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(1);
    });
    vi.advanceTimersByTime(380);

    expect(audio.stop).toHaveBeenCalledTimes(1);
    expect(audio.destroy).not.toHaveBeenCalled();
    expect(audio.offEnded).toHaveBeenCalledTimes(1);
    expect(audio.offError).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("");

    player.play("action-kong.mp3");
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalledTimes(2);
    });
    expect(Taro.createInnerAudioContext).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it("stops active slots and destroys the fixed pool with the page player", async () => {
    const firstAudio = createAudioContextMock();
    const secondAudio = createAudioContextMock();
    vi.mocked(Taro.createInnerAudioContext)
      .mockReturnValueOnce(firstAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>)
      .mockReturnValueOnce(
        secondAudio as unknown as ReturnType<typeof Taro.createInnerAudioContext>,
      );
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
    vi.runAllTimers();

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
});
