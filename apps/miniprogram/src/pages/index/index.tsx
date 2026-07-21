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

  const title = useMemo(() => {
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
      setError(
        kind === "JOIN" ? errorLabel(code) || "没有找到这个房间或当前无法加入" : errorLabel(code),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="home-shell">
      <View className="home-panel">
        <View className="brand-block">
          <Text className="eyebrow">PRIVATE TABLE / 04</Text>
          <Text className="home-title">{title}</Text>
          <Text className="subtitle">四人数字麻将 · 好友房 / 人机对战</Text>
        </View>

        {mode === "HOME" ? (
          <View className="home-actions">
            <Button className="primary-action" disabled={busy} onClick={() => setMode("CREATE")}>
              创建房间
            </Button>
            <Button className="secondary-action" disabled={busy} onClick={() => setMode("JOIN")}>
              加入房间
            </Button>
            <Button className="secondary-action" disabled={busy} onClick={() => setMode("BOT")}>
              人机对战
            </Button>
            <Button className="secondary-action" disabled={busy} onClick={() => setMode("JOIN")}>
              邀请好友
            </Button>
          </View>
        ) : (
          <View className="entry-form">
            <View className="field">
              <Text className="field__label">牌桌昵称</Text>
              <Input
                className="field__input"
                value={nickname}
                maxlength={12}
                placeholder="怎么称呼你"
                onInput={(event) => setNickname(event.detail.value)}
              />
            </View>

            {mode === "JOIN" ? (
              <View className="field">
                <Text className="field__label">六位房间号</Text>
                <Input
                  className="field__input"
                  value={roomCode}
                  maxlength={6}
                  type="number"
                  placeholder="例如 123456"
                  onInput={(event) => setRoomCode(event.detail.value)}
                />
              </View>
            ) : (
              <View className="field">
                <Text className="field__label">底分</Text>
                <View className="score-row">
                  {BASE_SCORES.map((score) => (
                    <Button
                      key={score}
                      className={`score-chip${baseScore === score ? " is-active" : ""}`}
                      disabled={busy}
                      onClick={() => setBaseScore(score)}
                    >
                      {score}
                    </Button>
                  ))}
                </View>
              </View>
            )}

            {error !== null ? <Text className="form-error">{error}</Text> : null}

            <View className="form-actions">
              <Button
                className="primary-action"
                disabled={busy}
                onClick={() => void submit(mode === "JOIN" ? "JOIN" : mode === "BOT" ? "BOT" : "CREATE")}
              >
                {mode === "JOIN" ? "进入房间" : mode === "BOT" ? "开始人机" : "创建并进入"}
              </Button>
              <Button className="secondary-action" disabled={busy} onClick={() => setMode("HOME")}>
                返回
              </Button>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
