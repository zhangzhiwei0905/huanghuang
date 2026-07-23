import { useEffect, useMemo, useState } from "react";
import { Button, Form, Image, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { BaseScore, RoomMode, RoomProjection } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ApiError, roomApi } from "../../api/http";
import { API_BASE } from "../../config";
import {
  clearStoredSessionToken,
  type Identity,
  resolveIdentity,
  uploadAvatar,
  wechatLogin,
} from "../../api/session";
import { errorLabel } from "../../lib/errors";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];

type Mode = "HOME" | "CREATE" | "JOIN" | "BOT";
type IdentityState = "checking" | "loggedOut" | "loggedIn";

function sharedRoomCode(code: string | undefined): string | null {
  return code !== undefined && /^\d{6}$/u.test(code) ? code : null;
}

// A rejection here can come from two very different layers: our own API
// (ApiError, with a known error code) or wx.request/Taro.request itself
// failing before it ever reached the server (wrong/unwhitelisted domain,
// DNS, TLS, timeout — none of which are ApiError instances, and none of
// which Taro/wx wrap in a real `Error`; they reject with a plain
// `{ errMsg: string }`). Swallowing the latter into one generic "操作没有
//成功" string makes real-device domain-whitelist failures indistinguishable
// from an actual server error — surface whatever detail is available.
function LoginGate({ onDone }: { onDone: (identity: Identity) => void }) {
  const [avatarTempPath, setAvatarTempPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "status" | "error";
    message: string;
  } | null>(null);

  function onChooseAvatar(event: { detail: { avatarUrl: string } }) {
    if (typeof event.detail.avatarUrl !== "string" || event.detail.avatarUrl.length === 0) {
      setFeedback({ kind: "error", message: "没有读取到所选头像，请重新选择" });
      return;
    }
    // chooseAvatar returns a local temp path. Preview it immediately so a
    // slow or blocked upload cannot look like the selection did nothing.
    setAvatarTempPath(event.detail.avatarUrl);
    setFeedback(null);
  }

  async function submit(event: { detail: { value?: Record<string, unknown> } }) {
    const rawNickname = event.detail.value?.nickname;
    const nickname = typeof rawNickname === "string" ? rawNickname.trim() : "";
    if (avatarTempPath === null) {
      setFeedback({ kind: "error", message: "请先选择微信头像" });
      return;
    }
    if (nickname.trim().length === 0) {
      setFeedback({
        kind: "error",
        message: "请点击昵称框，选择微信昵称或手动输入名字",
      });
      return;
    }
    setBusy(true);
    setFeedback({ kind: "status", message: "正在处理并上传头像…" });
    try {
      let uploadedAvatarUrl: string;
      try {
        uploadedAvatarUrl = await uploadAvatar(avatarTempPath);
      } catch (cause) {
        const detail = requestFailureDetail(cause);
        setFeedback({
          kind: "error",
          message: `头像上传失败${detail.length > 0 ? `：${detail}` : ""}，请重试`,
        });
        return;
      }
      // wx.login()'s code expires in minutes — fetch it right before the
      // submit, not earlier while the user is still picking an avatar/typing.
      try {
        setFeedback({ kind: "status", message: "头像已上传，正在登录微信…" });
        const identity = await wechatLogin(nickname, uploadedAvatarUrl);
        onDone(identity);
      } catch (cause) {
        const detail = requestFailureDetail(cause);
        setFeedback({
          kind: "error",
          message: `登录没有成功${detail.length > 0 ? `：${detail}` : ""}，请再试一次`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form className="mp-home__panel mp-login" onSubmit={(event) => void submit(event)}>
      <Text className="mp-home__panel-title">欢迎来晃晃</Text>
      <Button
        openType="chooseAvatar"
        onChooseAvatar={(event) => void onChooseAvatar(event)}
        className="mp-login__avatar-btn"
        disabled={busy}
      >
        {avatarTempPath !== null ? (
          <Image src={avatarTempPath} mode="aspectFill" className="mp-login__avatar-img" />
        ) : (
          <Text className="mp-login__avatar-fallback">选头像</Text>
        )}
      </Button>
      <Input
        className="mp-field__input"
        type="nickname"
        name="nickname"
        maxlength={12}
        placeholder="点击选择微信昵称"
      />
      <Text className="mp-login__nickname-hint">
        点击昵称框，在微信键盘中选择“使用微信昵称”，选中后仍可修改
      </Text>
      {feedback !== null ? (
        <Text className={`mp-login__feedback${feedback.kind === "error" ? " is-error" : ""}`}>
          {feedback.message}
        </Text>
      ) : null}
      <View className="mp-home__form-actions">
        <Button
          formType="submit"
          hoverClass="is-pressed"
          className="mp-btn mp-btn--primary"
          disabled={busy}
        >
          {busy ? "正在进入…" : "进入晃晃"}
        </Button>
      </View>
    </Form>
  );
}

function requestFailureDetail(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null && "errMsg" in cause) {
    const message = (cause as { errMsg?: unknown }).errMsg;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function describeSubmitError(cause: unknown): string {
  if (cause instanceof ApiError) return errorLabel(cause.code);
  const detail = requestFailureDetail(cause);
  if (detail.length > 0) return `请求失败：${detail}`;
  return "操作没有成功，请再试一次";
}

export default function IndexPage() {
  // A friend opening a shared invite card lands here with ?code=123456
  // (see RoomPage's useShareAppMessage) — deep-linking straight to
  // /pages/room/index isn't possible, that page hydrates from wx storage
  // set by the create/join flow below, not from a cold-start route param.
  const sharedCode = sharedRoomCode(Taro.useRouter().params.code);
  const [mode, setMode] = useState<Mode>(sharedCode !== null ? "JOIN" : "HOME");
  const [identityState, setIdentityState] = useState<IdentityState>("checking");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [roomCode, setRoomCode] = useState(sharedCode ?? "");
  const [baseScore, setBaseScore] = useState<BaseScore>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveIdentity()
      .then((resolved) => {
        if (resolved !== null) {
          setIdentity(resolved);
          setIdentityState("loggedIn");
        } else {
          setIdentityState("loggedOut");
        }
      })
      .catch(() => setIdentityState("loggedOut"));
  }, []);

  const heading = useMemo(() => {
    if (mode === "CREATE") return "创建好友房";
    if (mode === "JOIN") return "加入房间";
    if (mode === "BOT") return "人机对战";
    return "晃晃";
  }, [mode]);

  async function submit(kind: "CREATE" | "JOIN" | "BOT") {
    if (identity === null) return;
    if (kind === "JOIN" && !/^\d{6}$/u.test(roomCode)) {
      setError("房间号需要是 6 位数字");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room: RoomProjection =
        kind === "JOIN"
          ? await roomApi.join(identity.nickname, roomCode)
          : await roomApi.create(
              identity.nickname,
              baseScore,
              (kind === "BOT" ? "BOT" : "FRIEND") satisfies RoomMode,
            );
      Taro.setStorageSync("huanghuang_open_room", room);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (cause) {
      setError(describeSubmitError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (identityState === "checking") {
    return (
      <View className="mp-home">
        <Image className="mp-home__bg" src={tableBackground} mode="aspectFill" />
        <View className="mp-home__overlay" />
      </View>
    );
  }

  if (identityState === "loggedOut") {
    return (
      <View className="mp-home">
        <Image className="mp-home__bg" src={tableBackground} mode="aspectFill" />
        <View className="mp-home__overlay" />
        <LoginGate
          onDone={(resolved) => {
            setIdentity(resolved);
            setIdentityState("loggedIn");
          }}
        />
      </View>
    );
  }

  if (identity === null) return null; // unreachable: loggedIn is only set alongside identity

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
              <Text className="mp-field__label">身份</Text>
              {identity.avatarUrl !== null ? (
                <Image src={`${API_BASE}${identity.avatarUrl}`} className="mp-field__avatar" />
              ) : null}
              <Text className="mp-field__value">{identity.nickname}</Text>
              <Text
                className="mp-field__relogin"
                onClick={() => {
                  clearStoredSessionToken();
                  setIdentity(null);
                  setIdentityState("loggedOut");
                }}
              >
                重新登录
              </Text>
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
