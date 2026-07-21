import { useMemo, useState } from "react";
import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { BaseScore, RoomMode, RoomProjection } from "@huanghuang/protocol";
import { ApiError, roomApi } from "../../api/http";
import { issueSession } from "../../api/session";
import { errorLabel } from "../../lib/errors";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
const NICK_KEY = "huanghuang-nickname";

type Mode = "HOME" | "CREATE" | "JOIN" | "BOT";

export default function IndexPage() {
  const [mode, setMode] = useState<Mode>("HOME");
  const [nickname, setNickname] = useState(() => {
    try {
      const value = Taro.getStorageSync(NICK_KEY);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  });
  const [roomCode, setRoomCode] = useState("");
  const [baseScore, setBaseScore] = useState<BaseScore>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = useMemo(() => {
    if (mode === "CREATE") return "创建好友房";
    if (mode === "JOIN") return "加入房间";
    if (mode === "BOT") return "人机对战";
    return "晃晃";
  }, [mode]);

  async function submit(kind: "CREATE" | "JOIN" | "BOT") {
    const name = nickname.trim();
    if (name.length === 0) {
      setError("先填一个牌桌昵称");
      return;
    }
    if (kind === "JOIN" && !/^\d{6}$/u.test(roomCode)) {
      setError("房间号需要是 6 位数字");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await issueSession(name);
      const room: RoomProjection =
        kind === "JOIN"
          ? await roomApi.join(name, roomCode)
          : await roomApi.create(
              name,
              baseScore,
              (kind === "BOT" ? "BOT" : "FRIEND") satisfies RoomMode,
            );
      Taro.setStorageSync(NICK_KEY, name);
      Taro.setStorageSync("huanghuang_open_room", room);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "UNKNOWN";
      setError(errorLabel(code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mp-home">
      <View className="mp-home__brand">
        <Text className="mp-home__eyebrow">PRIVATE TABLE · 横屏</Text>
        <Text className="mp-home__title">{heading}</Text>
        <Text className="mp-home__sub">四人数字麻将 · 好友房 / 人机</Text>
      </View>

      <View className="mp-home__panel">
        {mode === "HOME" ? (
          <View className="mp-home__actions">
            <Button className="mp-btn mp-btn--primary" disabled={busy} onClick={() => setMode("CREATE")}>
              创建房间
            </Button>
            <Button className="mp-btn" disabled={busy} onClick={() => setMode("JOIN")}>
              加入房间
            </Button>
            <Button className="mp-btn" disabled={busy} onClick={() => setMode("BOT")}>
              人机对战
            </Button>
          </View>
        ) : (
          <View className="mp-home__form">
            <View className="mp-field">
              <Text className="mp-field__label">昵称</Text>
              <Input
                className="mp-field__input"
                value={nickname}
                maxlength={12}
                placeholder="怎么称呼你"
                onInput={(event) => setNickname(event.detail.value)}
              />
            </View>

            {mode === "JOIN" ? (
              <View className="mp-field">
                <Text className="mp-field__label">房间号</Text>
                <Input
                  className="mp-field__input"
                  value={roomCode}
                  maxlength={6}
                  type="number"
                  placeholder="6 位数字"
                  onInput={(event) => setRoomCode(event.detail.value)}
                />
              </View>
            ) : (
              <View className="mp-field">
                <Text className="mp-field__label">底分</Text>
                <View className="mp-score-row">
                  {BASE_SCORES.map((score) => (
                    <Button
                      key={score}
                      className={`mp-score${baseScore === score ? " is-on" : ""}`}
                      disabled={busy}
                      onClick={() => setBaseScore(score)}
                    >
                      {score}
                    </Button>
                  ))}
                </View>
              </View>
            )}

            {error !== null ? <Text className="mp-error">{error}</Text> : null}

            <View className="mp-home__form-actions">
              <Button
                className="mp-btn mp-btn--primary"
                disabled={busy}
                onClick={() =>
                  void submit(mode === "JOIN" ? "JOIN" : mode === "BOT" ? "BOT" : "CREATE")
                }
              >
                {mode === "JOIN" ? "进入" : mode === "BOT" ? "开始" : "创建"}
              </Button>
              <Button className="mp-btn" disabled={busy} onClick={() => setMode("HOME")}>
                返回
              </Button>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
