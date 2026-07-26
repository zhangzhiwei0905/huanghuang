# Design

## Overview

No protocol or server changes are needed. All three requirements are satisfied by:
1. Reading data that already exists in `RoomProjection` (`roundSettlement.winType`, `Meld.kind === "INDICATOR_PONG_KONG"`).
2. Reusing the existing, already-server-validated `room:chat` socket event for the voice-message feature, which the miniprogram client simply hasn't wired up yet.

## R1 + R2: `gameAudioEvents.ts` / `gameAudioPlayer.ts` changes

### `GameAudioFileName` (gameAudioEvents.ts)
Add to the union: `"yinghu.mp3" | "ruanhu.mp3" | "chaotiangang.mp3" | "gaokuaidian.mp3" | "woyijingtingle.mp3"`.
Keep `"action-win.mp3"` in the union (asset retained, per requirement) even though nothing pushes it anymore after this change.

### `meldAudioFileName()`
```ts
function meldAudioFileName(kind: MeldKind): GameAudioFileName {
  if (kind === "PONG") return "action-pong.mp3";
  if (kind === "ADDED_KONG") return "action-added-kong.mp3";
  if (kind === "INDICATOR_PONG_KONG") return "chaotiangang.mp3";
  return "action-kong.mp3"; // EXPOSED_KONG / CONCEALED_KONG, unchanged
}
```

### Win settlement branch in `detectGameAudioFiles()`
```ts
if (settlement?.kind === "WIN" && settlement.roundId !== previous.settlementRoundId) {
  files.push(settlement.winType === "HARD" ? "yinghu.mp3" : "ruanhu.mp3");
}
```
`settlement.winType` on `RoundSettlementProjection` is `WinType | null`; it is non-null whenever `kind === "WIN"` (confirmed by `packages/game-engine/src/settlement.ts` — winType is only ever set together with a WIN outcome), so the ternary needs no extra null branch beyond what TypeScript requires (narrow with `settlement.winType === "HARD"`, else SOFT — if the type checker complains about `null` in the ternary, guard with `settlement.winType === "HARD" ? "yinghu.mp3" : "ruanhu.mp3"`, which already treats `null` same as SOFT, an acceptable fallback since it cannot occur on a WIN settlement).

### Voice-message text → audio mapping (new, in `gameAudioEvents.ts`)
```ts
const VOICE_MESSAGE_AUDIO: Record<string, GameAudioFileName> = {
  "搞快点搞快点": "gaokuaidian.mp3",
  "我已经听牌啦": "woyijingtingle.mp3",
};

export function voiceMessageAudioFileName(message: string): GameAudioFileName | null {
  return VOICE_MESSAGE_AUDIO[message] ?? null;
}

export const VOICE_MESSAGES: { label: string; text: string }[] = [
  { label: "催", text: "搞快点搞快点" },
  { label: "听牌", text: "我已经听牌啦" },
];
```
`VOICE_MESSAGES` gives the room page a single source of truth for button label + exact text to send, so the button list and the audio mapping can never drift apart.

### `gameAudioPlayer.ts`
- Add 5 new `import` statements (mirrors existing pattern) pointing at the copied files under `../assets/audio/`.
- Add entries to `AUDIO_SOURCES` for all 5 new file names.
- Add entries to `AUDIO_WINDOWS`. Final split (per two rounds of explicit user correction):
  - `yinghu.mp3`: `{ startTime: 0, duration: 2.53 }` — **full length** (measured 2.377s). First trimmed to a peak window, then reverted: the user found the trimmed win call incomplete-sounding and wants it played in full, same as the voice-message clips.
  - `ruanhu.mp3`: `{ startTime: 0, duration: 2.53 }` — **full length** (measured 2.377s), same reasoning as `yinghu.mp3`.
  - `chaotiangang.mp3`: `{ startTime: 0.62, duration: 0.7 }` — **peak window**, same short-cue convention as the existing `action-*` files. Not called out in the revert, stays trimmed.
  - `gaokuaidian.mp3`: `{ startTime: 0, duration: 2.92 }` (full length; measured 2.769s)
  - `woyijingtingle.mp3`: `{ startTime: 0, duration: 3.44 }` (full length; measured 3.291s)

  Total durations measured via `afconvert -f WAVE -d LEI16@44100 -c 1` + a Python duration check. The three peak windows were *not* guessed: a small one-off script computed a 10ms-hop RMS envelope and searched for the highest-energy contiguous span at each candidate duration (0.3–0.9s) — this method was first validated against the two known existing windows (`action-win.mp3`: predicted 0.71–1.31 vs. actual 0.69–1.31; `action-pong.mp3`: predicted 0.80–1.10 vs. actual 0.83–1.16), then applied to the three new files and the closest-matching candidate duration picked by ear-adjacent reasoning (2-character 硬胡/软胡 ≈ same window style as `action-win`; 3-character 朝天杠 ≈ same window style as the longer `action-added-kong`/`action-release-wildcard` cues). Not re-derived at build time; not a substitute for an actual listen-through in WeChat DevTools before shipping.

## R3: Voice-message send/receive plumbing

### Asset copy
Copy the 5 new mp3s from `/Users/zhang/Documents/VscodeFiles/huanghuang/huanghuang-audio/mp3-version/` into `apps/miniprogram/src/assets/audio/` (same flat layout as existing files).

### `useRoom.ts`
- Import `ChatMessageProjection` from `@huanghuang/protocol`.
- New state: `const [lastChatMessage, setLastChatMessage] = useState<ChatMessageProjection | null>(null);`
- Inside the existing socket-lifecycle `useEffect`, register a handler and clean it up alongside the other `socket.on`/`socket.off` pairs:
  ```ts
  const handleChatMessage = (payload: ChatMessageProjection) => {
    if (!disposed) setLastChatMessage(payload);
  };
  socket.on("room:chat", handleChatMessage);
  // ...
  socket.off("room:chat", handleChatMessage); // in cleanup
  ```
- New callback, following the existing `leaveRoom`/`dissolve` style but fire-and-forget (no `runExclusive`, no `refresh()` — this is not a room-state mutation, just a broadcast, and gating it behind the busy/pending-action machinery would block it on unrelated in-flight game commands for no benefit):
  ```ts
  const sendVoiceMessage = useCallback((message: string) => {
    const current = roomRef.current;
    const socket = socketRef.current;
    if (current === null || socket?.connected !== true) return;
    socket.emit("room:chat", { roomCode: current.roomCode, message }, () => {});
  }, []);
  ```
  Errors (`ACTION_NOT_AVAILABLE`, `NOT_A_MEMBER`, disconnected) are silently ignored per PRD scope (no chat UI to surface them in, and the button is already gated to the conditions the server checks).
- Add `lastChatMessage` and `sendVoiceMessage` to the `RoomController` type and the returned object.

### `room/index.tsx`
- Extend `useGameAudio(room, connectionStatus, enabled, chatMessage)`:
  ```ts
  function useGameAudio(
    room: RoomProjection | null,
    connectionStatus: ConnectionStatus,
    enabled: boolean,
    chatMessage: ChatMessageProjection | null,
  ): void {
    // ...existing tracker/player refs...
    const lastPlayedChatIdRef = useRef<string | null>(null);

    // existing game-state-diff effect, unchanged

    useEffect(() => {
      if (chatMessage === null) return;
      if (lastPlayedChatIdRef.current === chatMessage.id) return;
      lastPlayedChatIdRef.current = chatMessage.id;
      if (!enabled) return;
      const fileName = voiceMessageAudioFileName(chatMessage.message);
      if (fileName === null) return;
      if (playerRef.current === null) playerRef.current = createGameAudioPlayer();
      playerRef.current.play(fileName);
    }, [chatMessage, enabled]);

    // existing unmount-cleanup effect, unchanged
  }
  ```
  `chatMessage.id` (a server-generated `randomUUID()`) is the natural dedupe key — no extra counter/nonce needed, and it also means a message that arrives before the tracker's `enabled` flips true is never replayed later.
- Call site: `useGameAudio(room, roomCtrl.connectionStatus, gameAudioEnabled, roomCtrl.lastChatMessage);`
- UI (revised twice per explicit user feedback): a single standalone "快捷消息" trigger button lives inside `.table-surface`, as a sibling right after `.self-area` closes, parked beside the self player-station card at the table's bottom-right corner. Gated on `quickMessageAvailable = room !== null && room.mode === "FRIEND" && room.stage === "PLAYING"` (mirrors the server-side `createChatMessage` check); a `useEffect` force-closes the bubble if this flips false mid-open.
  - **First iteration** used `Taro.showActionSheet` (native system sheet) — the user rejected this explicitly: "不要系统的那种选择框，而是在游戏中一个小气泡框做选择" (not the system picker, a small in-game speech bubble instead). Replaced with a fully custom popover (see below), run through the `design-taste-frontend` skill.
  - **Trigger button visual** was also called "有点丑" (a bit ugly) in its first pass (a dark translucent pill copying `.leave-fab`/`.sound-fab`). Redesigned to share the warm cream "mahjong tile" card material already used by `.player-station` (`linear-gradient(175deg, rgb(253 252 246/96%), rgb(240 236 221/96%))`, `border: 1px solid #d8d4c4`, jade `--accent` text) instead of dark chrome — this is a social action, not a utility control, so it should read differently from the leave/sound fabs. One corner (`border-radius: 1.8vmin 1.8vmin 1.8vmin 0.4vmin`) is squared off to read as a speech-bubble silhouette without needing an icon (project convention has no icon library; see `.quick-message-fab` in index.scss).
  - **Popover**: `quickMessageOpen` boolean state (`useState`, closed by default). Trigger `onClick` toggles it. Rendered elements when open: an invisible full-surface `.quick-message-overlay` (tap anywhere on it closes without sending) behind a `.quick-message-bubble` — same cream card material, `border-radius: 1.8vmin` on all corners, anchored above the trigger (`transform-origin: bottom right`) with a small rotated-square `.quick-message-bubble__tail` pointing down at it. Two `.quick-message-bubble__item` rows (one per `VOICE_MESSAGES` entry) with a single hairline divider between them (only one divider needed for two rows). Pop-in animation: `scale(0.85) → scale(1)` + fade, 180ms `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot, matches a playful in-game feel without being gratuitous — this mini-program's WXSS has no `prefers-reduced-motion` media query support, so no reduced-motion gate was added).
  ```tsx
  function sendQuickMessage(text: string) {
    roomCtrl.sendVoiceMessage(text);
    setQuickMessageOpen(false);
  }
  ```
  ```tsx
  {quickMessageAvailable ? (
    <Button
      className="quick-message-fab"
      hoverClass="is-pressed"
      aria-label="快捷消息"
      onClick={() => setQuickMessageOpen((open) => !open)}
    >
      快捷消息
    </Button>
  ) : null}

  {quickMessageAvailable && quickMessageOpen ? (
    <>
      <View className="quick-message-overlay" onClick={() => setQuickMessageOpen(false)} />
      <View className="quick-message-bubble">
        {VOICE_MESSAGES.map((voice) => (
          <Button
            key={voice.text}
            className="quick-message-bubble__item"
            hoverClass="is-pressed"
            onClick={() => sendQuickMessage(voice.text)}
          >
            {voice.text}
          </Button>
        ))}
        <View className="quick-message-bubble__tail" />
      </View>
    </>
  ) : null}
  ```
  All four new SCSS classes (`.quick-message-fab`, `.quick-message-overlay`, `.quick-message-bubble`, `.quick-message-bubble__item`/`__tail`) are anchored using the same `right`/`bottom` geometry as `.player-station.pos-self` (that card's max width + a small gap), reasoned from the existing CSS, not visually verified in WeChat DevTools — nudge the offsets if it overlaps anything on a real device.

## Data flow summary (R3)
1. Player taps "催" → `roomCtrl.sendVoiceMessage("搞快点搞快点")` → `socket.emit("room:chat", { roomCode, message })`.
2. Server validates (member, FRIEND mode, PLAYING stage, length 1-60) → broadcasts `room:chat` to the whole socket.io room (including sender).
3. Every client's `useRoom` socket listener sets `lastChatMessage` to the received `ChatMessageProjection`.
4. `useGameAudio`'s new effect sees a `chatMessage.id` it hasn't played yet, looks up `voiceMessageAudioFileName(chatMessage.message)`, and plays it through the same `GameAudioPlayer` instance used for game-event sounds (respecting the same mute toggle).

## Compatibility / Risk
- No protocol schema changes, no server changes — zero risk of breaking the web client's existing chat feature.
- `action-win.mp3` stays registered and importable; only its trigger site is removed, so nothing else referencing that file name breaks.
- `INDICATOR_PONG_KONG` was previously (mis)routed to `action-kong.mp3`; fixing it to `chaotiangang.mp3` is a behavior change but matches the explicit requirement and the existing web-app terminology ("亮牌碰杠").
