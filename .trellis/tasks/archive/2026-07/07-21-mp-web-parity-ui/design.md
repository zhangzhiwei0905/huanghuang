# Design: MP Web-parity UI

## Approach

1. **Assets**: copy Web optimized assets into `apps/miniprogram/src/assets/` (or `assets/` static). Prefer ASCII filenames for WeChat packaging if needed (`discard.png` ↔ 出牌.png mapping in code).
2. **Components**:
   - `components/MahjongTile` — SVG/PNG face by suit+rank
   - `components/ActionDock` — maps `primaryActionButtons` → image buttons
   - `components/GameTable` — seat layout relative to `selfSeat`
   - `components/HomeScreen` — replace scaffold index UI
3. **Layout**: CSS modules/SCSS approximating web tokens (`--felt`, safe areas). Force landscape via `pageOrientation` in page config where supported; fallback stacked landscape CSS.
4. **State**: keep `useRoom`; presentation-only components.
5. **Friend room**: waiting view with code + copy (`Taro.setClipboardData`), lobby seats from `lobbySeats`, owner controls.

## Trade-offs

- Full port of 2k-line `styles.css` is wasteful; **reimplement structure with shared tokens + critical classes** rather than blind copy.
- Taro rpx vs web px: designWidth 750; map touch targets ≥ 44px CSS px.
- Bundle size: tile SVGs + 7 button PNGs + bg jpg acceptable for personal game.

## Rollback

- UI-only client changes; revert child commits independently.
