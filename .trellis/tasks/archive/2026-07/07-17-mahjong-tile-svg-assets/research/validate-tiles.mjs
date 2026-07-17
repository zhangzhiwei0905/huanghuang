import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const upstreamRoot = process.argv[2];
const upstreamCommit = "3e275804ff58325306710bef3a7406860444bc6a";
const transform = "translate(16 17.684211) scale(10.947368)";
const tilesDirectory = resolve("apps/web/src/assets/tiles");
const sourceDirectory = upstreamRoot
  ? resolve(upstreamRoot, "Vectors 矢量图", "SVG(透明背景 Transparent background)")
  : null;

const suits = {
  wan: { suffix: "m", colors: new Set(["#9b4038", "#405d70"]) },
  tiao: { suffix: "s", colors: new Set(["#2d6653", "#967335"]) },
  tong: { suffix: "p", colors: new Set(["#405d70", "#967335"]) },
};
const expectedFiles = Object.keys(suits).flatMap((suit) =>
  Array.from({ length: 9 }, (_, index) => `${suit}-${index + 1}.svg`),
);
const actualFiles = readdirSync(tilesDirectory)
  .filter((file) => file.endsWith(".svg"))
  .sort();
const errors = [];

if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) {
  errors.push(`Unexpected file set: ${actualFiles.join(", ")}`);
}

for (const file of actualFiles) {
  const target = readFileSync(resolve(tilesDirectory, file), "utf8");
  const [suitName, rankText] = file.replace(".svg", "").split("-");
  const suit = suits[suitName];
  const sourceName = `${rankText}${suit.suffix}.svg`;

  if (!target.includes('viewBox="0 0 240 320"')) {
    errors.push(`${file}: incorrect or missing viewBox`);
  }
  if (!target.includes(`transform="${transform}"`)) {
    errors.push(`${file}: incorrect or missing safe-area transform`);
  }
  if (!target.includes(`lietxia/mahjong_graphic@${upstreamCommit}: ${sourceName}`)) {
    errors.push(`${file}: incorrect or missing provenance marker`);
  }
  if (/<(?:text|image|filter|linearGradient|radialGradient|script)\b/i.test(target)) {
    errors.push(`${file}: contains a prohibited SVG element`);
  }
  if (/href="(?!#)/i.test(target) || /url\(/i.test(target)) {
    errors.push(`${file}: contains an external reference`);
  }

  const colors = new Set(target.match(/#[0-9a-f]{6}/gi) ?? []);
  for (const color of colors) {
    if (!suit.colors.has(color.toLowerCase())) {
      errors.push(`${file}: unexpected color ${color}`);
    }
  }

  if (sourceDirectory) {
    const source = readFileSync(resolve(sourceDirectory, sourceName), "utf8");
    const sourcePaths = [...source.matchAll(/<path\b[^>]*\bd="([^"]*)"/gi)].map((match) => match[1]);
    const targetPaths = [...target.matchAll(/<path\b[^>]*\bd="([^"]*)"/gi)].map((match) => match[1]);
    if (JSON.stringify(sourcePaths) !== JSON.stringify(targetPaths)) {
      errors.push(`${file}: path data differs from ${sourceName}`);
    }

    const sourceCircleCount = (source.match(/<circle\b/gi) ?? []).length;
    const targetCircleCount = (target.match(/<circle\b/gi) ?? []).length;
    if (sourceCircleCount !== targetCircleCount) {
      errors.push(`${file}: circle count differs from ${sourceName}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  const comparison = sourceDirectory ? " with upstream path comparison" : "";
  console.log(`Validated ${actualFiles.length} adapted SVG tiles${comparison}.`);
}
