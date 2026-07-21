import { useState } from "react";
import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { BaseScore, RoomMode } from "@huanghuang/protocol";
import { roomApi } from "../../api/http";
import { issueSession } from "../../api/session";
import { API_BASE } from "../../config";
import { errorLabel } from "../../lib/errors";
import { ApiError } from "../../api/http";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];

export default function IndexPage() {
  const [nickname, setNickname] = useState("牌友");
  const [roomCode, setRoomCode] = useState("");
  const [baseScore, setBaseScore] = useState<BaseScore>(2);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(`API ${API_BASE}`);

  async function ensureSession(): Promise<void> {
    await issueSession(nickname.trim() || "牌友");
  }

  async function enterRoom(mode: "CREATE_FRIEND" | "CREATE_BOT" | "JOIN") {
    const name = nickname.trim();
    if (name.length === 0) {
      setStatus("请先填写昵称");
      return;
    }
    if (mode === "JOIN" && !/^\d{6}$/u.test(roomCode)) {
      setStatus("房间号需要 6 位数字");
      return;
    }
    setBusy(true);
    setStatus("处理中…");
    try {
      await ensureSession();
      const room =
        mode === "JOIN"
          ? await roomApi.join(name, roomCode)
          : await roomApi.create(
              name,
              baseScore,
              (mode === "CREATE_BOT" ? "BOT" : "FRIEND") satisfies RoomMode,
            );
      Taro.setStorageSync("huanghuang_open_room", room);
      setStatus(`进入房间 ${room.roomCode}`);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "UNKNOWN";
      setStatus(errorLabel(code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="home">
      <Text className="home__title">晃晃</Text>
      <Text className="home__meta">{status}</Text>

      <Text className="home__label">昵称</Text>
      <Input
        className="home__input"
        value={nickname}
        maxlength={12}
        placeholder="牌桌昵称"
        onInput={(event) => setNickname(event.detail.value)}
      />

      <Text className="home__label">底分（建房）</Text>
      <View className="home__row">
        {BASE_SCORES.map((score) => (
          <Button
            key={score}
            className={`home__chip${baseScore === score ? " home__chip--active" : ""}`}
            disabled={busy}
            onClick={() => setBaseScore(score)}
          >
            {score}
          </Button>
        ))}
      </View>

      <View className="home__actions">
        <Button
          className="home__button home__button--primary"
          disabled={busy}
          onClick={() => void enterRoom("CREATE_FRIEND")}
        >
          创建好友房
        </Button>
        <Button
          className="home__button home__button--primary"
          disabled={busy}
          onClick={() => void enterRoom("CREATE_BOT")}
        >
          人机对战
        </Button>
      </View>

      <Text className="home__label">加入房间</Text>
      <Input
        className="home__input"
        value={roomCode}
        maxlength={6}
        type="number"
        placeholder="6 位房间号"
        onInput={(event) => setRoomCode(event.detail.value)}
      />
      <Button className="home__button" disabled={busy} onClick={() => void enterRoom("JOIN")}>
        加入
      </Button>
    </View>
  );
}
