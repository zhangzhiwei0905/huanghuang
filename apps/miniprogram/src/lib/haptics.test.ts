import Taro from "@tarojs/taro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hapticsForAudioFiles, hapticAction, hapticTap, hapticWarn } from "./haptics";

vi.mock("@tarojs/taro", () => ({
  default: {
    vibrateShort: vi.fn(),
    vibrateLong: vi.fn(),
  },
}));

const vibrateShort = vi.mocked(Taro.vibrateShort);
const vibrateLong = vi.mocked(Taro.vibrateLong);

describe("haptics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps table-action audio files to a single medium pulse", () => {
    hapticsForAudioFiles(["tile-wan-3.mp3"]);
    expect(vibrateShort).toHaveBeenCalledWith({ type: "medium" });
    expect(vibrateShort).toHaveBeenCalledTimes(1);
  });

  it("covers meld cues (action-* and chaotiangang)", () => {
    hapticsForAudioFiles(["action-pong.mp3"]);
    hapticsForAudioFiles(["chaotiangang.mp3"]);
    expect(vibrateShort).toHaveBeenCalledTimes(2);
  });

  it("maps win cues to a long buzz instead of a short pulse", () => {
    hapticsForAudioFiles(["yinghu.mp3"]);
    expect(vibrateLong).toHaveBeenCalledTimes(1);
    expect(vibrateShort).not.toHaveBeenCalled();
  });

  it("ignores voice-message clips", () => {
    hapticsForAudioFiles(["gaokuaidian.mp3", "woyijingtingle.mp3"]);
    expect(vibrateShort).not.toHaveBeenCalled();
    expect(vibrateLong).not.toHaveBeenCalled();
  });

  it("vibrates at most once per batch even with multiple files", () => {
    hapticsForAudioFiles(["action-kong.mp3", "tile-tiao-5.mp3"]);
    expect(vibrateShort).toHaveBeenCalledTimes(1);
  });

  it("tap uses a light pulse and warn uses the long buzz", () => {
    hapticTap();
    hapticAction();
    hapticWarn();
    expect(vibrateShort).toHaveBeenNthCalledWith(1, { type: "light" });
    expect(vibrateShort).toHaveBeenNthCalledWith(2, { type: "medium" });
    expect(vibrateLong).toHaveBeenCalledTimes(1);
  });

  it("fails silently when the device has no haptic support", () => {
    vibrateShort.mockImplementation(() => {
      throw new Error("vibrateShort:fail");
    });
    expect(() => hapticTap()).not.toThrow();
  });
});
