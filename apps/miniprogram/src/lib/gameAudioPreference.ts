import Taro from "@tarojs/taro";

const GAME_AUDIO_ENABLED_STORAGE_KEY = "huanghuang_game_audio_enabled";

export function getStoredGameAudioEnabled(): boolean {
  try {
    return Taro.getStorageSync(GAME_AUDIO_ENABLED_STORAGE_KEY) !== false;
  } catch {
    return true;
  }
}

export function setStoredGameAudioEnabled(enabled: boolean): void {
  try {
    Taro.setStorageSync(GAME_AUDIO_ENABLED_STORAGE_KEY, enabled);
  } catch {
    // A storage failure must not block room interaction.
  }
}
