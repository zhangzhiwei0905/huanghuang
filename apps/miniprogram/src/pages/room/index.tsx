import { useMemo, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import type { BaseScore, RoomProjection, Tile } from "@huanghuang/protocol";
import {
  hasValidTileSelection,
  isWildcardTile,
  primaryActionButtons,
  type PrimaryGameAction,
} from "../../lib/actionButtons";
import {
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
} from "../../lib/actionEligibility";
import { decideTilePress } from "../../lib/handInteraction";
import { sortHand, tileLabel } from "../../lib/tiles";
import { useRoom } from "../../hooks/useRoom";
import "./index.scss";

const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];

function selfPlayer(room: RoomProjection) {
  if (room.selfSeat === null) return null;
  return room.players[room.selfSeat] ?? null;
}

export default function RoomPage() {
  const roomCtrl = useRoom();
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const room = roomCtrl.room;

  useDidShow(() => {
    const channel = Taro.getStorageSync("huanghuang_open_room");
    if (channel !== "" && channel !== null && typeof channel === "object") {
      roomCtrl.openRoom(channel as RoomProjection);
      Taro.removeStorageSync("huanghuang_open_room");
    }
  });

  const self = room === null ? null : selfPlayer(room);
  const hand = useMemo(() => sortHand(self?.hand ?? []), [self?.hand]);
  const selectedTile =
    hand.find((tile) => tile.id === selectedTileId) ??
    (selectedTileId === null ? null : hand[0] ?? null);
  const buttons = primaryActionButtons(room?.legalActions ?? []);
  const canDiscard = room?.legalActions.includes("DISCARD_TILE") === true;
  const locked = roomCtrl.busy || roomCtrl.connectionStatus !== "connected";

  if (room === null) {
    return (
      <View className="room">
        <Text className="room__title">{roomCtrl.notice ?? "尚未进入房间"}</Text>
        <Button
          className="room__button room__button--primary"
          onClick={() => void Taro.navigateBack()}
        >
          返回大厅
        </Button>
      </View>
    );
  }

  async function onAction(action: PrimaryGameAction) {
    if (room === null || self === null) return;
    if (!hasValidTileSelection(action, selectedTile, room.wildcardKind)) {
      Taro.showToast({ title: "请先选择合适的牌", icon: "none" });
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
        Taro.showToast({ title: "没有可暗杠的牌", icon: "none" });
        return;
      }
      await roomCtrl.send(action, payload);
      return;
    }
    if (action === "DECLARE_ADDED_KONG") {
      const payload = deriveAddedKongPayload(room, self, selectedTile);
      if (payload === null) {
        Taro.showToast({ title: "没有可补杠的牌", icon: "none" });
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

  return (
    <View className="room">
      <View className="room__bar">
        <Text className="room__meta">
          房号 {room.roomCode} · {room.mode} · {room.stage} · v{room.version}
        </Text>
        <Text className="room__meta">
          连接 {roomCtrl.connectionStatus}
          {roomCtrl.pendingAction !== null ? ` · ${roomCtrl.pendingAction}` : ""}
        </Text>
      </View>
      {roomCtrl.error !== null ? <Text className="room__error">{roomCtrl.error}</Text> : null}
      {roomCtrl.notice !== null ? <Text className="room__error">{roomCtrl.notice}</Text> : null}

      {room.stage === "WAITING" ? (
        <View className="room__panel">
          <Text className="room__title">等待房</Text>
          <Text className="room__meta">
            底分 {room.baseScore}
            {room.waitingExpiresAt !== null ? ` · 超时 ${room.waitingExpiresAt}` : ""}
          </Text>
          <View className="room__row">
            {room.lobbySeats.map((seat) => (
              <View
                key={seat.seat}
                className={`room__seat${seat.isSelf ? " room__seat--self" : ""}`}
              >
                <Text>
                  座{seat.seat} {seat.nickname ?? "空位"}{" "}
                  {seat.occupied ? (seat.connected ? "在线" : "离线") : ""}{" "}
                  {seat.ready ? "已准备" : seat.occupied ? "未准备" : ""}
                  {seat.isOwner ? " · 房主" : ""}
                </Text>
              </View>
            ))}
          </View>
          {room.isOwner ? (
            <View className="room__row">
              {BASE_SCORES.map((score) => (
                <Button
                  key={score}
                  className="room__button"
                  disabled={roomCtrl.busy || room.baseScore === score}
                  onClick={() => void roomCtrl.updateBaseScore(score)}
                >
                  底分 {score}
                </Button>
              ))}
            </View>
          ) : null}
          <View className="room__actions">
            <Button
              className="room__button room__button--primary"
              disabled={roomCtrl.busy}
              onClick={() => void roomCtrl.ready()}
            >
              {room.selfReady ? "取消准备" : "准备"}
            </Button>
            {room.isOwner ? (
              <Button
                className="room__button room__button--danger"
                disabled={roomCtrl.busy}
                onClick={() => void roomCtrl.dissolve()}
              >
                解散
              </Button>
            ) : null}
            <Button className="room__button" disabled={roomCtrl.busy} onClick={() => void roomCtrl.leaveRoom()}>
              离开
            </Button>
          </View>
        </View>
      ) : null}

      {room.stage === "PLAYING" || room.stage === "ROUND_RESULT" ? (
        <View className="room__panel">
          <Text className="room__title">
            {room.stage === "ROUND_RESULT" ? "本局结果" : "对局中"}
          </Text>
          <View className="room__table">
            <Text className="room__table-text">
              房号 {room.roomCode}
              {"\n"}
              余牌 {room.wallRemaining}
              {room.wildcardKind !== null ? ` · 赖 ${tileLabel(room.wildcardKind)}` : ""}
              {"\n"}
              连接 {roomCtrl.connectionStatus}
            </Text>
          </View>
          <Text className="room__meta">
            {room.actionDeadlineAt !== null ? `截止 ${room.actionDeadlineAt}` : "等待操作"}
            {roomCtrl.pendingAction !== null ? ` · 提交中 ${roomCtrl.pendingAction}` : ""}
          </Text>

          {room.players.map((player) => (
            <View key={player.seat} className="room__chip">
              <Text>
                座{player.seat} {player.nickname} {player.controller} 分{player.score} 手
                {player.handCount} 倍{player.personalMultiplier}
              </Text>
            </View>
          ))}

          <Text className="room__section-label">我的副露</Text>
          <View className="room__melds">
            {(self?.melds ?? []).length === 0 ? (
              <Text className="room__meta">暂无副露</Text>
            ) : (
              (self?.melds ?? []).map((meld) => (
                <Text key={meld.id} className="room__chip">
                  {meld.kind} {tileLabel(meld.tileKind)}
                </Text>
              ))
            )}
          </View>

          <Text className="room__section-label">我的手牌（点选，再点可出牌）</Text>
          <View className="room__hand">
            {hand.map((tile) => {
              const wildcard = isWildcardTile(tile, room.wildcardKind);
              const selected = tile.id === selectedTileId;
              return (
                <View
                  key={tile.id}
                  className={`room__tile${selected ? " room__tile--selected" : ""}${
                    wildcard ? " room__tile--wildcard" : ""
                  }`}
                  onClick={() => onTilePress(tile)}
                >
                  <Text>{tileLabel(tile)}</Text>
                </View>
              );
            })}
          </View>

          <Text className="room__section-label">操作</Text>
          <View className="room__actions">
            {buttons.map((button) => (
              <Button
                key={button.action}
                className="room__button room__button--primary"
                disabled={locked}
                onClick={() => void onAction(button.action)}
              >
                {button.label}
              </Button>
            ))}
            <Button className="room__button" disabled={roomCtrl.busy} onClick={() => void roomCtrl.refresh()}>
              同步
            </Button>
          </View>

          {room.stage === "ROUND_RESULT" && room.mode === "BOT" ? (
            <Button
              className="room__button room__button--primary"
              disabled={roomCtrl.busy}
              onClick={() => void roomCtrl.continueBot()}
            >
              再来一局
            </Button>
          ) : null}

          <View className="room__actions">
            {room.isOwner ? (
              <Button
                className="room__button room__button--danger"
                disabled={roomCtrl.busy}
                onClick={() => void roomCtrl.dissolve()}
              >
                解散
              </Button>
            ) : null}
            <Button className="room__button" disabled={roomCtrl.busy} onClick={() => void roomCtrl.leaveRoom()}>
              离开
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}
