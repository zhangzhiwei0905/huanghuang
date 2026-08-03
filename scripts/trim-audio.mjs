#!/usr/bin/env node
// Trims each game sound effect down to just the "action" window that used to
// be carved out at playback time via context.startTime + a stop-timer (see
// apps/miniprogram/src/lib/gameAudioPlayer.ts git history). Playing a
// pre-trimmed clip means the player can just play-to-onEnded instead of
// racing a timer against network + decode latency.
//
// Usage: node scripts/trim-audio.mjs
// Re-runnable: overwrites huanghuang-audio/mp3-trimmed/ every time, so it's
// safe to re-run after editing AUDIO_WINDOWS below or replacing a source
// clip in huanghuang-audio/mp3-version/.
//
// Requires ffmpeg on PATH (brew install ffmpeg).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(repoRoot, "huanghuang-audio", "mp3-version");
const OUTPUT_DIR = path.join(repoRoot, "huanghuang-audio", "mp3-trimmed");

/**
 * Mirrors the AUDIO_WINDOWS table that used to live in
 * apps/miniprogram/src/lib/gameAudioPlayer.ts (startTime/duration in
 * seconds, measured by ear against each source clip). Keep this in sync if
 * a source clip is replaced or its cue timing changes.
 *
 * `action-win.mp3`, `laiyou.mp3`, and `pre-audio.mp3` are intentionally
 * excluded here: grepping the miniprogram source confirms zero producing
 * code path ever selects them (gameAudioEvents.ts's effectAudioFileName /
 * winAudioFileName never return "action-win.mp3", and "laiyou.mp3" /
 * "pre-audio.mp3" don't appear in the codebase at all). They are dead
 * source assets — do not trim or upload them.
 *
 * `gkd-xmz.mp3` (the 搞快点 quick-message voice) was converted straight
 * from the author's m4a recording and must NOT be trimmed — it is kept
 * out of AUDIO_WINDOWS and uploaded to mp3-trimmed/ as-is.
 */
const AUDIO_WINDOWS = {
  "action-added-kong.mp3": { startTime: 0.62, duration: 0.72 },
  "action-kong.mp3": { startTime: 0.77, duration: 0.37 },
  "action-pong.mp3": { startTime: 0.83, duration: 0.33 },
  "action-release-wildcard.mp3": { startTime: 0.76, duration: 0.73 },
  "chaotiangang.mp3": { startTime: 0.62, duration: 0.7 },
  "ruanhu.mp3": { startTime: 0, duration: 2.53 },
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

function trimFile(fileName, { startTime, duration }) {
  const input = path.join(SOURCE_DIR, fileName);
  const output = path.join(OUTPUT_DIR, fileName);
  if (!existsSync(input)) {
    console.warn(`skip (source missing): ${fileName}`);
    return false;
  }
  // -ss after -i: slower but frame-accurate seeking, which matters for
  // sub-second cue windows. All source clips are a few seconds long, so the
  // decode cost is negligible.
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-ss",
      String(startTime),
      "-t",
      String(duration),
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      output,
    ],
    { stdio: "inherit" },
  );
  return true;
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  let trimmed = 0;
  for (const [fileName, window] of Object.entries(AUDIO_WINDOWS)) {
    if (trimFile(fileName, window)) trimmed += 1;
  }
  console.log(`\nTrimmed ${trimmed}/${Object.keys(AUDIO_WINDOWS).length} files into ${OUTPUT_DIR}`);
}

main();
