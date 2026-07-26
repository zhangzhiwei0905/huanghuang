import type {
  BaseScore,
  BotDifficulty,
  RoomProjection,
  TurnTimeoutSeconds,
} from "@huanghuang/protocol";
import { useState } from "react";
import { roomApi } from "../api.js";

type HomeScreenProps = {
  onOpenRoom: (room: RoomProjection) => void;
};

export function HomeScreen({ onOpenRoom }: HomeScreenProps) {
  const invitationCode = new URL(window.location.href).searchParams.get("room") ?? "";
  const [nickname, setNickname] = useState(localStorage.getItem("huanghuang-nickname") ?? "");
  const [roomCode, setRoomCode] = useState(invitationCode);
  const [baseScore, setBaseScore] = useState<BaseScore>(2);
  const [turnTimeoutSeconds, setTurnTimeoutSeconds] = useState<TurnTimeoutSeconds>(20);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("HIGH");
  const [mode, setMode] = useState<"HOME" | "CREATE" | "JOIN" | "BOT">(
    invitationCode === "" ? "HOME" : "JOIN",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "CREATE" | "JOIN" | "BOT") {
    const normalizedName = nickname.trim();
    if (normalizedName.length === 0) {
      setError("先填一个牌桌昵称");
      return;
    }
    if (kind === "JOIN" && !/^(?:[1-9]\d{3}|\d{6})$/u.test(roomCode)) {
      setError("请输入 4 位房间号");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room =
        kind !== "JOIN"
          ? await roomApi.create(
              normalizedName,
              baseScore,
              kind === "BOT" ? "BOT" : "FRIEND",
              turnTimeoutSeconds,
              botDifficulty,
            )
          : await roomApi.join(normalizedName, roomCode);
      localStorage.setItem("huanghuang-nickname", normalizedName);
      onOpenRoom(room);
    } catch {
      setError(
        kind === "CREATE"
          ? "创建失败，请稍后重试"
          : kind === "BOT"
            ? "人机对战启动失败，请稍后重试"
            : "没有找到这个房间或当前无法加入",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-shell">
      <section className="home-panel" aria-labelledby="home-title">
        <div className="brand-block">
          <p className="eyebrow">PRIVATE TABLE / 04</p>
          <h1 id="home-title">晃晃</h1>
          <p className="subtitle">四人数字麻将 · 好友房 / 人机对战</p>
        </div>

        {mode === "HOME" ? (
          <div className="home-actions">
            <button type="button" className="primary-action" onClick={() => setMode("CREATE")}>
              创建房间
            </button>
            <button type="button" onClick={() => setMode("JOIN")}>
              加入房间
            </button>
            <button type="button" onClick={() => setMode("BOT")}>
              人机对战
            </button>
            <button type="button" onClick={() => setMode("JOIN")}>
              邀请好友
            </button>
          </div>
        ) : (
          <form
            className="entry-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(mode);
            }}
          >
            <label>
              <span>牌桌昵称</span>
              <input
                value={nickname}
                maxLength={12}
                autoFocus
                onChange={(event) => setNickname(event.target.value)}
                placeholder="怎么称呼你"
              />
            </label>
            {mode === "JOIN" ? (
              <label>
                <span>四位房间号</span>
                <input
                  value={roomCode}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setRoomCode(event.target.value.replace(/\D/gu, ""))}
                  placeholder="1000"
                />
              </label>
            ) : (
              <fieldset>
                <legend>底分</legend>
                <div className="score-options">
                  {([1, 2, 5, 10] as const).map((score) => (
                    <button
                      type="button"
                      className={score === baseScore ? "is-active" : ""}
                      key={score}
                      onClick={() => setBaseScore(score)}
                    >
                      {score} 分
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {mode === "CREATE" || mode === "BOT" ? (
              <>
                <fieldset>
                  <legend>出牌时长</legend>
                  <div className="score-options">
                    {([20, 25, 30] as const).map((seconds) => (
                      <button
                        type="button"
                        className={seconds === turnTimeoutSeconds ? "is-active" : ""}
                        key={seconds}
                        onClick={() => setTurnTimeoutSeconds(seconds)}
                      >
                        {seconds} 秒
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>机器人难度</legend>
                  <div className="score-options">
                    {(["LOW", "HIGH"] as const).map((difficulty) => (
                      <button
                        type="button"
                        className={difficulty === botDifficulty ? "is-active" : ""}
                        key={difficulty}
                        onClick={() => setBotDifficulty(difficulty)}
                      >
                        {difficulty === "LOW" ? "低 · 只硬胡" : "高 · 可软胡"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : null}
            {error === null ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => setMode("HOME")}>
                返回
              </button>
              <button type="submit" className="primary-action" disabled={busy}>
                {busy
                  ? "正在进入…"
                  : mode === "CREATE"
                    ? "创建房间"
                    : mode === "BOT"
                      ? "开始对战"
                      : "进入房间"}
              </button>
            </div>
          </form>
        )}
      </section>
      <p className="home-footnote">默认静音 · 匿名会话 · iPhone 可添加到主屏幕全屏游玩</p>
    </main>
  );
}
