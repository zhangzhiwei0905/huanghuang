import { useEffect, useState } from "react";
import { GameTable } from "./components/GameTable.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { useRoom } from "./hooks/useRoom.js";

type Theme = "discreet" | "premium";

export function App() {
  const room = useRoom();
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("huanghuang-theme") === "premium" ? "premium" : "discreet",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("huanghuang-theme", theme);
  }, [theme]);

  return (
    <>
      {room.room === null ? (
        <HomeScreen onOpenRoom={room.openRoom} />
      ) : (
        <GameTable
          room={room.room}
          busy={room.busy}
          error={room.error}
          onReady={room.ready}
          onContinue={room.continueBot}
          onLeave={room.leaveRoom}
          onDissolve={room.dissolve}
          onSend={room.send}
        />
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
