import type { Tile, TileKind } from "@huanghuang/protocol";

import img_tiao_1 from "../assets/tiles/tiao-1.svg";
import img_tiao_2 from "../assets/tiles/tiao-2.svg";
import img_tiao_3 from "../assets/tiles/tiao-3.svg";
import img_tiao_4 from "../assets/tiles/tiao-4.svg";
import img_tiao_5 from "../assets/tiles/tiao-5.svg";
import img_tiao_6 from "../assets/tiles/tiao-6.svg";
import img_tiao_7 from "../assets/tiles/tiao-7.svg";
import img_tiao_8 from "../assets/tiles/tiao-8.svg";
import img_tiao_9 from "../assets/tiles/tiao-9.svg";
import img_tong_1 from "../assets/tiles/tong-1.svg";
import img_tong_2 from "../assets/tiles/tong-2.svg";
import img_tong_3 from "../assets/tiles/tong-3.svg";
import img_tong_4 from "../assets/tiles/tong-4.svg";
import img_tong_5 from "../assets/tiles/tong-5.svg";
import img_tong_6 from "../assets/tiles/tong-6.svg";
import img_tong_7 from "../assets/tiles/tong-7.svg";
import img_tong_8 from "../assets/tiles/tong-8.svg";
import img_tong_9 from "../assets/tiles/tong-9.svg";
import img_wan_1 from "../assets/tiles/wan-1.svg";
import img_wan_2 from "../assets/tiles/wan-2.svg";
import img_wan_3 from "../assets/tiles/wan-3.svg";
import img_wan_4 from "../assets/tiles/wan-4.svg";
import img_wan_5 from "../assets/tiles/wan-5.svg";
import img_wan_6 from "../assets/tiles/wan-6.svg";
import img_wan_7 from "../assets/tiles/wan-7.svg";
import img_wan_8 from "../assets/tiles/wan-8.svg";
import img_wan_9 from "../assets/tiles/wan-9.svg";

const TILE_PREFIX = { WAN: "wan", TIAO: "tiao", TONG: "tong" } as const;

const TILE_URLS: Record<string, string> = {
  "tiao-1.svg": img_tiao_1,
  "tiao-2.svg": img_tiao_2,
  "tiao-3.svg": img_tiao_3,
  "tiao-4.svg": img_tiao_4,
  "tiao-5.svg": img_tiao_5,
  "tiao-6.svg": img_tiao_6,
  "tiao-7.svg": img_tiao_7,
  "tiao-8.svg": img_tiao_8,
  "tiao-9.svg": img_tiao_9,
  "tong-1.svg": img_tong_1,
  "tong-2.svg": img_tong_2,
  "tong-3.svg": img_tong_3,
  "tong-4.svg": img_tong_4,
  "tong-5.svg": img_tong_5,
  "tong-6.svg": img_tong_6,
  "tong-7.svg": img_tong_7,
  "tong-8.svg": img_tong_8,
  "tong-9.svg": img_tong_9,
  "wan-1.svg": img_wan_1,
  "wan-2.svg": img_wan_2,
  "wan-3.svg": img_wan_3,
  "wan-4.svg": img_wan_4,
  "wan-5.svg": img_wan_5,
  "wan-6.svg": img_wan_6,
  "wan-7.svg": img_wan_7,
  "wan-8.svg": img_wan_8,
  "wan-9.svg": img_wan_9,
};

export function tileArtworkFilename(tile: Pick<Tile, "suit" | "rank"> | TileKind): string {
  return `${TILE_PREFIX[tile.suit]}-${tile.rank}.svg`;
}

export function tileArtworkUrl(tile: Pick<Tile, "suit" | "rank"> | TileKind): string {
  const filename = tileArtworkFilename(tile);
  const url = TILE_URLS[filename];
  if (url === undefined) throw new Error(`Missing tile art: ${filename}`);
  return url;
}

export function isWildcardTile(
  tile: Pick<Tile, "suit" | "rank"> | null,
  wildcardKind: TileKind | null,
): boolean {
  return (
    tile !== null &&
    wildcardKind !== null &&
    tile.suit === wildcardKind.suit &&
    tile.rank === wildcardKind.rank
  );
}
