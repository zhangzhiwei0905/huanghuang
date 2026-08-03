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
  roomApi,
  versionApi,
  type MatchmakingResponse,
  type VersionInfo,
} from "../../api/http";
import { API_BASE, APP_BUILT_AT, APP_VERSION } from "../../config";
import { PlayerProfileModal } from "../../components/PlayerProfileModal";
import { MatchHistoryModal } from "../../components/MatchHistoryModal";
import { NicknameEditModal } from "../../components/NicknameEditModal";
import { FriendsPanel } from "../../components/FriendsPanel";
import { RankBadge } from "../../components/RankBadge";
import { useSocial } from "../../hooks/useSocial";
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
  shouldForceResetMatchRoomOpening,
  shouldOpenMatchmakingRoom,
  shouldPollMatchmakingStatus,
} from "../../lib/matchmakingRecovery";
import { matchmakingRangeLabel, matchmakingWaitSeconds } from "../../lib/matchmakingPresentation";
import {
  MATCH_FOUND_COUNTDOWN_SECONDS,
  remainingRoundStartSeconds,
} from "../../lib/roomTransitions";
import { RoundStartOverlay } from "../../components/RoundStartOverlay";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
// Taro resolves protocol types correctly but cannot bundle runtime exports
// through the protocol package's ESM `.js` re-export paths. Keep this tuple
// locally type-constrained; the server still validates the authoritative
// create-room schema.
const TURN_TIMEOUT_OPTIONS = [20, 25, 30] satisfies TurnTimeoutSeconds[];
const BOT_DIFFICULTY_OPTIONS = ["LOW", "HIGH"] satisfies BotDifficulty[];
const TRUSTEE_MATCH_STORAGE_KEY = "huanghuang_trustee_match";
// Guards against Taro.navigateTo's promise silently never settling (observed
// intermittently in WeChat): without this, matchedRoomOpeningRef would stay
// locked forever and every future poll/push would be refused by
// shouldOpenMatchmakingRoom, requiring a full app reload to recover.
const MATCH_ROOM_OPENING_TIMEOUT_MS = 8_000;
const MATCH_ROOM_OPENING_HEARTBEAT_MS = 2_000;

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
  const [competitiveProfileError, setCompetitiveProfileError] = useState<string | null>(null);
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({ status: "IDLE" });
  const [matchmakingNow, setMatchmakingNow] = useState(Date.now());
  const [pendingMatchNavigation, setPendingMatchNavigation] = useState<{
    navigationKey: string;
    room: RoomProjection;
    matchFoundAt: number;
  } | null>(null);
  const [matchmakingBusy, setMatchmakingBusy] = useState(false);
  const [matchmakingError, setMatchmakingError] = useState<string | null>(null);
  const pageVisibleRef = useRef(true);
  const matchedRoomOpeningRef = useRef(false);
  const matchedRoomOpeningSinceRef = useRef<number | null>(null);
  const openedMatchRoomKeyRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [backendVersion, setBackendVersion] = useState<VersionInfo | null>(null);
  const [backendVersionError, setBackendVersionError] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [matchHistoryOpen, setMatchHistoryOpen] = useState(false);
  const [nicknameEditOpen, setNicknameEditOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const social = useSocial(identityState === "loggedIn" && identity !== null, (reason) => {
    // The server pushes this the instant matchmaking.tick() finds a match, so
    // acting on it immediately shortcuts the up-to-1s HTTP poll interval below
    // (which still runs unconditionally as a fallback if this push is missed).
    if (reason !== "MATCHMAKING") return;
    void refreshMatchmakingStatus().catch((cause) =>
      setMatchmakingError(describeSubmitError(cause)),
    );
  });

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
    // Claim this result immediately so later polls/pushes for the same match
    // don't re-trigger the countdown or open a second room.
    openedMatchRoomKeyRef.current = navigationKey;
    if (response.state.status === "MATCHED") {
      // A freshly found ranked match gets a brief "匹配成功" transition
      // before navigating, mirroring the friend-room ready countdown
      // (RoundStartOverlay) instead of jumping straight into the game.
      setPendingMatchNavigation({ navigationKey, room: response.room, matchFoundAt: Date.now() });
      return;
    }
    // A queued team-match party room (navigationKey starts with "party:")
    // opens immediately — it's the party's own waiting room, not an
    // announcement that a match was just found.
    openMatchedRoom(navigationKey, response.room);
  }

  function openMatchedRoom(navigationKey: string, room: RoomProjection): void {
    matchedRoomOpeningRef.current = true;
    matchedRoomOpeningSinceRef.current = Date.now();
    Taro.setStorageSync("huanghuang_open_room", room);
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
        matchedRoomOpeningSinceRef.current = null;
      });
  }

  // Shared by the polling loop below, the "MATCHMAKING" push handler, and the
  // opening-lock heartbeat, so there is exactly one place that fetches status
  // and applies it — avoids parallel/duplicate navigation logic.
  async function refreshMatchmakingStatus(): Promise<MatchmakingResponse> {
    const response = await competitiveApi.status();
    setMatchmakingError(null);
    applyMatchmakingResponse(response);
    return response;
  }

  useEffect(() => {
    if (identity === null) return;
    let disposed = false;
    Promise.all([competitiveApi.profile(), competitiveApi.status()])
      .then(([profile, response]) => {
        if (disposed) return;
        setCompetitiveProfile(profile);
        setCompetitiveProfileError(null);
        applyMatchmakingResponse(response);
      })
      .catch((cause) => {
        if (disposed) return;
        setMatchmakingError(describeSubmitError(cause));
        setCompetitiveProfileError(describeSubmitError(cause));
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
        const response = await refreshMatchmakingStatus();
        if (disposed) return;
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

  useEffect(() => {
    // Independent of the poll/push chains above by design: a fixed-cadence
    // heartbeat that only ever checks a timestamp, so it keeps working even
    // if both of the other discovery paths have silently stopped. Recovers
    // from Taro.navigateTo's promise never settling (observed intermittently
    // in WeChat), which otherwise locks matchedRoomOpeningRef forever and
    // blocks every future match from opening — previously only a full app
    // reload could clear it.
    if (matchmaking.status === "IDLE") return;
    const interval = setInterval(() => {
      if (
        !shouldForceResetMatchRoomOpening(
          matchedRoomOpeningSinceRef.current,
          Date.now(),
          MATCH_ROOM_OPENING_TIMEOUT_MS,
        )
      ) {
        return;
      }
      matchedRoomOpeningRef.current = false;
      matchedRoomOpeningSinceRef.current = null;
      openedMatchRoomKeyRef.current = null;
      void refreshMatchmakingStatus().catch((cause) =>
        setMatchmakingError(describeSubmitError(cause)),
      );
    }, MATCH_ROOM_OPENING_HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [matchmaking.status]);

  useEffect(() => {
    // Drives the "匹配成功" countdown display. Uses a real timestamp
    // (matchFoundAt) rather than a decrementing counter so a backgrounded
    // app that resumes mid-countdown recomputes the true elapsed time
    // instead of restarting from 3 or getting stuck.
    if (pendingMatchNavigation === null) return;
    const interval = setInterval(() => setMatchmakingNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [pendingMatchNavigation]);

  useEffect(() => {
    if (pendingMatchNavigation === null) return;
    const remaining = remainingRoundStartSeconds(
      pendingMatchNavigation.matchFoundAt,
      matchmakingNow,
      MATCH_FOUND_COUNTDOWN_SECONDS,
    );
    if (remaining > 0) return;
    const { navigationKey, room } = pendingMatchNavigation;
    setPendingMatchNavigation(null);
    openMatchedRoom(navigationKey, room);
  }, [pendingMatchNavigation, matchmakingNow]);

  // Navigating back from the room page (empty-shell reLaunch, or the OS
  // resuming this page from the background) doesn't remount the component —
  // re-fetch matchmaking status so a stale MATCHED/QUEUED snapshot from
  // before the round ended gets corrected without waiting for the next poll.
  useDidShow(() => {
    pageVisibleRef.current = true;
    if (pendingMatchNavigation !== null) {
      // A "匹配成功" countdown is in progress. Its own tick effect uses a
      // wall-clock timestamp so it stays correct even if the interval was
      // suspended while backgrounded — but recompute here too so returning
      // from a long background stay opens the room immediately instead of
      // waiting for the next 250ms tick, and skip the reset-and-refetch
      // below (it would otherwise clear openedMatchRoomKeyRef and restart
      // this same countdown from 3 on every resume).
      const remaining = remainingRoundStartSeconds(
        pendingMatchNavigation.matchFoundAt,
        Date.now(),
        MATCH_FOUND_COUNTDOWN_SECONDS,
      );
      if (remaining <= 0) {
        const { navigationKey, room } = pendingMatchNavigation;
        setPendingMatchNavigation(null);
        openMatchedRoom(navigationKey, room);
      }
      return;
    }
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
  const matchFoundCountdown =
    pendingMatchNavigation === null
      ? 0
      : remainingRoundStartSeconds(
          pendingMatchNavigation.matchFoundAt,
          matchmakingNow,
          MATCH_FOUND_COUNTDOWN_SECONDS,
        );
  const pendingSocialCount =
    (social.snapshot?.friendRequests.filter((request) => request.direction === "INCOMING").length ??
      0) + (social.snapshot?.roomInvites.length ?? 0);
  const latestRoomInvite = social.snapshot?.roomInvites[0] ?? null;

  async function acceptRoomInvite(inviteId: string) {
    const invitedRoom = await social.acceptInvite(inviteId);
    if (invitedRoom === null) return;
    Taro.setStorageSync("huanghuang_open_room", invitedRoom);
    await Taro.navigateTo({ url: "/pages/room/index" });
  }

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
            <Text
              className="mp-account__player-id"
              onClick={(event) => {
                event.stopPropagation();
                void Taro.setClipboardData({ data: identity.playerId });
              }}
            >
              ID {identity.playerId}
            </Text>
          </View>
          {competitiveProfile !== null ? (
            <RankBadge rank={competitiveProfile.rankDisplay} size="compact" />
          ) : null}
        </View>
        <Button
          hoverClass="is-pressed"
          className="mp-account__friends"
          ariaLabel="好友"
          onClick={() => setFriendsOpen(true)}
        >
          好友
          {pendingSocialCount > 0 ? (
            <Text className="mp-account__friends-badge">{pendingSocialCount}</Text>
          ) : null}
        </Button>
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
            <Button
              hoverClass="is-pressed"
              className="mp-home-rank"
              disabled={
                busy ||
                matchmakingBusy ||
                (matchmaking.status !== "MATCHED" && competitiveProfile === null)
              }
              onClick={() =>
                void (matchmaking.status === "MATCHED"
                  ? returnToCompetitiveMatch()
                  : startTeamRanked())
              }
            >
              <View className="mp-home-rank__tile">
                <Text>{matchmaking.status === "MATCHED" ? "归" : "排"}</Text>
              </View>
              <View className="mp-home-rank__copy">
                <Text className="mp-home-rank__eyebrow">
                  {matchmaking.status === "MATCHED" ? "牌局进行中" : "竞技牌桌"}
                </Text>
                <Text className="mp-home-rank__title">
                  {matchmakingBusy
                    ? matchmaking.status === "MATCHED"
                      ? "正在返回…"
                      : "正在开桌…"
                    : matchmaking.status === "MATCHED"
                      ? "返回排位对局"
                      : "排位赛"}
                </Text>
                <Text className="mp-home-rank__hint">
                  {matchmaking.status === "MATCHED"
                    ? "继续未完成的竞技牌局"
                    : "单人可开局，也可邀请好友组队"}
                </Text>
              </View>
              <Text className="mp-home-rank__enter">入场</Text>
            </Button>
            <View className="mp-home__secondary-menu">
              <Button
                hoverClass="is-pressed"
                className="mp-home-mode mp-home-mode--friend"
                disabled={busy}
                onClick={() => setMode("CREATE")}
              >
                <Text className="mp-home-mode__eyebrow">私人牌桌</Text>
                <Text className="mp-home-mode__title">好友房</Text>
                <Text className="mp-home-mode__hint">创建房间，等牌友入座</Text>
              </Button>
              <View className="mp-home__secondary-stack">
                <Button
                  hoverClass="is-pressed"
                  className="mp-home-mode mp-home-mode--bot"
                  disabled={busy || matchmakingBusy}
                  onClick={() => setMode("BOT")}
                >
                  <Text className="mp-home-mode__title">人机练习</Text>
                  <Text className="mp-home-mode__hint">随时开一桌</Text>
                </Button>
                <Button
                  hoverClass="is-pressed"
                  className="mp-home-mode mp-home-mode--join"
                  disabled={busy}
                  onClick={() => setMode("JOIN")}
                >
                  <Text className="mp-home-mode__title">输入房号</Text>
                  <Text className="mp-home-mode__hint">加入好友牌桌</Text>
                </Button>
              </View>
            </View>
          </View>
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
                {/* Bot difficulty only applies to 人机 (BOT) games; friend
                    rooms carry no bots at all. */}
                {mode === "BOT" ? (
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
                ) : null}
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
              <Text className="mp-matchmaking__notice">正在匹配符合当前段位范围的玩家</Text>
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
          playerId={identity.playerId}
          score={0}
          connected
          isSelf
          competitiveProfile={competitiveProfile}
          competitiveProfileError={competitiveProfileError}
          onViewMatchHistory={() => setMatchHistoryOpen(true)}
          onEditNickname={() => setNicknameEditOpen(true)}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
      {matchHistoryOpen ? <MatchHistoryModal onClose={() => setMatchHistoryOpen(false)} /> : null}
      {nicknameEditOpen ? (
        <NicknameEditModal
          currentNickname={identity.nickname}
          onDone={(updated) => {
            setIdentity(updated);
            setNicknameEditOpen(false);
          }}
          onClose={() => setNicknameEditOpen(false)}
        />
      ) : null}
      {latestRoomInvite !== null && !friendsOpen ? (
        <View className="mp-room-invite">
          <View>
            <Text className="mp-room-invite__eyebrow">排位房邀请</Text>
            <Text className="mp-room-invite__copy">
              {latestRoomInvite.inviter.nickname} 邀请你加入 {latestRoomInvite.roomCode}
            </Text>
          </View>
          <Button
            className="mp-room-invite__button"
            disabled={social.busy}
            onClick={() => void acceptRoomInvite(latestRoomInvite.id)}
          >
            加入
          </Button>
          <Button
            className="mp-room-invite__button is-quiet"
            disabled={social.busy}
            onClick={() => void social.declineInvite(latestRoomInvite.id)}
          >
            忽略
          </Button>
        </View>
      ) : null}
      {friendsOpen ? <FriendsPanel social={social} onClose={() => setFriendsOpen(false)} /> : null}
      {pendingMatchNavigation !== null ? (
        <RoundStartOverlay eyebrow="匹配成功" title="即将开局" countdown={matchFoundCountdown} />
      ) : null}
    </View>
  );
}
