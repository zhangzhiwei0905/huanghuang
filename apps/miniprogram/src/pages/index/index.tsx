import { useMemo, useState } from "react";
import { Button, Image, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { BaseScore, RoomMode, RoomProjection } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ApiError, roomApi } from "../../api/http";
import { issueSession } from "../../api/session";
import { errorLabel } from "../../lib/errors";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
const NICK_KEY = "huanghuang-nickname";

type Mode = "HOME" | "CREATE" | "JOIN" | "BOT";

// A rejection here can come from two very different layers: our own API
// (ApiError, with a known error code) or wx.request/Taro.request itself
// failing before it ever reached the server (wrong/unwhitelisted domain,
// DNS, TLS, timeout — none of which are ApiError instances, and none of
// which Taro/wx wrap in a real `Error`; they reject with a plain
// `{ errMsg: string }`). Swallowing the latter into one generic "操作没有
//成功" string makes real-device domain-whitelist failures indistinguishable
// from an actual server error — surface whatever detail is available.
function describeSubmitError(cause: unknown): string {
  if (cause instanceof ApiError) return errorLabel(cause.code);
  if (cause instanceof Error && cause.message.length > 0) {
    return `请求失败：${cause.message}`;
  }
  if (typeof cause === "object" && cause !== null && "errMsg" in cause) {
    const message = (cause as { errMsg?: unknown }).errMsg;
    if (typeof message === "string" && message.length > 0) {
      return `请求失败：${message}`;
    }
  }
  return "操作没有成功，请再试一次";
}

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
      setError(describeSubmitError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="mp-home">
      <Image className="mp-home__bg" src={tableBackground} mode="aspectFill" />
      <View className="mp-home__overlay" />
      {mode === "HOME" ? (
        <View className="mp-home__stage">
          <View className="mp-home__logo">
            <View className="mp-home__logo-tile mp-home__logo-tile--a">
              <Text className="mp-home__logo-char">晃</Text>
            </View>
            <View className="mp-home__logo-tile mp-home__logo-tile--b">
              <Text className="mp-home__logo-char">晃</Text>
            </View>
          </View>
          <Text className="mp-home__tagline">四人数字麻将 · 好友房 / 人机对战</Text>
          <View className="mp-home__menu">
            <Button
              hoverClass="is-pressed"
              className="mp-btn mp-btn--primary"
              disabled={busy}
              onClick={() => setMode("BOT")}
            >
              人机对战
            </Button>
            <Button
              hoverClass="is-pressed"
              className="mp-btn"
              disabled={busy}
              onClick={() => setMode("CREATE")}
            >
              创建房间
            </Button>
            <Button
              hoverClass="is-pressed"
              className="mp-btn"
              disabled={busy}
              onClick={() => setMode("JOIN")}
            >
              加入房间
            </Button>
          </View>
        </View>
      ) : (
        <View className="mp-home__panel">
          <Text className="mp-home__panel-title">{heading}</Text>
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
                      hoverClass="is-pressed"
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
                hoverClass="is-pressed"
                className="mp-btn mp-btn--primary"
                disabled={busy}
                onClick={() =>
                  void submit(mode === "JOIN" ? "JOIN" : mode === "BOT" ? "BOT" : "CREATE")
                }
              >
                {mode === "JOIN" ? "进入" : mode === "BOT" ? "开始" : "创建"}
              </Button>
              <Button
                hoverClass="is-pressed"
                className="mp-btn"
                disabled={busy}
                onClick={() => setMode("HOME")}
              >
                返回
              </Button>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
