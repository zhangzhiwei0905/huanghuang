import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import type { BaseScore, RoomProjection, Seat, Tile } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ActionDock } from "../../components/ActionDock";
import { MahjongTile } from "../../components/MahjongTile";
import { RoundSettlementModal } from "../../components/RoundSettlementModal";
import { useRoom, type ConnectionStatus } from "../../hooks/useRoom";
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
import { isWildcardTile } from "../../lib/tileArt";
import { sortHand } from "../../lib/tiles";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
const SEATS: readonly Seat[] = [0, 1, 2, 3];
const POSITION_CLASS = ["pos-self", "pos-right", "pos-opposite", "pos-left"] as const;
const VISIBLE_DISCARDS = 12;
/* The self pile sits in the narrow strip between table-center and the action
   dock — only a single wide row fits there, so it shows fewer tiles (players
   know their own discards; the count chip carries the total). */
const SELF_VISIBLE_DISCARDS = 6;

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
};

function relativePosition(seat: Seat, selfSeat: Seat): number {
  return ((seat - selfSeat + 4) % 4) as 0 | 1 | 2 | 3;
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
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState("复制房号");
  const room = roomCtrl.room;

  useDidShow(() => {
    const channel = Taro.getStorageSync("huanghuang_open_room");
    if (channel !== "" && channel !== null && typeof channel === "object") {
      roomCtrl.openRoom(channel as RoomProjection);
      Taro.removeStorageSync("huanghuang_open_room");
    }
  });

  const self = room === null ? null : selfPlayer(room);
  const selfSeat = room?.selfSeat ?? 0;
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
  const recentDiscardId = useRecentDiscardId(room);
  const locked = roomCtrl.busy || roomCtrl.connectionStatus !== "connected";
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
    return (
      <View className="game-shell empty-shell">
        <Image className="game-shell__bg" src={tableBackground} mode="aspectFill" />
        <View className="game-shell__overlay" />
        <View className="game-shell__content empty-shell-content">
          <Text className="empty-title">{roomCtrl.notice ?? "尚未进入房间"}</Text>
          <Button
            className="btn-accent"
            hoverClass="is-pressed"
            onClick={() => void Taro.navigateBack()}
          >
            返回大厅
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className={`game-shell${room.actingSeat === room.selfSeat ? " is-self-turn" : ""}`}>
      <Image className="game-shell__bg" src={tableBackground} mode="aspectFill" />
      <View className="game-shell__overlay" />
      <View className="game-shell__content">
        {room.stage === "WAITING" ? (
          <View className="game-header">
            <Button
              className="header-btn"
              hoverClass="is-pressed"
              disabled={roomCtrl.busy}
              onClick={() => void roomCtrl.leaveRoom()}
            >
              离开
            </Button>
            <View className="room-code">
              <Text className="room-code__label">{room.mode === "BOT" ? "MODE" : "ROOM"}</Text>
              <Text className="room-code__value">
                {room.mode === "BOT" ? "人机对战" : room.roomCode}
              </Text>
            </View>
            <View className="game-meta">
              <Text className="game-header__meta">底分 {room.baseScore}</Text>
              <Text className="game-header__meta">
                {CONNECTION_LABELS[roomCtrl.connectionStatus]}
              </Text>
              {room.mode === "FRIEND" ? (
                <Button
                  className="header-btn"
                  hoverClass="is-pressed"
                  onClick={() => void copyRoomCode()}
                >
                  {inviteStatus}
                </Button>
              ) : null}
              {room.mode === "FRIEND" && room.isOwner ? (
                <Button
                  className="header-btn header-btn--danger"
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
              onClick={() => void roomCtrl.leaveRoom()}
            >
              离开
            </Button>
            <View className="info-capsule">
              <Text className="info-capsule__code">
                {room.mode === "BOT" ? "人机对战" : room.roomCode}
              </Text>
              <Text className="info-capsule__meta">底分{room.baseScore}</Text>
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
          <View className="waiting-panel">
            <View className="panel-card">
              <Text className="waiting-title">等待开局</Text>
              <View className="invite-row">
                <Text className="invite-code">{room.roomCode}</Text>
                <Button
                  className="btn-accent"
                  hoverClass="is-pressed"
                  onClick={() => void copyRoomCode()}
                >
                  {inviteStatus}
                </Button>
              </View>
              <Text className="waiting-hint">把 6 位房号发给好友，在小程序「加入房间」</Text>
              <View className="lobby-grid">
                {room.lobbySeats.map((seat) => (
                  <View
                    key={seat.seat}
                    className={`lobby-seat${seat.isSelf ? " is-self" : ""}${seat.ready ? " is-ready" : ""}`}
                  >
                    <Text className="lobby-seat__name">
                      {seat.occupied ? (seat.nickname ?? "玩家") : "空位"}
                    </Text>
                    <Text className="lobby-seat__meta">
                      座{seat.seat}
                      {seat.isOwner ? " · 房主" : ""}
                      {seat.occupied ? (seat.connected ? " · 在线" : " · 离线") : ""}
                      {seat.ready ? " · 已准备" : seat.occupied ? " · 未准备" : ""}
                    </Text>
                  </View>
                ))}
              </View>
              {room.isOwner ? (
                <View className="score-row">
                  {BASE_SCORES.map((score) => (
                    <Button
                      key={score}
                      className={`score-chip${room.baseScore === score ? " is-active" : ""}`}
                      hoverClass="is-pressed"
                      disabled={roomCtrl.busy || room.baseScore === score}
                      onClick={() => void roomCtrl.updateBaseScore(score)}
                    >
                      底分 {score}
                    </Button>
                  ))}
                </View>
              ) : null}
              <View className="waiting-actions">
                <Button
                  className="btn-accent"
                  hoverClass="is-pressed"
                  disabled={roomCtrl.busy}
                  onClick={() => void roomCtrl.ready()}
                >
                  {room.selfReady ? "取消准备" : "准备"}
                </Button>
                <Button
                  className="btn-ghost"
                  hoverClass="is-pressed"
                  disabled={roomCtrl.busy}
                  onClick={() => void roomCtrl.leaveRoom()}
                >
                  离开房间
                </Button>
              </View>
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
                return (
                  <View
                    key={seat}
                    className={`player-station ${pos}${active ? " is-active" : ""}${
                      seat === room.selfSeat ? " is-self" : ""
                    }`}
                  >
                    <Text className="player-station__name">
                      {player.nickname}
                      {player.controller === "BOT" ? "·机" : ""}
                    </Text>
                    <Text className="player-station__meta">
                      分{player.score} · 手{player.handCount} · 倍{player.personalMultiplier}
                      {player.connected ? "" : " · 离"}
                    </Text>
                    {player.melds.length > 0 || latestReleasedWildcard !== null ? (
                      <View className="player-station__melds">
                        {player.melds.map((meld) => (
                          <View key={meld.id} className="meld-group">
                            {meld.tileIds.map((tileId) => (
                              <MahjongTile
                                key={tileId}
                                compact
                                tile={{ id: tileId, ...meld.tileKind }}
                                wildcardKind={room.wildcardKind}
                              />
                            ))}
                          </View>
                        ))}
                        {latestReleasedWildcard !== null ? (
                          <View className="released-wildcard-group">
                            <MahjongTile
                              compact
                              tile={latestReleasedWildcard}
                              wildcardKind={room.wildcardKind}
                            />
                            <Text className="released-wildcard-group__count">
                              ×{player.releasedWildcards.length}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
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
                {canDiscard && selectedTile !== null ? (
                  <Text className="discard-tip">再点一次选中的牌即可打出</Text>
                ) : null}
                <ActionDock
                  buttons={buttons}
                  disabled={locked}
                  onAction={(button) => void onAction(button)}
                />
                <View className="self-hand">
                  {hand.map((tile) => (
                    <MahjongTile
                      key={tile.id}
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
                  ))}
                  {drawnTile !== null ? (
                    <View className="drawn-tile-slot">
                      <Text className="drawn-tile-slot__label">摸</Text>
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
                  ) : null}
                </View>
              </View>
            </View>

            {room.roundSettlement !== null ? (
              <RoundSettlementModal
                settlement={room.roundSettlement}
                players={room.players}
                wildcardKind={room.wildcardKind}
                mode={room.mode}
                busy={roomCtrl.busy}
                onContinue={() => void roomCtrl.continueBot()}
                onLeave={() => void roomCtrl.leaveRoom()}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
