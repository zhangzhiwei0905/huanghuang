import Taro from "@tarojs/taro";

/* Haptics stay independent from the game-audio preference: a muted player
   still wants tactile confirmation. Every call fails silently — devtools and
   some Android devices simply have no haptic support. */

function safeRun(trigger: () => void): void {
  try {
    trigger();
  } catch {
    // no haptic support — ignore
  }
}

/** Light tick for local UI touches (tile selection, toolbar taps). */
export function hapticTap(): void {
  safeRun(() => void Taro.vibrateShort({ type: "light" }));
}

/** Medium pulse when a table action lands (discard, meld, win cue). */
export function hapticAction(): void {
  safeRun(() => void Taro.vibrateShort({ type: "medium" }));
}

/** Long buzz for warnings (countdown entering the urgent window). */
export function hapticWarn(): void {
  safeRun(() => void Taro.vibrateLong());
}

/**
 * Derive haptic pulses from the same audio-event file list the sound player
 * consumes, so "what happened on the table" has exactly one source of truth
 * (`updateGameAudioTracker`). Voice messages (gaokuaidian/woyijingtingle) are
 * excluded. Wins get the long buzz, every other table action a medium pulse.
 */
export function hapticsForAudioFiles(files: readonly string[]): void {
  for (const fileName of files) {
    if (fileName === "yinghu.mp3" || fileName === "ruanhu.mp3") {
      hapticWarn();
      return;
    }
    if (
      fileName.startsWith("tile-") ||
      fileName.startsWith("action-") ||
      fileName === "chaotiangang.mp3"
    ) {
      hapticAction();
      return;
    }
  }
}
