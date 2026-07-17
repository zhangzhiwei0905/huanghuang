import { useEffect, useState } from "react";
import { roomApi } from "./api.js";
import { GameTable } from "./components/GameTable.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { useRoom } from "./hooks/useRoom.js";

type Theme = "discreet" | "premium";

export function App() {
  const room = useRoom();
  const [restoringRoom, setRestoringRoom] = useState(() => {
    const roomCode = new URL(window.location.href).searchParams.get("room");
    return roomCode !== null && /^\d{6}$/.test(roomCode);
  });
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("huanghuang-theme") === "premium" ? "premium" : "discreet",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("huanghuang-theme", theme);
  }, [theme]);

  useEffect(() => {
    const roomCode = new URL(window.location.href).searchParams.get("room");
    if (roomCode === null || !/^\d{6}$/.test(roomCode)) {
      setRestoringRoom(false);
      return;
    }

    let cancelled = false;
    void roomApi
      .get(roomCode)
      .then((projection) => {
        if (!cancelled) room.openRoom(projection);
      })
      .catch(() => {
        // 邀请链接也会带 room 参数；未加入的访客仍应回到加入房间表单。
      })
      .finally(() => {
        if (!cancelled) setRestoringRoom(false);
      });

    return () => {
      cancelled = true;
    };
  }, [room.openRoom]);

  return (
    <>
      {restoringRoom ? (
        <main className="room-restore-shell" role="status" aria-live="polite">
          <span className="room-restore-pulse" aria-hidden="true" />
          <strong>正在恢复牌局</strong>
          <small>正在同步服务器上的最新状态…</small>
        </main>
      ) : room.room === null ? (
        <HomeScreen onOpenRoom={room.openRoom} />
      ) : (
        <GameTable
          room={room.room}
          busy={room.busy}
          connectionStatus={room.connectionStatus}
          pendingAction={room.pendingAction}
          error={room.error}
          chatMessages={room.chatMessages}
          onReady={room.ready}
          onBaseScoreChange={room.updateBaseScore}
          onContinue={room.continueBot}
          onChat={room.sendChat}
          onLeave={room.leaveRoom}
          onDissolve={room.dissolve}
          onSend={room.send}
        />
      )}
      {room.notice === null ? null : (
        <div className="global-notice" role="alert">
          {room.notice}
        </div>
      )}
      <button
        type="button"
        className="theme-toggle"
        aria-label="切换界面风格"
        onClick={() => setTheme((current) => (current === "discreet" ? "premium" : "discreet"))}
      >
        {theme === "discreet" ? "低调" : "精美"}
      </button>
    </>
  );
}
