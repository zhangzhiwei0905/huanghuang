import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useShareAppMessage } from "@tarojs/taro";
import type {
  BaseScore,
  ChatMessageProjection,
  LobbySeatProjection,
  MeldKind,
  PublicCompetitiveProfile,
  RoomProjection,
  RoomStage,
  Seat,
  Tile,
} from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import {
  competitiveApi,
  getStoredMatchmakingAllowBots,
  setStoredMatchmakingAllowBots,
} from "../../api/http";
import { API_BASE } from "../../config";
import { ActionDock } from "../../components/ActionDock";
import { PlayerProfileModal } from "../../components/PlayerProfileModal";
import { FriendsPanel } from "../../components/FriendsPanel";
import { MahjongTile } from "../../components/MahjongTile";
import { MahjongEffectOverlay } from "../../components/MahjongEffectOverlay";
import { RankBadge } from "../../components/RankBadge";
import { RoundSettlementModal } from "../../components/RoundSettlementModal";
import { RoundStartOverlay } from "../../components/RoundStartOverlay";
import { TingHintCard } from "../../components/TingHintCard";
import { useRoom, type ConnectionStatus } from "../../hooks/useRoom";
import { useSocial } from "../../hooks/useSocial";
import {
  hasValidTileSelection,
  primaryActionButtons,
  type ActionButtonModel,
} from "../../lib/actionButtons";
import {
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
  handHighlightGroups,
} from "../../lib/actionEligibility";
import { decideTilePress } from "../../lib/handInteraction";
import {
  shouldAcknowledgeMatchBeforeLeaving,
  shouldConfirmTrusteeHandoffBeforeLeaving,
} from "../../lib/roomLeaveFlow";
import {
  createGameAudioTracker,
  updateGameAudioTracker,
  voiceMessageAudioFileName,
  VOICE_MESSAGES,
  type GameAudioTracker,
} from "../../lib/gameAudioEvents";
import {
  getStoredGameAudioEnabled,
  setStoredGameAudioEnabled,
} from "../../lib/gameAudioPreference";
import { createGameAudioPlayer, type GameAudioPlayer } from "../../lib/gameAudioPlayer";
import { ROUND_START_COUNTDOWN_SECONDS, shouldShowRoundStart } from "../../lib/roomTransitions";
import { isWildcardTile } from "../../lib/tileArt";
import { sortHand } from "../../lib/tiles";
import { indexTingHints, tingCardAnchor } from "../../lib/tingHints";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
const SEATS: readonly Seat[] = [0, 1, 2, 3];
const POSITION_CLASS = ["pos-self", "pos-right", "pos-opposite", "pos-left"] as const;
const VISIBLE_DISCARDS = 12;
/* The self pile sits in the narrow strip between table-center and the action
   dock — only a single wide row fits there, so it shows fewer tiles (players
   know their own discards; the count chip carries the total). */
const SELF_VISIBLE_DISCARDS = 6;
const TRUSTEE_MATCH_STORAGE_KEY = "huanghuang_trustee_match";

const MELD_LABELS: Record<MeldKind, string> = {
  PONG: "碰",
  EXPOSED_KONG: "明杠",
  CONCEALED_KONG: "暗杠",
  ADDED_KONG: "补杠",
  INDICATOR_PONG_KONG: "亮杠",
};

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
};

/** Unified player snapshot feeding PlayerProfileModal from either a lobby or in-round seat. */
type ProfileTarget = {
  playerId: string | null;
  nickname: string;
  avatarUrl: string | null;
  score: number;
  controller: "HUMAN" | "BOT" | "TRUSTEE" | null;
  connected: boolean;
  isSelf: boolean;
  isOwner: boolean;
  competitiveProfile: PublicCompetitiveProfile | null;
};

function SeatAvatar({
  avatarUrl,
  nickname,
  isBot = false,
  variant,
  onClick,
}: {
  avatarUrl: string | null;
  nickname: string | null;
  isBot?: boolean;
  variant: "lobby" | "player";
  onClick?: () => void;
}) {
  const fallback = isBot ? "机" : (nickname?.slice(0, 1) ?? "");
  return (
    <View
      className={`seat-avatar seat-avatar--${variant}${onClick === undefined ? "" : " is-clickable"}`}
      onClick={onClick}
    >
      {avatarUrl !== null ? (
        <Image src={`${API_BASE}${avatarUrl}`} mode="aspectFill" className="seat-avatar__image" />
      ) : (
        <Text className="seat-avatar__fallback">{fallback}</Text>
      )}
    </View>
  );
}

function relativePosition(seat: Seat, selfSeat: Seat): number {
  return ((seat - selfSeat + 4) % 4) as 0 | 1 | 2 | 3;
}

function LobbySeat({
  seat,
  positionClass,
  busy,
  onToggleReady,
  canManageBots,
  showReadyAction,
  onRemoveBot,
  onShowProfile,
  onInviteEmpty,
}: {
  seat: LobbySeatProjection;
  positionClass: (typeof POSITION_CLASS)[number];
  busy: boolean;
  onToggleReady: () => void;
  canManageBots: boolean;
  showReadyAction: boolean;
  onRemoveBot: () => void;
  onShowProfile: () => void;
  onInviteEmpty?: () => void;
}) {
  const displayName = seat.occupied ? (seat.nickname ?? "玩家") : "等待加入";
  const status = !seat.occupied
    ? "空位"
    : seat.controller === "BOT"
      ? "机器人 · 自动准备"
      : !seat.connected
        ? "离线"
        : seat.ready
          ? "已准备"
          : "未准备";

  return (
    <View
      className={`lobby-seat ${positionClass}${seat.isSelf ? " is-self" : ""}${
        seat.ready ? " is-ready" : ""
      }${seat.occupied ? "" : " is-empty"}${seat.connected || !seat.occupied ? "" : " is-offline"}`}
    >
      <View className="lobby-seat__identity">
        <SeatAvatar
          avatarUrl={seat.avatarUrl}
          nickname={seat.occupied ? seat.nickname : "空"}
          isBot={seat.controller === "BOT"}
          variant="lobby"
          onClick={seat.occupied ? onShowProfile : onInviteEmpty}
        />
        <View className="lobby-seat__copy">
          <View className="lobby-seat__name-row">
            <Text
              className={`lobby-seat__name${seat.occupied ? " is-clickable" : ""}`}
              onClick={seat.occupied ? onShowProfile : undefined}
            >
              {displayName}
            </Text>
            {seat.isOwner ? <Text className="lobby-seat__owner">房主</Text> : null}
            {seat.isSelf ? <Text className="lobby-seat__self-tag">我</Text> : null}
          </View>
          <Text className="lobby-seat__meta">
            {seat.occupied ? (
              <>
                <Text>牌桌分 {seat.score}</Text>
                <Text
                  className={`lobby-seat__inline-state${seat.ready ? " is-ready" : ""}${
                    seat.connected ? "" : " is-offline"
                  }`}
                >
                  {" "}
                  · {status}
                </Text>
              </>
            ) : (
              "邀请好友加入"
            )}
          </Text>
        </View>
        {seat.competitiveProfile !== null ? (
          <RankBadge
            rank={seat.competitiveProfile.rankDisplay}
            size="compact"
            className="seat-rank-badge"
          />
        ) : null}
      </View>
      {seat.isSelf && showReadyAction ? (
        <View className="lobby-seat__state-row">
          <Button
            className={`lobby-ready-button${seat.ready ? " is-cancel" : ""}`}
            hoverClass="is-pressed"
            disabled={busy}
            onClick={onToggleReady}
          >
            {busy ? "处理中" : seat.ready ? "取消准备" : "准备"}
          </Button>
        </View>
      ) : null}
      {canManageBots && seat.controller === "BOT" ? (
        <View className="lobby-seat__state-row">
          <Button
            className="lobby-bot-remove-button"
            hoverClass="is-pressed"
            disabled={busy}
            onClick={onRemoveBot}
          >
            移除
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function selfPlayer(room: RoomProjection) {
  if (room.selfSeat === null) return null;
  return room.players[room.selfSeat] ?? null;
}

/* The projection has no "who just discarded" field — diff each seat's discard
   pile across updates (same approach as the web client) so the single most
   recent discard on the table can be highlighted for pong/kong decisions.
   Pile *length* is tracked alongside the tail id: a tail change only marks a
   new "recent" tile when the pile grew (a fresh discard). A pong/kong claim
   shrinks the pile instead — the older tile that becomes the new tail must
   not light up, and a highlight pointing at the claimed (now removed) tile
   is cleared rather than left dangling. */
function useRecentDiscardId(room: RoomProjection | null): string | null {
  const pilesRef = useRef<Map<Seat, { length: number; tailId: string | null }>>(new Map());
  const recentRef = useRef<string | null>(null);
  if (room === null) {
    if (pilesRef.current.size > 0) {
      pilesRef.current = new Map();
      recentRef.current = null;
    }
    return null;
  }
  let pileShrank = false;
  for (const player of room.players) {
    const previous = pilesRef.current.get(player.seat) ?? { length: 0, tailId: null };
    const length = player.discards.length;
    const tailId = player.discards.at(-1)?.id ?? null;
    if (length > previous.length && tailId !== null) {
      recentRef.current = tailId;
    } else if (length < previous.length) {
      pileShrank = true;
    }
    if (length !== previous.length || tailId !== previous.tailId) {
      pilesRef.current.set(player.seat, { length, tailId });
    }
  }
  if (pileShrank && recentRef.current !== null) {
    const recentId = recentRef.current;
    const stillOnTable = room.players.some((player) =>
      player.discards.some((tile) => tile.id === recentId),
    );
    if (!stillOnTable) recentRef.current = null;
  }
  return recentRef.current;
}

function useGameAudio(
  room: RoomProjection | null,
  connectionStatus: ConnectionStatus,
  enabled: boolean,
  chatMessage: ChatMessageProjection | null,
): void {
  const trackerRef = useRef<GameAudioTracker | null>(null);
  const playerRef = useRef<GameAudioPlayer | null>(null);
  const lastPlayedChatIdRef = useRef<string | null>(null);
  if (trackerRef.current === null) trackerRef.current = createGameAudioTracker();

  useEffect(() => {
    const tracker = trackerRef.current;
    if (tracker === null) return;
    const files = updateGameAudioTracker(tracker, room, connectionStatus === "connected");
    if (!enabled) {
      playerRef.current?.destroy();
      playerRef.current = null;
      return;
    }
    if (room !== null && connectionStatus === "connected") {
      if (playerRef.current === null) playerRef.current = createGameAudioPlayer();
      playerRef.current.warmup();
    }
    if (files.length === 0) return;
    if (playerRef.current === null) playerRef.current = createGameAudioPlayer();
    for (const fileName of files) playerRef.current.play(fileName);
  }, [connectionStatus, enabled, room]);

  useEffect(() => {
    if (chatMessage === null) return;
    if (lastPlayedChatIdRef.current === chatMessage.id) return;
    lastPlayedChatIdRef.current = chatMessage.id;
    if (!enabled) return;
    const fileName = voiceMessageAudioFileName(chatMessage.message);
    if (fileName === null) return;
    if (playerRef.current === null) playerRef.current = createGameAudioPlayer();
    playerRef.current.play(fileName);
  }, [chatMessage, enabled]);

  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    [],
  );
}

function deadlineSeconds(deadline: string | null): number | null {
  return deadline === null
    ? null
    : Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));
}

// room.roundPhase is a raw backend enum ("TURN_DECISION" / "DISCARD_RESPONSE" / ...),
// not display copy — rendering it directly overflowed the table-center block and
// pushed it into the discard rings above/below it.
function phaseLabel(room: RoomProjection): string {
  if (room.stage === "ROUND_RESULT") return "本局结束";
  if (room.roundPhase === "DISCARD_RESPONSE") return "等待响应";
  if (room.roundPhase === "TURN_DECISION") return "回合进行中";
  if (room.roundPhase === "ROUND_OVER") return "本局结束";
  return "等待中";
}

export default function RoomPage() {
  const roomCtrl = useRoom();
  const social = useSocial(true);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState("复制房号");
  const [gameAudioEnabled, setGameAudioEnabled] = useState(getStoredGameAudioEnabled);
  const [quickMessageOpen, setQuickMessageOpen] = useState(false);
  const [roundStartCountdown, setRoundStartCountdown] = useState<number | null>(null);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [allowBots, setAllowBots] = useState(getStoredMatchmakingAllowBots);
  const previousStageRef = useRef<RoomStage | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);
  const room = roomCtrl.room;

  useDidShow(() => {
    const channel = Taro.getStorageSync("huanghuang_open_room");
    if (channel !== "" && channel !== null && typeof channel === "object") {
      roomCtrl.openRoom(channel as RoomProjection);
      Taro.removeStorageSync("huanghuang_open_room");
    }
  });

  // Share target is the home page, not this page: RoomPage.useDidShow reads
  // room state from wx storage set by the create/join flow, so a cold-start
  // deep link straight into /pages/room/index has nothing to hydrate from.
  useShareAppMessage(() => ({
    title:
      room?.mode === "FRIEND" || room?.mode === "TEAM_MATCH"
        ? `晃晃麻将 · 房间 ${room.roomCode}`
        : "晃晃麻将 · 一起来打牌",
    path:
      room?.mode === "FRIEND" || room?.mode === "TEAM_MATCH"
        ? `/pages/index/index?code=${room.roomCode}`
        : "/pages/index/index",
  }));

  const self = room === null ? null : selfPlayer(room);
  const selfSeat = room?.selfSeat ?? 0;
  const menuSafeRight = useMemo(() => {
    try {
      const menu = Taro.getMenuButtonBoundingClientRect();
      const windowWidth = Taro.getSystemInfoSync().windowWidth;
      return Math.max(0, windowWidth - menu.left + 8);
    } catch {
      return 0;
    }
  }, []);
  const shellStyle = {
    "--menu-safe-right": `${menuSafeRight}px`,
  } as CSSProperties;
  const drawnTileId = room?.selfDrawnTileId ?? null;
  // The freshly-drawn tile stays out of the sorted hand — and visually off to
  // the right in a dedicated slot — until the player acts on it (discards it,
  // melds it in, etc.), instead of jumping straight into its sorted position.
  const hand = useMemo(
    () => sortHand((self?.hand ?? []).filter((tile) => tile.id !== drawnTileId)),
    [self?.hand, drawnTileId],
  );
  const drawnTile = useMemo(
    () => self?.hand?.find((tile) => tile.id === drawnTileId) ?? null,
    [self?.hand, drawnTileId],
  );
  const selectedTile =
    hand.find((tile) => tile.id === selectedTileId) ??
    (drawnTile?.id === selectedTileId ? drawnTile : null);
  const handHighlight = useMemo(
    () =>
      room === null || self === null
        ? { pongTileIds: new Set<string>(), kongTileIds: new Set<string>() }
        : handHighlightGroups(room, self),
    [room, self],
  );
  const buttons = primaryActionButtons(room?.legalActions ?? []);
  const canDiscard = room?.legalActions.includes("DISCARD_TILE") === true;
  const tingHints = useMemo(() => indexTingHints(room?.tingHints ?? []), [room?.tingHints]);
  const selectedTingWaits =
    selectedTileId === null ? null : (tingHints.get(selectedTileId) ?? null);
  const orderedHandTileIds = useMemo(
    () => [...hand.map((tile) => tile.id), ...(drawnTile === null ? [] : [drawnTile.id])],
    [hand, drawnTile],
  );
  const selectedTingAnchor = useMemo(
    () => tingCardAnchor(orderedHandTileIds, selectedTileId),
    [orderedHandTileIds, selectedTileId],
  );
  const lobbyOccupiedCount = room?.lobbySeats.filter((candidate) => candidate.occupied).length ?? 0;
  const lobbyReadyCount = room?.lobbySeats.filter((candidate) => candidate.ready).length ?? 0;
  const teamQueued = room?.mode === "TEAM_MATCH" && room.teamMatchmaking?.status === "QUEUED";
  const teamMatched = room?.mode === "TEAM_MATCH" && room.teamMatchmaking?.status === "MATCHED";
  const teamMatchActive = teamQueued || teamMatched;
  const teamCanStart =
    room?.mode === "TEAM_MATCH" &&
    lobbyOccupiedCount >= 1 &&
    room.lobbySeats
      .filter((candidate) => candidate.occupied && !candidate.isOwner)
      .every((candidate) => candidate.ready);
  const [teamMatchNow, setTeamMatchNow] = useState(Date.now());
  const teamWaitSeconds =
    room?.teamMatchmaking?.status === "QUEUED"
      ? Math.max(
          0,
          Math.floor((teamMatchNow - Date.parse(room.teamMatchmaking.enqueuedAt)) / 1_000),
        )
      : 0;
  const recentDiscardId = useRecentDiscardId(room);
  useGameAudio(room, roomCtrl.connectionStatus, gameAudioEnabled, roomCtrl.lastChatMessage);
  const quickMessageAvailable = room !== null && room.mode === "FRIEND" && room.stage === "PLAYING";
  useEffect(() => {
    if (!quickMessageAvailable) setQuickMessageOpen(false);
  }, [quickMessageAvailable]);
  const locked =
    roomCtrl.busy || roomCtrl.connectionStatus !== "connected" || room?.effectCue !== null;
  const actionDeadlineAt = room?.actionDeadlineAt ?? null;
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(() =>
    deadlineSeconds(actionDeadlineAt),
  );

  useEffect(() => {
    setSecondsRemaining(deadlineSeconds(actionDeadlineAt));
    if (actionDeadlineAt === null) return;
    const timer = setInterval(() => setSecondsRemaining(deadlineSeconds(actionDeadlineAt)), 500);
    return () => clearInterval(timer);
  }, [actionDeadlineAt]);

  useEffect(() => {
    if (!teamMatchActive) return;
    const clock = setInterval(() => setTeamMatchNow(Date.now()), 1_000);
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await competitiveApi.status();
        if (!disposed && response.state.status === "MATCHED" && response.room !== null) {
          roomCtrl.openRoom(response.room);
        }
      } catch {
        // The room socket owns the visible connection state. Retry a transient
        // HTTP failure without replacing its more useful error banner.
      } finally {
        if (!disposed) pollTimer = setTimeout(() => void poll(), 1_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearInterval(clock);
      if (pollTimer !== null) clearTimeout(pollTimer);
    };
  }, [room?.roomId, roomCtrl.openRoom, teamMatchActive]);

  useEffect(() => {
    if (selectedTileId === null) return;
    const tileStillHeld = self?.hand?.some((tile) => tile.id === selectedTileId) === true;
    const canInteractWithHand =
      room?.stage === "PLAYING" &&
      room.roundPhase === "TURN_DECISION" &&
      room.actingSeat === room.selfSeat;
    if (!tileStillHeld || !canInteractWithHand) {
      setSelectedTileId(null);
    }
  }, [room?.actingSeat, room?.roundPhase, room?.selfSeat, room?.stage, selectedTileId, self?.hand]);

  useEffect(() => {
    if (room === null) {
      previousRoomIdRef.current = null;
      previousStageRef.current = null;
      setRoundStartCountdown(null);
      return;
    }

    if (previousRoomIdRef.current !== room.roomId) {
      previousRoomIdRef.current = room.roomId;
      previousStageRef.current = room.stage;
      setRoundStartCountdown(null);
      return;
    }

    if (shouldShowRoundStart(previousStageRef.current, room.stage)) {
      setRoundStartCountdown(ROUND_START_COUNTDOWN_SECONDS);
    }
    previousStageRef.current = room.stage;
  }, [room?.roomId, room?.stage]);

  useEffect(() => {
    if (roundStartCountdown === null) return;
    const timer = setTimeout(
      () =>
        setRoundStartCountdown((current) =>
          current === null || current <= 1 ? null : current - 1,
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [roundStartCountdown]);

  async function copyRoomCode() {
    if (room === null) return;
    try {
      await Taro.setClipboardData({ data: room.roomCode });
      setInviteStatus("已复制");
      setTimeout(() => setInviteStatus("复制房号"), 2000);
    } catch {
      setInviteStatus("复制失败");
    }
  }

  function toggleGameAudio() {
    setGameAudioEnabled((current) => {
      const next = !current;
      setStoredGameAudioEnabled(next);
      return next;
    });
  }

  function sendQuickMessage(text: string) {
    roomCtrl.sendVoiceMessage(text);
    setQuickMessageOpen(false);
  }

  async function onAction(button: ActionButtonModel) {
    if (room === null || self === null) return;
    const action = button.action;
    if (!hasValidTileSelection(action, selectedTile, room.wildcardKind)) {
      void Taro.showToast({ title: "请先选择合适的牌", icon: "none" });
      return;
    }
    if (action === "DISCARD_TILE" && selectedTile !== null) {
      await roomCtrl.send("DISCARD_TILE", { tileId: selectedTile.id });
      setSelectedTileId(null);
      return;
    }
    if (action === "RELEASE_WILDCARD" && selectedTile !== null) {
      await roomCtrl.send("RELEASE_WILDCARD", { tileId: selectedTile.id });
      setSelectedTileId(null);
      return;
    }
    if (action === "DECLARE_CONCEALED_KONG") {
      const payload = deriveConcealedKongPayload(room, self, selectedTile);
      if (payload === null) {
        void Taro.showToast({ title: "没有可暗杠的牌", icon: "none" });
        return;
      }
      await roomCtrl.send(action, payload);
      return;
    }
    if (action === "DECLARE_ADDED_KONG") {
      const payload = deriveAddedKongPayload(room, self, selectedTile);
      if (payload === null) {
        void Taro.showToast({ title: "没有可补杠的牌", icon: "none" });
        return;
      }
      await roomCtrl.send(action, payload);
      return;
    }
    await roomCtrl.send(action);
  }

  async function continueCompetitiveMatch(matchIdOverride?: string) {
    // Accepts an explicit matchId so the empty-shell page (room === null,
    // relying on roomCtrl.lastSettlement) can still drive this action once
    // `room.competitiveMatch` itself is gone.
    const matchId = matchIdOverride ?? room?.competitiveMatch?.matchId;
    if (matchId === undefined) return;
    try {
      Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
      const response = await competitiveApi.queue({
        previousMatchId: matchId,
        allowBots: getStoredMatchmakingAllowBots(),
      });
      roomCtrl.clearLastSettlement();
      if (response.room !== null) {
        Taro.setStorageSync("huanghuang_open_room", response.room);
        await Taro.reLaunch({ url: "/pages/room/index" });
      } else {
        await Taro.reLaunch({ url: "/pages/index/index" });
      }
    } catch {
      await Taro.showToast({ title: "继续匹配失败，请重试", icon: "none" });
    }
  }

  async function returnFromCompetitiveMatch(matchIdOverride?: string) {
    const matchId = matchIdOverride ?? room?.competitiveMatch?.matchId;
    if (matchId === undefined) return;
    try {
      Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
      await competitiveApi.acknowledge(matchId);
      roomCtrl.clearLastSettlement();
      await Taro.reLaunch({ url: "/pages/index/index" });
    } catch {
      await Taro.showToast({ title: "返回大厅失败，请重试", icon: "none" });
    }
  }

  async function leaveCurrentRoom() {
    if (room === null) return;
    if (shouldConfirmTrusteeHandoffBeforeLeaving(room.mode, room.stage)) {
      const result = await Taro.showModal({
        title: "退出竞技对局？",
        content: "退出后本局将由系统托管，仍会正常结算段位。",
        confirmText: "退出并托管",
        cancelText: "继续对局",
      });
      if (!result.confirm) return;
      const matchId = room.competitiveMatch?.matchId;
      if (matchId !== undefined) Taro.setStorageSync(TRUSTEE_MATCH_STORAGE_KEY, matchId);
    }
    if (shouldAcknowledgeMatchBeforeLeaving(room.mode, room.stage)) {
      const matchId = room.competitiveMatch?.matchId;
      if (matchId !== undefined) {
        try {
          Taro.removeStorageSync(TRUSTEE_MATCH_STORAGE_KEY);
          await competitiveApi.acknowledge(matchId);
        } catch {
          // Best-effort: proceed with the local leave regardless — the home
          // page's polling/useDidShow re-sync will reconcile a stale MATCHED
          // state instead of leaving the player stuck here.
        }
      }
    }
    await roomCtrl.leaveRoom();
    if (room.mode === "MATCH") {
      await Taro.reLaunch({ url: "/pages/index/index" });
    }
  }

  function onTilePress(tile: Tile) {
    if (room === null) return;
    const decision = decideTilePress({
      tile,
      selectedTileId,
      wildcardKind: room.wildcardKind,
      canDiscard,
      locked,
    });
    if (decision.kind === "select" || decision.kind === "keep-selection") {
      setSelectedTileId(decision.tileId);
    } else if (decision.kind === "discard") {
      void roomCtrl.send("DISCARD_TILE", { tileId: decision.tileId });
      setSelectedTileId(null);
    }
  }

  if (room === null) {
    // A single-entry page stack (reLaunch into this page is the normal path,
    // e.g. from the home page's MATCHED flow) makes navigateBack a no-op —
    // always land back on the home page explicitly instead.
    const pendingMatchId = roomCtrl.lastSettlement?.competitiveMatch.matchId;
    return (
      <View className="game-shell empty-shell">
        <Image className="game-shell__bg" src={tableBackground} mode="aspectFill" />
        <View className="game-shell__overlay" />
        <View className="game-shell__content empty-shell-content">
          <Text className="empty-title">{roomCtrl.notice ?? "尚未进入房间"}</Text>
          {pendingMatchId !== undefined ? (
            <>
              <Button
                className="btn-accent"
                hoverClass="is-pressed"
                onClick={() => void continueCompetitiveMatch(pendingMatchId)}
              >
                继续匹配
              </Button>
              <Button
                className="btn-accent"
                hoverClass="is-pressed"
                onClick={() => void returnFromCompetitiveMatch(pendingMatchId)}
              >
                回主页
              </Button>
            </>
          ) : (
            <Button
              className="btn-accent"
              hoverClass="is-pressed"
              onClick={() => void Taro.reLaunch({ url: "/pages/index/index" })}
            >
              返回大厅
            </Button>
          )}
        </View>
      </View>
    );
  }

  return (
    <View
      className={`game-shell${room.actingSeat === room.selfSeat ? " is-self-turn" : ""}`}
      style={shellStyle}
    >
      <Image className="game-shell__bg" src={tableBackground} mode="aspectFill" />
      <View className="game-shell__overlay" />
      <View className="game-shell__content">
        {room.stage === "WAITING" ? (
          <View className="lobby-toolbar">
            <Button
              className="lobby-toolbar__button"
              hoverClass="is-pressed"
              disabled={roomCtrl.busy}
              onClick={() => void leaveCurrentRoom()}
            >
              离开
            </Button>
            <View className="lobby-toolbar__room">
              <Text className="lobby-toolbar__label">
                {room.mode === "TEAM_MATCH" ? "组队排位" : "好友房"}
              </Text>
              <Text className="lobby-toolbar__code">{room.roomCode}</Text>
              {room.mode === "FRIEND" ? (
                <>
                  <Text className="lobby-toolbar__divider">·</Text>
                  <Text className="lobby-toolbar__meta">底分 {room.baseScore}</Text>
                  <Text className="lobby-toolbar__divider">·</Text>
                  <Text className="lobby-toolbar__meta">出牌 {room.turnTimeoutSeconds}秒</Text>
                  <Text className="lobby-toolbar__divider">·</Text>
                  <Text className="lobby-toolbar__meta">
                    机器人{room.botDifficulty === "LOW" ? "低难度" : "高难度"}
                  </Text>
                </>
              ) : (
                <>
                  <Text className="lobby-toolbar__divider">·</Text>
                  <Text className="lobby-toolbar__meta">固定竞技规则</Text>
                </>
              )}
              <Text
                className={`lobby-toolbar__connection${
                  roomCtrl.connectionStatus === "connected" ? " is-online" : ""
                }`}
              >
                {CONNECTION_LABELS[roomCtrl.connectionStatus]}
              </Text>
            </View>
            <View className="lobby-toolbar__actions">
              <Button
                className={`lobby-toolbar__button sound-toggle${
                  gameAudioEnabled ? "" : " is-muted"
                }`}
                hoverClass="is-pressed"
                aria-label={gameAudioEnabled ? "关闭音效" : "开启音效"}
                onClick={toggleGameAudio}
              >
                {gameAudioEnabled ? "音效开" : "音效关"}
              </Button>
              <Button
                className="lobby-toolbar__button"
                hoverClass="is-pressed"
                onClick={() => void copyRoomCode()}
              >
                {inviteStatus}
              </Button>
              {room.mode === "TEAM_MATCH" ? (
                <Button
                  className="lobby-toolbar__button lobby-toolbar__button--invite"
                  hoverClass="is-pressed"
                  disabled={teamMatchActive}
                  onClick={() => setFriendsOpen(true)}
                >
                  邀请好友
                </Button>
              ) : null}
              <Button
                className="lobby-toolbar__button lobby-toolbar__button--share"
                hoverClass="is-pressed"
                openType="share"
              >
                分享
              </Button>
              {room.isOwner ? (
                <Button
                  className="lobby-toolbar__button lobby-toolbar__button--danger"
                  hoverClass="is-pressed"
                  disabled={roomCtrl.busy}
                  onClick={() => void roomCtrl.dissolve()}
                >
                  解散
                </Button>
              ) : null}
            </View>
          </View>
        ) : (
          <>
            <Button
              className="leave-fab"
              hoverClass="is-pressed"
              disabled={roomCtrl.busy}
              onClick={() => void leaveCurrentRoom()}
            >
              离开
            </Button>
            <Button
              className={`sound-fab${gameAudioEnabled ? "" : " is-muted"}`}
              hoverClass="is-pressed"
              aria-label={gameAudioEnabled ? "关闭音效" : "开启音效"}
              onClick={toggleGameAudio}
            >
              {gameAudioEnabled ? "音效开" : "音效关"}
            </Button>
            <View className="info-capsule">
              <Text className="info-capsule__code">
                {room.mode === "BOT"
                  ? "人机对战"
                  : room.mode === "MATCH"
                    ? "竞技匹配"
                    : room.roomCode}
              </Text>
              <Text className="info-capsule__meta">底分{room.baseScore}</Text>
              <Text className="info-capsule__meta">出牌{room.turnTimeoutSeconds}秒</Text>
              {roomCtrl.connectionStatus !== "connected" ? (
                <Text className="info-capsule__meta info-capsule__meta--warn">
                  {CONNECTION_LABELS[roomCtrl.connectionStatus]}
                </Text>
              ) : null}
              {room.mode === "FRIEND" ? (
                <Button
                  className="info-capsule__btn"
                  hoverClass="is-pressed"
                  onClick={() => void copyRoomCode()}
                >
                  {inviteStatus}
                </Button>
              ) : null}
              {room.mode === "FRIEND" ? (
                <Button className="info-capsule__btn" hoverClass="is-pressed" openType="share">
                  分享
                </Button>
              ) : null}
              {room.mode === "FRIEND" && room.isOwner ? (
                <Button
                  className="info-capsule__btn info-capsule__btn--danger"
                  hoverClass="is-pressed"
                  disabled={roomCtrl.busy}
                  onClick={() => void roomCtrl.dissolve()}
                >
                  解散
                </Button>
              ) : null}
            </View>
          </>
        )}

        {roomCtrl.error !== null ? (
          <Text
            className={`banner-error${room.stage === "WAITING" ? "" : " banner-error--floating"}`}
          >
            {roomCtrl.error}
          </Text>
        ) : null}

        {room.stage === "WAITING" ? (
          <View className="lobby-stage">
            <View className="lobby-stage__felt-ring" />
            {room.mode === "TEAM_MATCH" && room.isOwner && !teamMatchActive ? (
              <View
                className={`lobby-match-config${allowBots ? " is-on" : ""}`}
                hoverClass="is-pressed"
                onClick={() => {
                  const next = !allowBots;
                  setAllowBots(next);
                  setStoredMatchmakingAllowBots(next);
                }}
              >
                <View className="lobby-match-config__check">
                  {allowBots ? <Text>✓</Text> : null}
                </View>
                <View className="lobby-match-config__copy">
                  <Text className="lobby-match-config__title">机器人补位</Text>
                  <Text className="lobby-match-config__hint">
                    {allowBots ? "人数不足时按段位补齐" : "关闭后只匹配真人"}
                  </Text>
                </View>
              </View>
            ) : null}
            {room.lobbySeats.map((seat) => {
              const pos = POSITION_CLASS[relativePosition(seat.seat, selfSeat)] ?? "pos-self";
              return (
                <LobbySeat
                  key={seat.seat}
                  seat={seat}
                  positionClass={pos}
                  busy={roomCtrl.busy || teamMatchActive}
                  onToggleReady={() => void roomCtrl.ready()}
                  canManageBots={room.isOwner}
                  showReadyAction={room.mode !== "TEAM_MATCH" || !seat.isOwner}
                  onRemoveBot={() => void roomCtrl.removeBot(seat.seat)}
                  onShowProfile={() => {
                    if (!seat.occupied) return;
                    setProfileTarget({
                      playerId: seat.playerId ?? null,
                      nickname: seat.nickname ?? "玩家",
                      avatarUrl: seat.avatarUrl,
                      score: seat.score,
                      controller: seat.controller,
                      connected: seat.connected,
                      isSelf: seat.isSelf,
                      isOwner: seat.isOwner,
                      competitiveProfile: seat.competitiveProfile,
                    });
                  }}
                  onInviteEmpty={
                    room.mode === "TEAM_MATCH" && !teamMatchActive
                      ? () => setFriendsOpen(true)
                      : undefined
                  }
                />
              );
            })}
            <View className="lobby-center">
              <Text className="lobby-center__eyebrow">等待开局</Text>
              <Text className="lobby-center__status">
                {room.mode === "TEAM_MATCH"
                  ? teamMatched
                    ? "匹配成功"
                    : teamQueued
                      ? `匹配中 · ${teamWaitSeconds} 秒`
                      : `${lobbyReadyCount}/${lobbyOccupiedCount} 已准备`
                  : lobbyOccupiedCount < 4
                    ? `还差 ${4 - lobbyOccupiedCount} 个座位`
                    : `${lobbyReadyCount}/4 已准备`}
              </Text>
              <Text className="lobby-center__hint">
                {room.mode === "TEAM_MATCH"
                  ? teamMatched
                    ? "正在进入竞技牌桌"
                    : teamQueued
                      ? "正在为整队寻找合适牌友，队伍不会被拆分"
                      : room.isOwner
                        ? lobbyOccupiedCount === 1
                          ? "可单人开始，也可邀请好友一起排位"
                          : "好友准备后，由你开始匹配"
                        : "准备后，等待房主开始匹配"
                  : lobbyOccupiedCount < 4
                    ? "邀请好友，或由房主添加机器人"
                    : "所有真人准备后自动开始"}
              </Text>
              {room.scoreResetPending ? (
                <Text className="lobby-center__score-reset">开局后积分将重新计算</Text>
              ) : null}
              {room.mode === "TEAM_MATCH" ? (
                <View className="lobby-team-actions">
                  {teamMatched ? (
                    <Button className="lobby-team-button" disabled>
                      正在进入对局
                    </Button>
                  ) : teamQueued ? (
                    <Button
                      className="lobby-team-button lobby-team-button--cancel"
                      hoverClass="is-pressed"
                      disabled={roomCtrl.busy}
                      onClick={() => void roomCtrl.cancelTeamMatchmaking()}
                    >
                      取消匹配
                    </Button>
                  ) : room.isOwner ? (
                    <Button
                      className="lobby-team-button"
                      hoverClass="is-pressed"
                      disabled={roomCtrl.busy || !teamCanStart}
                      onClick={() => void roomCtrl.startTeamMatchmaking(allowBots)}
                    >
                      {teamCanStart ? "开始匹配" : "等待好友准备"}
                    </Button>
                  ) : (
                    <Text className="lobby-team-waiting">等待房主开始匹配</Text>
                  )}
                </View>
              ) : room.isOwner ? (
                <View className="lobby-settings">
                  <View className="lobby-score-picker">
                    <Text className="lobby-score-picker__label">底分</Text>
                    {BASE_SCORES.map((score) => (
                      <Button
                        key={score}
                        className={`lobby-score-picker__button${
                          room.baseScore === score ? " is-active" : ""
                        }`}
                        hoverClass="is-pressed"
                        disabled={roomCtrl.busy || room.baseScore === score}
                        onClick={() => void roomCtrl.updateBaseScore(score)}
                      >
                        {score}
                      </Button>
                    ))}
                  </View>
                  <View className="lobby-score-picker">
                    <Text className="lobby-score-picker__label">难度</Text>
                    {(["LOW", "HIGH"] as const).map((difficulty) => (
                      <Button
                        key={difficulty}
                        className={`lobby-score-picker__button lobby-difficulty-button${
                          room.botDifficulty === difficulty ? " is-active" : ""
                        }`}
                        hoverClass="is-pressed"
                        disabled={roomCtrl.busy || room.botDifficulty === difficulty}
                        onClick={() => void roomCtrl.updateBotDifficulty(difficulty)}
                      >
                        {difficulty === "LOW" ? "低" : "高"}
                      </Button>
                    ))}
                    {room.lobbySeats.some((seat) => !seat.occupied) ? (
                      <Button
                        className="lobby-score-picker__button lobby-add-bot-button"
                        hoverClass="is-pressed"
                        disabled={roomCtrl.busy}
                        onClick={() => void roomCtrl.addBot()}
                      >
                        +机器人
                      </Button>
                    ) : null}
                  </View>
                </View>
              ) : (
                <Text className="lobby-center__base-score">本房底分 {room.baseScore}</Text>
              )}
            </View>
            <View className="lobby-invite-tip">
              <Text>房号 {room.roomCode}</Text>
              <Text className="lobby-invite-tip__dot">·</Text>
              <Text>
                {room.mode === "TEAM_MATCH"
                  ? "从好友列表发出游戏内邀请，或输入房号加入"
                  : "好友在首页输入房号即可加入"}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View className="table-surface">
              {SEATS.map((seat) => {
                const player = room.players[seat];
                if (player === undefined) return null;
                const pos = POSITION_CLASS[relativePosition(seat, selfSeat)] ?? "pos-self";
                const active = room.actingSeat === seat;
                const latestReleasedWildcard = player.releasedWildcards.at(-1) ?? null;
                const hasPublicTiles = player.melds.length > 0 || latestReleasedWildcard !== null;
                const publicGroupCount =
                  player.melds.length + (latestReleasedWildcard === null ? 0 : 1);
                const publicRailDensity = publicGroupCount <= 2 ? "is-sparse" : "is-dense";
                return (
                  <Fragment key={seat}>
                    <View
                      id={`player-station-${seat}`}
                      className={`player-station ${pos}${active ? " is-active" : ""}${
                        seat === room.selfSeat ? " is-self" : ""
                      }`}
                    >
                      <View className="player-station__identity">
                        <SeatAvatar
                          avatarUrl={player.avatarUrl}
                          nickname={player.nickname}
                          isBot={player.controller === "BOT"}
                          variant="player"
                          onClick={() =>
                            setProfileTarget({
                              playerId: player.playerId ?? null,
                              nickname: player.nickname,
                              avatarUrl: player.avatarUrl,
                              score: player.score,
                              controller: player.controller,
                              connected: player.connected,
                              isSelf: seat === room.selfSeat,
                              isOwner: false,
                              competitiveProfile: player.competitiveProfile,
                            })
                          }
                        />
                        <View className="player-station__copy">
                          <Text
                            className="player-station__name is-clickable"
                            onClick={() =>
                              setProfileTarget({
                                playerId: player.playerId ?? null,
                                nickname: player.nickname,
                                avatarUrl: player.avatarUrl,
                                score: player.score,
                                controller: player.controller,
                                connected: player.connected,
                                isSelf: seat === room.selfSeat,
                                isOwner: false,
                                competitiveProfile: player.competitiveProfile,
                              })
                            }
                          >
                            {player.nickname}
                          </Text>
                          <View className="player-station__stats">
                            <Text className="player-station__stat player-station__stat--score">
                              牌桌分 {player.score}
                            </Text>
                            <Text className="player-station__stat player-station__stat--multiplier">
                              ×{player.personalMultiplier}
                            </Text>
                            <Text className="player-station__stat player-station__stat--hand">
                              {player.handCount}张
                            </Text>
                            {!player.connected ? (
                              <Text className="player-station__stat is-offline">离线</Text>
                            ) : null}
                          </View>
                        </View>
                        {player.competitiveProfile !== null ? (
                          <RankBadge
                            rank={player.competitiveProfile.rankDisplay}
                            size="compact"
                            className="seat-rank-badge"
                          />
                        ) : null}
                      </View>
                    </View>
                    {hasPublicTiles ? (
                      <View
                        className={`player-meld-rail ${pos}${
                          seat === room.selfSeat ? " is-self" : ""
                        } ${publicRailDensity} public-groups-${publicGroupCount}${
                          latestReleasedWildcard === null ? "" : " has-wildcard"
                        }`}
                      >
                        {player.melds.map((meld) => (
                          <View key={meld.id} className="meld-group">
                            <Text className="meld-group__label">{MELD_LABELS[meld.kind]}</Text>
                            <View className="meld-group__tiles">
                              {meld.tileIds.map((tileId) => (
                                <MahjongTile
                                  key={tileId}
                                  compact
                                  tile={{ id: tileId, ...meld.tileKind }}
                                  wildcardKind={room.wildcardKind}
                                />
                              ))}
                            </View>
                          </View>
                        ))}
                        {latestReleasedWildcard !== null ? (
                          <View className="released-wildcard-group">
                            <Text className="meld-group__label">放赖</Text>
                            <View className="released-wildcard-group__tiles">
                              <MahjongTile
                                compact
                                tile={latestReleasedWildcard}
                                wildcardKind={room.wildcardKind}
                              />
                              <Text className="released-wildcard-group__count">
                                ×{player.releasedWildcards.length}
                              </Text>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </Fragment>
                );
              })}

              <View className="table-center">
                <View className="center-block">
                  <Text className="center-label">亮牌</Text>
                  {room.indicatorTile !== null ? (
                    <MahjongTile
                      tile={room.indicatorTile}
                      compact
                      wildcardKind={room.wildcardKind}
                    />
                  ) : (
                    <Text className="center-empty">—</Text>
                  )}
                </View>
                <View className="center-block center-block--main">
                  <Text className="center-label">余牌 {room.wallRemaining}</Text>
                  <Text className="center-status">{phaseLabel(room)}</Text>
                  {/* Always rendered (visibility-hidden when idle) so the center
                      panel keeps a fixed height — the discard rings are offset
                      from it and would jump if it grew/shrank. */}
                  <Text
                    className={`center-countdown${
                      secondsRemaining !== null && secondsRemaining <= 5 ? " is-urgent" : ""
                    }${
                      secondsRemaining !== null &&
                      room.roundPhase !== "ROUND_OVER" &&
                      roomCtrl.connectionStatus === "connected" &&
                      roomCtrl.pendingAction === null
                        ? ""
                        : " is-hidden"
                    }`}
                  >
                    {secondsRemaining ?? "—"}
                    <Text className="center-countdown__unit">秒</Text>
                  </Text>
                </View>
                <View className="center-block">
                  <Text className="center-label">赖子</Text>
                  {room.wildcardKind !== null ? (
                    <MahjongTile
                      tile={{ id: "wildcard-preview", ...room.wildcardKind }}
                      compact
                      wildcardKind={room.wildcardKind}
                    />
                  ) : (
                    <Text className="center-empty">—</Text>
                  )}
                </View>
              </View>

              {room.selfRole === "SPECTATOR" ? (
                <View className="spectator-banner">
                  <Text className="spectator-banner__title">观战中</Text>
                  <Text className="spectator-banner__copy">本局结束后自动替换机器人入座</Text>
                </View>
              ) : null}

              {SEATS.map((seat) => {
                const player = room.players[seat];
                if (player === undefined) return null;
                const pos = POSITION_CLASS[relativePosition(seat, selfSeat)] ?? "pos-self";
                const visibleLimit = pos === "pos-self" ? SELF_VISIBLE_DISCARDS : VISIBLE_DISCARDS;
                const discards = player.discards.slice(-visibleLimit);
                return (
                  <View key={`d-${seat}`} className={`discard-zone ${pos}`}>
                    {discards.map((tile) => (
                      <MahjongTile
                        key={tile.id}
                        tile={tile}
                        compact
                        recent={tile.id === recentDiscardId}
                        wildcardKind={room.wildcardKind}
                      />
                    ))}
                    {player.discards.length > visibleLimit ? (
                      <Text className="discard-zone__count">{player.discards.length}张</Text>
                    ) : null}
                  </View>
                );
              })}

              <View className="self-area">
                {canDiscard && selectedTile !== null && selectedTingWaits === null ? (
                  <Text className="discard-tip">再点一次选中的牌即可打出</Text>
                ) : null}
                <View className="self-guidance-row">
                  <ActionDock
                    buttons={buttons}
                    disabled={locked}
                    onAction={(button) => void onAction(button)}
                  />
                  {selectedTingWaits !== null && selectedTingAnchor !== null ? (
                    <TingHintCard
                      waits={selectedTingWaits}
                      wildcardKind={room.wildcardKind}
                      anchor={selectedTingAnchor}
                    />
                  ) : null}
                </View>
                <View className="self-hand">
                  {hand.map((tile) => (
                    <View key={tile.id} className="hand-tile-slot">
                      {tingHints.has(tile.id) ? (
                        <Text className="hand-tile-slot__ting">听</Text>
                      ) : null}
                      <MahjongTile
                        tile={tile}
                        selected={tile.id === selectedTileId}
                        wildcardKind={room.wildcardKind}
                        highlighted={
                          handHighlight.kongTileIds.has(tile.id) ||
                          handHighlight.pongTileIds.has(tile.id)
                        }
                        highlightHint={
                          handHighlight.kongTileIds.has(tile.id)
                            ? "可杠"
                            : handHighlight.pongTileIds.has(tile.id)
                              ? "可碰"
                              : undefined
                        }
                        onPress={onTilePress}
                      />
                    </View>
                  ))}
                  {drawnTile !== null ? (
                    <View
                      className={`drawn-tile-slot${tingHints.has(drawnTile.id) ? " has-ting" : ""}`}
                    >
                      <Text className="drawn-tile-slot__label">摸</Text>
                      <View className="hand-tile-slot">
                        {tingHints.has(drawnTile.id) ? (
                          <Text className="hand-tile-slot__ting">听</Text>
                        ) : null}
                        <MahjongTile
                          tile={drawnTile}
                          selected={drawnTile.id === selectedTileId}
                          wildcardKind={room.wildcardKind}
                          highlighted={
                            handHighlight.kongTileIds.has(drawnTile.id) ||
                            handHighlight.pongTileIds.has(drawnTile.id)
                          }
                          highlightHint={
                            handHighlight.kongTileIds.has(drawnTile.id)
                              ? "可杠"
                              : handHighlight.pongTileIds.has(drawnTile.id)
                                ? "可碰"
                                : undefined
                          }
                          onPress={onTilePress}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>

              {quickMessageAvailable ? (
                <Button
                  className="quick-message-fab"
                  hoverClass="is-pressed"
                  aria-label="快捷消息"
                  onClick={() => setQuickMessageOpen((open) => !open)}
                >
                  快捷消息
                </Button>
              ) : null}

              {quickMessageAvailable && quickMessageOpen ? (
                <>
                  <View
                    className="quick-message-overlay"
                    onClick={() => setQuickMessageOpen(false)}
                  />
                  <View className="quick-message-bubble">
                    {VOICE_MESSAGES.map((voice) => (
                      <Button
                        key={voice.text}
                        className="quick-message-bubble__item"
                        hoverClass="is-pressed"
                        onClick={() => sendQuickMessage(voice.text)}
                      >
                        {voice.text}
                      </Button>
                    ))}
                    <View className="quick-message-bubble__tail" />
                  </View>
                </>
              ) : null}
            </View>

            {room.roundSettlement === null ? (
              <MahjongEffectOverlay cue={room.effectCue} selfSeat={room.selfSeat ?? 0} />
            ) : null}

            {room.roundSettlement !== null ? (
              <RoundSettlementModal
                settlement={room.roundSettlement}
                players={room.players}
                wildcardKind={room.wildcardKind}
                mode={room.mode}
                busy={roomCtrl.busy}
                onContinue={() =>
                  void (room.mode === "MATCH" ? continueCompetitiveMatch() : roomCtrl.continueBot())
                }
                onLeave={() =>
                  void (room.mode === "MATCH" ? returnFromCompetitiveMatch() : leaveCurrentRoom())
                }
              />
            ) : null}
          </>
        )}
      </View>
      {roundStartCountdown !== null ? (
        <RoundStartOverlay eyebrow="全员已准备" title="游戏开始" countdown={roundStartCountdown} />
      ) : null}
      {profileTarget !== null ? (
        <PlayerProfileModal
          playerId={profileTarget.playerId}
          nickname={profileTarget.nickname}
          avatarUrl={profileTarget.avatarUrl}
          score={profileTarget.score}
          controller={profileTarget.controller}
          connected={profileTarget.connected}
          isSelf={profileTarget.isSelf}
          isOwner={profileTarget.isOwner}
          competitiveProfile={profileTarget.competitiveProfile}
          friendActionLabel={(() => {
            if (
              profileTarget.isSelf ||
              profileTarget.playerId === null ||
              profileTarget.controller === "BOT"
            ) {
              return null;
            }
            if (
              social.snapshot?.friends.some(
                (friend) => friend.playerId === profileTarget.playerId,
              ) === true
            ) {
              return "已是好友";
            }
            const pending = social.snapshot?.friendRequests.find(
              (request) => request.player.playerId === profileTarget.playerId,
            );
            if (pending?.direction === "INCOMING") return "同意好友申请";
            if (pending?.direction === "OUTGOING") return "已发送申请";
            return "添加好友";
          })()}
          friendActionDisabled={
            social.busy ||
            social.snapshot?.friends.some(
              (friend) => friend.playerId === profileTarget.playerId,
            ) === true ||
            social.snapshot?.friendRequests.some(
              (request) =>
                request.player.playerId === profileTarget.playerId &&
                request.direction === "OUTGOING",
            ) === true
          }
          onFriendAction={() => {
            if (profileTarget.playerId === null) return;
            const incoming = social.snapshot?.friendRequests.find(
              (request) =>
                request.player.playerId === profileTarget.playerId &&
                request.direction === "INCOMING",
            );
            if (incoming !== undefined) {
              void social.acceptRequest(incoming.id);
              return;
            }
            void social.sendRequest(profileTarget.playerId);
          }}
          onClose={() => setProfileTarget(null)}
        />
      ) : null}
      {friendsOpen && room.mode === "TEAM_MATCH" && room.stage === "WAITING" ? (
        <FriendsPanel
          social={social}
          roomCode={room.roomCode}
          onClose={() => setFriendsOpen(false)}
        />
      ) : null}
    </View>
  );
}
