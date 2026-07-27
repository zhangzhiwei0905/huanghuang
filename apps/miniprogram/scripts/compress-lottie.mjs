#!/usr/bin/env node
/* Offline lottie data compression for the mahjong effect .cjs files.
 *
 * What it does (visually lossless):
 *  1. Rounds every numeric property in the animation tree to 2 decimal
 *     places (sub-millipixel / sub-millisecond precision is invisible).
 *  2. Drops AE-export cruft layers: guide layers (`cl: "guide"`) and layers
 *     explicitly disabled in the export (`td` matte parents are kept).
 *
 * Usage:
 *   node scripts/compress-lottie.mjs           # compress in place
 *   node scripts/compress-lottie.mjs --check   # report sizes, write nothing
 *
 * Originals are preserved under src/effects/mahjong/data/originals/ on the
 * first run; re-running never overwrites the backup.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/effects/mahjong/data");
const BACKUP_DIR = join(DATA_DIR, "originals");
const CHECK_ONLY = process.argv.includes("--check");

function roundNumbers(value) {
  if (typeof value === "number") {
    return Math.round(value * 100) / 100;
  }
  if (Array.isArray(value)) {
    return value.map(roundNumbers);
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = roundNumbers(value[key]);
    }
  }
  return value;
}

function stripCruftLayers(data) {
  if (!Array.isArray(data.layers)) return 0;
  const before = data.layers.length;
  data.layers = data.layers.filter((layer) => layer.cl !== "guide" && layer.hd !== true);
  return before - data.layers.length;
}

let totalBefore = 0;
let totalAfter = 0;

for (const file of readdirSync(DATA_DIR).filter((name) => name.endsWith(".cjs"))) {
  const path = join(DATA_DIR, file);
  const source = readFileSync(path, "utf8");
  const before = Buffer.byteLength(source);
  const data = JSON.parse(source.replace(/^module\.exports\s*=\s*/, "").replace(/;\s*$/, ""));
  const stripped = stripCruftLayers(data);
  roundNumbers(data);
  const output = `module.exports = ${JSON.stringify(data)};\n`;
  const after = Buffer.byteLength(output);
  totalBefore += before;
  totalAfter += after;
  const pct = (((before - after) / before) * 100).toFixed(1);
  console.log(
    `${file}: ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB (-${pct}%)` +
      (stripped > 0 ? ` [${stripped} cruft layers dropped]` : ""),
  );
  if (!CHECK_ONLY) {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
    const backupPath = join(BACKUP_DIR, file);
    if (!existsSync(backupPath)) copyFileSync(path, backupPath);
    writeFileSync(path, output);
  }
}

console.log(
  `TOTAL: ${(totalBefore / 1024).toFixed(1)}KB → ${(totalAfter / 1024).toFixed(1)}KB ` +
    `(-${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%)${CHECK_ONLY ? " [check only]" : ""}`,
);
