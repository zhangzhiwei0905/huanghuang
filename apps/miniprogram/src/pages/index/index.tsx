import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, Image, Input, Picker, Text, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow } from "@tarojs/taro";
import type {
  BaseScore,
  BotDifficulty,
  MatchmakingState,
  RoomMode,
  SelfCompetitiveProfile,
  RoomProjection,
  TurnTimeoutSeconds,
} from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import {
  ApiError,
  competitiveApi,
  getStoredMatchmakingAllowBots,
  roomApi,
  setStoredMatchmakingAllowBots,
  versionApi,
  type MatchmakingResponse,
  type VersionInfo,
} from "../../api/http";
import { API_BASE, APP_BUILT_AT, APP_VERSION } from "../../config";
import { PlayerProfileModal } from "../../components/PlayerProfileModal";
import { RankBadge } from "../../components/RankBadge";
import {
  clearStoredSessionToken,
  type Identity,
  resolveIdentity,
  resumeWechatIdentity,
  uploadAvatar,
  wechatLogin,
} from "../../api/session";
import { errorLabel } from "../../lib/errors";
import {
  matchmakingRoomNavigationKey,
  nextMatchmakingPollDelayMs,
  resolveReturnToCompetitiveMatch,
  shouldOpenMatchmakingRoom,
  shouldPollMatchmakingStatus,
} from "../../lib/matchmakingRecovery";
import { matchmakingRangeLabel, matchmakingWaitSeconds } from "../../lib/matchmakingPresentation";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
// Taro resolves protocol types correctly but cannot bundle runtime exports
// through the protocol package's ESM `.js` re-export paths. Keep this tuple
// locally type-constrained; the server still validates the authoritative
// create-room schema.
const TURN_TIMEOUT_OPTIONS = [20, 25, 30] satisfies TurnTimeoutSeconds[];
const BOT_DIFFICULTY_OPTIONS = ["LOW", "HIGH"] satisfies BotDifficulty[];
const TRUSTEE_MATCH_STORAGE_KEY = "huanghuang_trustee_match";

type Mode = "HOME" | "CREATE" | "JOIN" | "BOT";
type IdentityState = "checking" | "loggedOut" | "loggedIn";

function sharedRoomCode(code: string | undefined): string | null {
  return code !== undefined && /^(?:[1-9]\d{3}|\d{6})$/u.test(code) ? code : null;
}

// A rejection here can come from two very different layers: our own API
// (ApiError, with a known error code) or wx.request/Taro.request itself
// failing before it ever reached the server (wrong/unwhitelisted domain,
// DNS, TLS, timeout — none of which are ApiError instances, and none of
// which Taro/wx wrap in a real `Error`; they reject with a plain
// `{ errMsg: string }`). Swallowing the latter into one generic "操作没有
//成功" string makes real-device domain-whitelist failures indistinguishable
// from an actual server error — surface whatever detail is available.
function HomeBrand() {
  return (
    <>
      <View className="mp-home__logo">
        <View className="mp-home__logo-tile mp-home__logo-tile--a">
          <Text className="mp-home__logo-char">晃</Text>
        </View>
        <View className="mp-home__logo-tile mp-home__logo-tile--b">
          <Text className="mp-home__logo-char">晃</Text>
        </View>
      </View>
      <Text className="mp-home__tagline">四人数字麻将 · 竞技匹配 / 好友房 / 人机对战</Text>
    </>
  );
}

function LoginGate({
  onDone,
  onCancel,
}: {
  onDone: (identity: Identity) => void;
  onCancel: () => void;
}) {
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
      <Text className="mp-home__panel-title">完善微信资料</Text>
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
          {busy ? "正在登录…" : "完成登录"}
        </Button>
        <Button
          hoverClass="is-pressed"
          className="mp-btn mp-login__cancel"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </Button>
      </View>
    </Form>
  );
}

function AboutModal({
  backend,
  backendError,
  onClose,
}: {
  backend: VersionInfo | null;
  backendError: boolean;
  onClose: () => void;
}) {
  const backendLabel = (() => {
    if (backend !== null) return `${backend.version} · ${backend.builtAt}`;
    if (backendError) return "获取失败";
    return "加载中…";
  })();

  return (
    <View className="mp-about" onClick={onClose}>
      <View className="mp-about__panel" catchMove onClick={(event) => event.stopPropagation()}>
        <Text className="mp-about__title">关于</Text>
        <View className="mp-about__row">
          <Text className="mp-about__label">前端版本</Text>
          <Text className="mp-about__value">{`${APP_VERSION} · ${APP_BUILT_AT}`}</Text>
        </View>
        <View className="mp-about__row">
          <Text className="mp-about__label">后端版本</Text>
          <Text className="mp-about__value">{backendLabel}</Text>
        </View>
        <Button className="mp-btn mp-about__close" hoverClass="is-pressed" onClick={onClose}>
          关闭
        </Button>
      </View>
    </View>
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
  const [loginPanelOpen, setLoginPanelOpen] = useState(false);
  const [loginEntryBusy, setLoginEntryBusy] = useState(false);
  const [loginEntryError, setLoginEntryError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState(sharedCode ?? "");
  const [baseScore, setBaseScore] = useState<BaseScore>(2);
  const [turnTimeoutSeconds, setTurnTimeoutSeconds] = useState<TurnTimeoutSeconds>(20);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("HIGH");
  const [competitiveProfile, setCompetitiveProfile] = useState<SelfCompetitiveProfile | null>(null);
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({ status: "IDLE" });
  const [matchmakingNow, setMatchmakingNow] = useState(Date.now());
  const [matchmakingBusy, setMatchmakingBusy] = useState(false);
  const [matchmakingError, setMatchmakingError] = useState<string | null>(null);
  const [botsEnabled, setBotsEnabled] = useState(false);
  const [allowBots, setAllowBots] = useState(getStoredMatchmakingAllowBots());
  const pageVisibleRef = useRef(true);
  const matchedRoomOpeningRef = useRef(false);
  const openedMatchRoomKeyRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [backendVersion, setBackendVersion] = useState<VersionInfo | null>(null);
  const [backendVersionError, setBackendVersionError] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    // Prefetched once on page load (mirrors the competitiveApi.profile()
    // pattern below) so the "关于" modal opens instantly instead of showing a
    // loading flash every time.
    versionApi
      .get()
      .then((info) => setBackendVersion(info))
      .catch(() => setBackendVersionError(true));
  }, []);

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

  function applyMatchmakingResponse(response: MatchmakingResponse): void {
    setMatchmaking(response.state);
    setMatchmakingNow(Date.now());
    if (response.botsEnabled) setBotsEnabled(true);
    const navigationKey = matchmakingRoomNavigationKey(response);
    if (navigationKey === null || response.room === null) return;
    if (response.state.status === "MATCHED") {
      const trusteeMatchId = Taro.getStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
      const deliberatelyTrustee =
        typeof trusteeMatchId === "string" && trusteeMatchId === response.state.matchId;
      if (deliberatelyTrustee && response.room.stage !== "ROUND_RESULT") return;
      if (deliberatelyTrustee) Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
    }
    if (
      !shouldOpenMatchmakingRoom({
        pageVisible: pageVisibleRef.current,
        navigationInFlight: matchedRoomOpeningRef.current,
        navigationKey,
        openedNavigationKey: openedMatchRoomKeyRef.current,
      })
    ) {
      return;
    }
    matchedRoomOpeningRef.current = true;
    openedMatchRoomKeyRef.current = navigationKey;
    Taro.setStorageSync("huanghuang_open_room", response.room);
    void Taro.navigateTo({ url: "/pages/room/index" })
      .catch((cause) => {
        if (openedMatchRoomKeyRef.current === navigationKey) {
          openedMatchRoomKeyRef.current = null;
        }
        const detail = requestFailureDetail(cause);
        setMatchmakingError(detail.length > 0 ? `进入牌桌失败：${detail}` : "进入牌桌失败，请重试");
      })
      .finally(() => {
        matchedRoomOpeningRef.current = false;
      });
  }

  useEffect(() => {
    if (identity === null) return;
    let disposed = false;
    Promise.all([competitiveApi.profile(), competitiveApi.status()])
      .then(([profile, response]) => {
        if (disposed) return;
        setCompetitiveProfile(profile);
        applyMatchmakingResponse(response);
      })
      .catch((cause) => {
        if (!disposed) setMatchmakingError(describeSubmitError(cause));
      });
    return () => {
      disposed = true;
    };
  }, [identity]);

  useEffect(() => {
    // MATCHED is included here (not just QUEUED) so a stuck "返回对局" button
    // — matchmaking.status staying MATCHED while the server-side room is
    // actually gone/stale — gets periodically re-checked instead of only
    // ever refreshing on a manual button tap.
    if (!shouldPollMatchmakingStatus(matchmaking.status)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await competitiveApi.status();
        if (disposed) return;
        setMatchmakingError(null);
        applyMatchmakingResponse(response);
        const stillTrustee =
          response.state.status === "MATCHED" &&
          Taro.getStorageSync(TRUSTEE_MATCH_STORAGE_KEY) === response.state.matchId;
        const delay = nextMatchmakingPollDelayMs(response.state, stillTrustee);
        if (delay !== null) timer = setTimeout(() => void poll(), delay);
      } catch (cause) {
        if (disposed) return;
        setMatchmakingError(describeSubmitError(cause));
        timer = setTimeout(() => void poll(), 1_500);
      }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [matchmaking.status]);

  // Navigating back from the room page (empty-shell reLaunch, or the OS
  // resuming this page from the background) doesn't remount the component —
  // re-fetch matchmaking status so a stale MATCHED/QUEUED snapshot from
  // before the round ended gets corrected without waiting for the next poll.
  useDidShow(() => {
    pageVisibleRef.current = true;
    // A genuinely new visible visit may recover the same active match once.
    // While the room page is on top, useDidHide prevents background polling
    // from pushing duplicate room pages onto the stack.
    openedMatchRoomKeyRef.current = null;
    if (identity === null) return;
    competitiveApi
      .status()
      .then((response) => applyMatchmakingResponse(response))
      .catch((cause) => setMatchmakingError(describeSubmitError(cause)));
  });

  useDidHide(() => {
    pageVisibleRef.current = false;
  });

  const heading = useMemo(() => {
    if (mode === "CREATE") return "创建好友房";
    if (mode === "JOIN") return "加入房间";
    if (mode === "BOT") return "人机对战";
    return "晃晃";
  }, [mode]);

  async function submit(kind: "CREATE" | "JOIN" | "BOT") {
    if (identity === null) return;
    if (kind === "JOIN" && !/^(?:[1-9]\d{3}|\d{6})$/u.test(roomCode)) {
      setError("请输入 4 位房间号");
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
              turnTimeoutSeconds,
              botDifficulty,
            );
      Taro.setStorageSync("huanghuang_open_room", room);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (cause) {
      setError(describeSubmitError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function returnToCompetitiveMatch() {
    if (matchmaking.status !== "MATCHED") return;
    setMatchmakingBusy(true);
    try {
      const response = await competitiveApi.status();
      const outcome = resolveReturnToCompetitiveMatch(response);
      if (outcome.kind === "recovered") {
        // The room lookup came back empty — previously this just threw and
        // discarded the response, leaving `matchmaking` frozen at MATCHED
        // forever (the button stuck showing "返回对局", every retry
        // re-failing the same way). Apply what the server actually told us
        // so the UI can recover (e.g. once the match is resolved server-side,
        // polling/useDidShow will eventually pick up the follow-up state).
        applyMatchmakingResponse(response);
        throw new Error("MATCH_ROOM_NOT_AVAILABLE");
      }
      Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
      Taro.setStorageSync("huanghuang_open_room", outcome.room);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (cause) {
      setMatchmakingError(describeSubmitError(cause));
    } finally {
      setMatchmakingBusy(false);
    }
  }

  async function startMatchmaking() {
    if (matchmakingBusy) return;
    setMatchmakingBusy(true);
    setMatchmakingError(null);
    try {
      applyMatchmakingResponse(await competitiveApi.queue({ allowBots: allowBots && botsEnabled }));
    } catch (cause) {
      setMatchmakingError(describeSubmitError(cause));
    } finally {
      setMatchmakingBusy(false);
    }
  }

  async function startTeamRanked() {
    if (identity === null || matchmakingBusy) return;
    setMatchmakingBusy(true);
    setMatchmakingError(null);
    try {
      const room = await roomApi.create(identity.nickname, 2, "TEAM_MATCH", 20, "LOW");
      Taro.setStorageSync("huanghuang_open_room", room);
      await Taro.navigateTo({ url: "/pages/room/index" });
    } catch (cause) {
      setMatchmakingError(describeSubmitError(cause));
    } finally {
      setMatchmakingBusy(false);
    }
  }

  async function cancelMatchmaking() {
    if (matchmakingBusy) return;
    setMatchmakingBusy(true);
    try {
      applyMatchmakingResponse(await competitiveApi.cancel());
      setMatchmakingError(null);
    } catch (cause) {
      setMatchmakingError(describeSubmitError(cause));
    } finally {
      setMatchmakingBusy(false);
    }
  }

  function toggleAllowBots() {
    setAllowBots((previous) => {
      const next = !previous;
      setStoredMatchmakingAllowBots(next);
      return next;
    });
  }

  function logout() {
    if (matchmaking.status === "QUEUED") void competitiveApi.cancel();
    clearStoredSessionToken();
    setIdentity(null);
    setCompetitiveProfile(null);
    setMatchmaking({ status: "IDLE" });
    setIdentityState("loggedOut");
    setLoginPanelOpen(false);
    setLoginEntryBusy(false);
    setLoginEntryError(null);
    setMode(sharedCode !== null ? "JOIN" : "HOME");
    setError(null);
  }

  async function beginWechatLogin() {
    setLoginEntryBusy(true);
    setLoginEntryError(null);
    try {
      const resolved = await resumeWechatIdentity();
      if (resolved === null) {
        setLoginPanelOpen(true);
        return;
      }
      setIdentity(resolved);
      setIdentityState("loggedIn");
    } catch (cause) {
      const detail = requestFailureDetail(cause);
      setLoginEntryError(`微信登录失败${detail.length > 0 ? `：${detail}` : ""}，请重试`);
    } finally {
      setLoginEntryBusy(false);
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
        <View className="mp-home__stage mp-login-entry">
          <HomeBrand />
          <Button
            hoverClass="is-pressed"
            className="mp-btn mp-btn--primary mp-login-entry__button"
            disabled={loginEntryBusy}
            onClick={() => void beginWechatLogin()}
          >
            {loginEntryBusy ? "正在登录…" : "微信登录"}
          </Button>
          {loginEntryError !== null ? (
            <Text className="mp-login-entry__error">{loginEntryError}</Text>
          ) : null}
        </View>
        {loginPanelOpen ? (
          <View className="mp-login-layer">
            <View className="mp-login-layer__scrim" />
            <LoginGate
              onDone={(resolved) => {
                setIdentity(resolved);
                setIdentityState("loggedIn");
                setLoginPanelOpen(false);
              }}
              onCancel={() => setLoginPanelOpen(false)}
            />
          </View>
        ) : null}
        <Text className="mp-about-entry" onClick={() => setAboutOpen(true)}>
          关于
        </Text>
        {aboutOpen ? (
          <AboutModal
            backend={backendVersion}
            backendError={backendVersionError}
            onClose={() => setAboutOpen(false)}
          />
        ) : null}
      </View>
    );
  }

  if (identity === null) return null; // unreachable: loggedIn is only set alongside identity

  const queuedWaitSeconds =
    matchmaking.status === "QUEUED" ? matchmakingWaitSeconds(matchmaking, matchmakingNow) : 0;

  return (
    <View className="mp-home">
      <Image className="mp-home__bg" src={tableBackground} mode="aspectFill" />
      <View className="mp-home__overlay" />
      <View className="mp-account">
        <View
          className="mp-account__identity"
          hoverClass="is-pressed"
          onClick={() => setProfileOpen(true)}
        >
          <View className="mp-account__avatar">
            {identity.avatarUrl !== null ? (
              <Image
                src={`${API_BASE}${identity.avatarUrl}`}
                mode="aspectFill"
                className="mp-account__avatar-image"
              />
            ) : (
              <Text className="mp-account__avatar-fallback">{identity.nickname.slice(0, 1)}</Text>
            )}
          </View>
          <View className="mp-account__text">
            <Text className="mp-account__nickname">{identity.nickname}</Text>
          </View>
          {competitiveProfile !== null ? (
            <RankBadge rank={competitiveProfile.rankDisplay} size="compact" />
          ) : null}
        </View>
        <Button
          hoverClass="is-pressed"
          className="mp-account__logout"
          ariaLabel="退出登录"
          disabled={busy}
          onClick={logout}
        >
          退出
        </Button>
      </View>
      {mode === "HOME" ? (
        <View className="mp-home__stage">
          <HomeBrand />
          <View className="mp-home__menu">
            {matchmaking.status === "MATCHED" ? (
              <Button
                hoverClass="is-pressed"
                className="mp-btn mp-btn--primary"
                disabled={busy || matchmakingBusy}
                onClick={() => void returnToCompetitiveMatch()}
              >
                {matchmakingBusy ? "正在处理…" : "返回排位对局"}
              </Button>
            ) : (
              <>
                <Button
                  hoverClass="is-pressed"
                  className="mp-btn mp-btn--primary"
                  disabled={busy || matchmakingBusy || competitiveProfile === null}
                  onClick={() => void startMatchmaking()}
                >
                  {matchmakingBusy ? "正在处理…" : "单人排位"}
                </Button>
                <Button
                  hoverClass="is-pressed"
                  className="mp-btn mp-btn--rank-team"
                  disabled={busy || matchmakingBusy || competitiveProfile === null}
                  onClick={() => void startTeamRanked()}
                >
                  组队排位
                </Button>
              </>
            )}
            <Button
              hoverClass="is-pressed"
              className="mp-btn"
              disabled={busy || matchmakingBusy}
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
          {botsEnabled && matchmaking.status !== "MATCHED" ? (
            <View
              className={`mp-home__toggle${allowBots ? " is-on" : ""}`}
              onClick={() => toggleAllowBots()}
            >
              <View className="mp-home__toggle-box">{allowBots ? <Text>✓</Text> : null}</View>
              <Text className="mp-home__toggle-label">允许机器人（体验期秒开）</Text>
            </View>
          ) : null}
          {matchmakingError !== null ? (
            <Text className="mp-matchmaking__error">{matchmakingError}</Text>
          ) : null}
        </View>
      ) : (
        <View className="mp-home__panel">
          <Text className="mp-home__panel-title">{heading}</Text>
          <View className="mp-home__form">
            {mode === "JOIN" ? (
              <View className="mp-field">
                <Text className="mp-field__label">房间号</Text>
                <Input
                  className="mp-field__input"
                  value={roomCode}
                  maxlength={6}
                  type="number"
                  placeholder="4 位数字"
                  onInput={(event) => setRoomCode(event.detail.value)}
                />
              </View>
            ) : (
              <>
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
                <View className="mp-field">
                  <Text className="mp-field__label">出牌时长</Text>
                  <Picker
                    className="mp-field__picker"
                    mode="selector"
                    range={TURN_TIMEOUT_OPTIONS}
                    value={TURN_TIMEOUT_OPTIONS.indexOf(turnTimeoutSeconds)}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = TURN_TIMEOUT_OPTIONS[Number(event.detail.value)];
                      if (selected !== undefined) setTurnTimeoutSeconds(selected);
                    }}
                  >
                    <View className="mp-field__select">
                      <Text>{turnTimeoutSeconds} 秒</Text>
                      <Text className="mp-field__select-arrow">⌄</Text>
                    </View>
                  </Picker>
                </View>
                <View className="mp-field">
                  <Text className="mp-field__label">机器人难度</Text>
                  <View className="mp-score-row">
                    {BOT_DIFFICULTY_OPTIONS.map((difficulty) => (
                      <Button
                        hoverClass="is-pressed"
                        key={difficulty}
                        className={`mp-score${botDifficulty === difficulty ? " is-on" : ""}`}
                        disabled={busy}
                        onClick={() => setBotDifficulty(difficulty)}
                      >
                        {difficulty === "LOW" ? "低 · 只硬胡" : "高 · 可软胡"}
                      </Button>
                    ))}
                  </View>
                </View>
              </>
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
      {matchmaking.status === "QUEUED" ? (
        <View className="mp-matchmaking">
          <View className="mp-matchmaking__panel">
            <Text className="mp-matchmaking__eyebrow">竞技匹配</Text>
            <Text className="mp-matchmaking__title">正在寻找其他玩家</Text>
            <View className="mp-matchmaking__status">
              <View>
                <Text className="mp-matchmaking__label">当前段位</Text>
                {competitiveProfile !== null ? (
                  <RankBadge rank={competitiveProfile.rankDisplay} size="compact" />
                ) : (
                  <Text className="mp-matchmaking__value">黑铁Ⅴ</Text>
                )}
              </View>
              <View>
                <Text className="mp-matchmaking__label">等待时间</Text>
                <Text className="mp-matchmaking__value">{queuedWaitSeconds} 秒</Text>
              </View>
              <View>
                <Text className="mp-matchmaking__label">搜索范围</Text>
                <Text className="mp-matchmaking__value">
                  {matchmakingRangeLabel(queuedWaitSeconds)}
                </Text>
              </View>
            </View>
            {matchmaking.disconnectedAt !== null ? (
              <Text className="mp-matchmaking__notice">连接暂时中断，正在保留排队位置</Text>
            ) : (
              <Text className="mp-matchmaking__notice">
                {allowBots && botsEnabled
                  ? "正在等待其他玩家，5 秒后用机器人补位开局"
                  : "仅匹配四名真人玩家"}
              </Text>
            )}
            {matchmakingError !== null ? (
              <Text className="mp-matchmaking__error">{matchmakingError}</Text>
            ) : null}
            <Button
              className="mp-btn mp-matchmaking__cancel"
              hoverClass="is-pressed"
              disabled={matchmakingBusy}
              onClick={() => void cancelMatchmaking()}
            >
              {matchmakingBusy ? "正在取消…" : "取消匹配"}
            </Button>
          </View>
        </View>
      ) : null}
      <Text className="mp-about-entry" onClick={() => setAboutOpen(true)}>
        关于
      </Text>
      {aboutOpen ? (
        <AboutModal
          backend={backendVersion}
          backendError={backendVersionError}
          onClose={() => setAboutOpen(false)}
        />
      ) : null}
      {profileOpen ? (
        <PlayerProfileModal
          nickname={identity.nickname}
          avatarUrl={identity.avatarUrl}
          score={0}
          connected
          isSelf
          competitiveProfile={competitiveProfile}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </View>
  );
}
