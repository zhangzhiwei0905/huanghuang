import Taro from "@tarojs/taro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoredGameAudioEnabled, setStoredGameAudioEnabled } from "./gameAudioPreference.js";

vi.mock("@tarojs/taro", () => ({
  default: {
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
  },
}));

describe("game audio preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to enabled and restores an explicit disabled choice", () => {
    vi.mocked(Taro.getStorageSync).mockReturnValue("");
    expect(getStoredGameAudioEnabled()).toBe(true);

    vi.mocked(Taro.getStorageSync).mockReturnValue(false);
    expect(getStoredGameAudioEnabled()).toBe(false);
  });

  it("persists the user's choice without surfacing storage failures", () => {
    setStoredGameAudioEnabled(false);
    expect(Taro.setStorageSync).toHaveBeenCalledWith("huanghuang_game_audio_enabled", false);

    vi.mocked(Taro.setStorageSync).mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => setStoredGameAudioEnabled(true)).not.toThrow();
  });
});
