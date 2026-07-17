import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const upstreamRoot = process.argv[2];

if (!upstreamRoot) {
  throw new Error("Pass the lietxia/mahjong_graphic checkout path as the first argument.");
}

const upstreamCommit = "3e275804ff58325306710bef3a7406860444bc6a";
const sourceDirectory = resolve(
  upstreamRoot,
  "Vectors 矢量图",
  "SVG(透明背景 Transparent background)",
);
const outputDirectory = resolve("apps/web/src/assets/tiles");
const transform = "translate(16 17.684211) scale(10.947368)";

const suits = [
  {
    sourceSuffix: "m",
    targetPrefix: "wan",
    colors: new Map([
      ["#881c21", "#9b4038"],
      ["#231815", "#405d70"],
    ]),
  },
  {
    sourceSuffix: "s",
    targetPrefix: "tiao",
    colors: new Map([
      ["#005529", "#2d6653"],
      ["#231815", "#2d6653"],
      ["#881c21", "#967335"],
    ]),
  },
  {
    sourceSuffix: "p",
    targetPrefix: "tong",
    colors: new Map([
      ["#011833", "#405d70"],
      ["#881c21", "#967335"],
    ]),
  },
];

mkdirSync(outputDirectory, { recursive: true });

for (const suit of suits) {
  for (let rank = 1; rank <= 9; rank += 1) {
    const sourceName = `${rank}${suit.sourceSuffix}.svg`;
    const targetName = `${suit.targetPrefix}-${rank}.svg`;
    const source = readFileSync(resolve(sourceDirectory, sourceName), "utf8");

    if (!/<svg\b[^>]*viewBox="0 0 19 26"[^>]*>/i.test(source)) {
      throw new Error(`${sourceName} does not use the expected 0 0 19 26 viewBox.`);
    }

    const bodyMatch = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    if (!bodyMatch) {
      throw new Error(`${sourceName} is not a complete SVG document.`);
    }

    let body = bodyMatch[1].trim();
    for (const [from, to] of suit.colors) {
      body = body.replaceAll(from, to);
    }

    const target = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" aria-hidden="true" focusable="false">
  <!-- Adapted from lietxia/mahjong_graphic@${upstreamCommit}: ${sourceName} -->
  <g transform="${transform}">
${body}
  </g>
</svg>
`;

    writeFileSync(resolve(outputDirectory, targetName), target);
  }
}
