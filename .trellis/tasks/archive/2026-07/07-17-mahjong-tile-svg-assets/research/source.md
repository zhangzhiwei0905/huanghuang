# Upstream Source — `lietxia/mahjong_graphic`

- Repository: https://github.com/lietxia/mahjong_graphic
- Locked commit: `3e275804ff58325306710bef3a7406860444bc6a`
- Source directory: `Vectors 矢量图/SVG(透明背景 Transparent background)/`
- License: https://github.com/lietxia/mahjong_graphic/blob/main/LICENSE
- README attribution note: https://github.com/lietxia/mahjong_graphic#readme

## File Mapping

- `1m.svg` ～ `9m.svg` → `wan-1.svg` ～ `wan-9.svg`
- `1s.svg` ～ `9s.svg` → `tiao-1.svg` ～ `tiao-9.svg`
- `1p.svg` ～ `9p.svg` → `tong-1.svg` ～ `tong-9.svg`

Riichi notation: `m` = manzu/万子, `s` = souzu/索子（条子）, `p` = pinzu/饼子（筒子）。Red-five files `0m.svg`, `0s.svg`, and `0p.svg` are intentionally excluded.

## Allowed Adaptations

- Replace the upstream root `viewBox="0 0 19 26"` with the project root `viewBox="0 0 240 320"`.
- Wrap the original SVG body with `translate(16 17.684211) scale(10.947368)` so the complete upstream canvas remains inside the requested safe area without distortion.
- Remap the four upstream solid colors to the project palette as documented in `design.md`.
- Rename files according to the mapping above.
- Preserve all upstream path `d` data and circle counts unchanged.

## License Note

The linked license grants unrestricted use, copying, modification, and distribution for commercial and noncommercial purposes, without warranty.

The repository README states that some graphics, including one through nine manzu and variants of one souzu and one pinzu, originate from or were modified from `SyaoranHinata/I.Mahjong` / GL-MahjongTile. The repository distributes the complete set under the license linked above.
