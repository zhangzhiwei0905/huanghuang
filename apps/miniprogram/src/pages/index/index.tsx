import { useMemo, useState } from "react";
import { View, Text, Button, Input } from "@tarojs/components";
import type { RoomMode } from "@huanghuang/protocol";
import { API_BASE } from "../../config";
import {
  getStoredSessionToken,
  issueSession,
  pingHealth,
} from "../../api/session";
import "./index.scss";

// Prove protocol package types resolve inside the mini-program bundle.
const SUPPORTED_MODES: readonly RoomMode[] = ["FRIEND", "BOT"];

export default function IndexPage() {
  const [nickname, setNickname] = useState("牌友");
  const [status, setStatus] = useState<string>("就绪");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const hasToken = useMemo(() => getStoredSessionToken() !== null, [sessionId, status]);

  async function onPing() {
    setBusy(true);
    setStatus("检查服务…");
    try {
      const health = await pingHealth();
      setStatus(`健康检查: ${health.status} · API ${API_BASE}`);
    } catch (error) {
      setStatus(`健康检查失败: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function onIssueSession() {
    setBusy(true);
    setStatus("申请会话…");
    try {
      const session = await issueSession(nickname.trim() || "牌友");
      setSessionId(session.sessionId);
      setStatus(
        session.sessionToken !== null
          ? `会话已签发 sessionId=${session.sessionId}`
          : `会话已有 sessionId=${session.sessionId}（无新 token 回显时可复用本地存储）`,
      );
    } catch (error) {
      setStatus(`会话失败: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="scaffold">
      <Text className="scaffold__title">晃晃 · 微信小程序脚手架</Text>
      <Text className="scaffold__meta">API_BASE = {API_BASE}</Text>
      <Text className="scaffold__meta">
        协议模式类型: {SUPPORTED_MODES.join(" / ")}
      </Text>
      <Text className="scaffold__meta">本地 token: {hasToken ? "已存在" : "无"}</Text>
      {sessionId !== null ? (
        <Text className="scaffold__meta">sessionId: {sessionId}</Text>
      ) : null}

      <Input
        className="scaffold__input"
        value={nickname}
        maxlength={12}
        placeholder="昵称"
        onInput={(event) => setNickname(event.detail.value)}
      />

      <View className="scaffold__actions">
        <Button className="scaffold__button" disabled={busy} onClick={() => void onPing()}>
          健康检查
        </Button>
        <Button
          className="scaffold__button scaffold__button--primary"
          disabled={busy}
          onClick={() => void onIssueSession()}
        >
          申请会话 Token
        </Button>
      </View>

      <Text className="scaffold__status">{status}</Text>
      <Text className="scaffold__hint">
        用微信开发者工具打开 apps/miniprogram 目录（miniprogramRoot=dist）。生产构建设置
        TARO_APP_API_BASE 为 HTTPS 域名。
      </Text>
    </View>
  );
}
