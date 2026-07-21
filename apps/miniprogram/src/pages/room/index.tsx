import { useMemo, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import type { BaseScore, RoomProjection, Seat, Tile } from "@huanghuang/protocol";
import tableBackground from "../../assets/background.optimized.jpg";
import { ActionDock } from "../../components/ActionDock";
import { MahjongTile } from "../../components/MahjongTile";
import { useRoom } from "../../hooks/useRoom";
import {
  hasValidTileSelection,
  primaryActionButtons,
  type ActionButtonModel,
} from "../../lib/actionButtons";
import {
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
} from "../../lib/actionEligibility";
import { decideTilePress } from "../../lib/handInteraction";
import { isWildcardTile } from "../../lib/tileArt";
import { sortHand, tileLabel } from "../../lib/tiles";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
const SEATS: readonly Seat[] = [0, 1, 2, 3];
const POSITION_CLASS = ["pos-self", "pos-right", "pos-opposite", "pos-left"] as const;

function relativePosition(seat: Seat, selfSeat: Seat): number {
  return ((seat - selfSeat + 4) % 4) as 0 | 1 | 2 | 3;
}

function selfPlayer(room: RoomProjection) {
  if (room.selfSeat === null) return null;
  return room.players[room.selfSeat] ?? null;
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
  const hand = useMemo(() => sortHand(self?.hand ?? []), [self?.hand]);
  const selectedTile =
    hand.find((tile) => tile.id === selectedTileId) ??
    (selectedTileId === null ? null : (hand[0] ?? null));
  const buttons = primaryActionButtons(room?.legalActions ?? []);
  const canDiscard = room?.legalActions.includes("DISCARD_TILE") === true;
  const locked = roomCtrl.busy || roomCtrl.connectionStatus !== "connected";

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
          <Button className="btn-accent" onClick={() => void Taro.navigateBack()}>
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
        <View className="game-header">
          <Button className="header-btn" disabled={roomCtrl.busy} onClick={() => void roomCtrl.leaveRoom()}>
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
            <Text className="game-header__meta">{roomCtrl.connectionStatus}</Text>
            {room.mode === "FRIEND" ? (
              <Button className="header-btn" onClick={() => void copyRoomCode()}>
                {inviteStatus}
              </Button>
            ) : null}
            {room.mode === "FRIEND" && room.isOwner ? (
              <Button
                className="header-btn header-btn--danger"
                disabled={roomCtrl.busy}
                onClick={() => void roomCtrl.dissolve()}
              >
                解散
              </Button>
            ) : null}
          </View>
        </View>

        {roomCtrl.error !== null ? <Text className="banner-error">{roomCtrl.error}</Text> : null}

        {room.stage === "WAITING" ? (
          <View className="waiting-panel">
            <View className="panel-card">
              <Text className="waiting-title">等待开局</Text>
              <View className="invite-row">
                <Text className="invite-code">{room.roomCode}</Text>
                <Button className="btn-accent" onClick={() => void copyRoomCode()}>
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
                      {seat.occupied ? seat.nickname ?? "玩家" : "空位"}
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
                      disabled={roomCtrl.busy || room.baseScore === score}
                      onClick={() => void roomCtrl.updateBaseScore(score)}
                    >
                      底分 {score}
                    </Button>
                  ))}
                </View>
              ) : null}
              <View className="waiting-actions">
                <Button className="btn-accent" disabled={roomCtrl.busy} onClick={() => void roomCtrl.ready()}>
                  {room.selfReady ? "取消准备" : "准备"}
                </Button>
                <Button className="btn-ghost" disabled={roomCtrl.busy} onClick={() => void roomCtrl.leaveRoom()}>
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
                    <View className="player-station__melds">
                      {player.melds.map((meld) => (
                        <Text key={meld.id} className="meld-chip">
                          {meld.kind === "PONG" ? "碰" : "杠"}
                          {tileLabel(meld.tileKind)}
                        </Text>
                      ))}
                    </View>
                  </View>
                );
              })}

              <View className="table-center">
                <View className="center-block">
                  <Text className="center-label">亮牌</Text>
                  {room.indicatorTile !== null ? (
                    <MahjongTile tile={room.indicatorTile} compact wildcardKind={room.wildcardKind} />
                  ) : (
                    <Text className="center-empty">—</Text>
                  )}
                </View>
                <View className="center-block center-block--main">
                  <Text className="center-label">余牌 {room.wallRemaining}</Text>
                  <Text className="center-status">
                    {room.stage === "ROUND_RESULT" ? "本局结束" : room.roundPhase ?? room.stage}
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
                const discards = player.discards.slice(-8);
                return (
                  <View key={`d-${seat}`} className={`discard-zone ${pos}`}>
                    {discards.map((tile) => (
                      <MahjongTile key={tile.id} tile={tile} compact wildcardKind={room.wildcardKind} />
                    ))}
                  </View>
                );
              })}

              <View className="self-area">
                <View className="self-hand">
                  {hand.map((tile) => (
                    <MahjongTile
                      key={tile.id}
                      tile={tile}
                      selected={tile.id === selectedTileId}
                      wildcardKind={room.wildcardKind}
                      onPress={onTilePress}
                    />
                  ))}
                </View>
              </View>
            </View>

            <ActionDock buttons={buttons} disabled={locked} onAction={(button) => void onAction(button)} />

            {room.stage === "ROUND_RESULT" && room.mode === "BOT" ? (
              <View className="result-bar">
                <Button className="btn-accent" disabled={roomCtrl.busy} onClick={() => void roomCtrl.continueBot()}>
                  再来一局
                </Button>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
