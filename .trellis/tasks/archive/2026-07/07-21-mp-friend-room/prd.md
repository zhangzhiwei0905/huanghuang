# Miniprogram friend-room polish

**Parent:** `07-21-mp-web-parity-ui`  
**Order:** After table UI

## Goal

Complete friend-room UX for mini-program-only play (invite/copy, lobby clarity, owner controls).

## Requirements

- F1. Prominent room code + copy-to-clipboard.
- F2. Lobby seats show nickname/ready/owner/connected/empty from `lobbySeats`.
- F3. Owner base score + dissolve; all members ready/leave.
- F4. Document how to test with two DevTools projects / two accounts (not web dual-end).
- F5. Friend play path works under new UI.

## Acceptance Criteria

- [x] Copy room code API wired (`Taro.setClipboardData`); operator confirm toast.
- [x] Lobby state readable for 4 seats (`lobbySeats` grid).
- [x] Friend flow documented in `docs/miniprogram-friend-room.md`.
- [x] Parent AC4 evidence notes filled.
