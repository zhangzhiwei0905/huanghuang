import Taro from "@tarojs/taro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameAudioPlayer } from "./gameAudioPlayer.js";

vi.mock("@tarojs/taro", () => ({
  default: {
    createInnerAudioContext: vi.fn(),
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips leading silence and starts rapid cues immediately", () => {
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

    expect(firstAudio.play).toHaveBeenCalledTimes(1);
    expect(secondAudio.play).toHaveBeenCalledTimes(1);
    expect(firstAudio.startTime).toBeCloseTo(0.9);
    expect(secondAudio.startTime).toBeCloseTo(0.9);
    expect(firstAudio.stop).not.toHaveBeenCalled();
    expect(secondAudio.stop).not.toHaveBeenCalled();

    player.destroy();
  });

  it("stops every active cue when the page player is destroyed", () => {
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
    player.destroy();
    vi.runAllTimers();

    expect(firstAudio.stop).toHaveBeenCalledTimes(1);
    expect(secondAudio.stop).toHaveBeenCalledTimes(1);
    expect(firstAudio.destroy).toHaveBeenCalledTimes(1);
    expect(secondAudio.destroy).toHaveBeenCalledTimes(1);
  });
});
