import { Button, Text, View } from "@tarojs/components";
import type {
  PlayerProjection,
  RoomMode,
  RoundSettlementProjection,
  Seat,
  TileKind,
} from "@huanghuang/protocol";
import { sortHand } from "../lib/tiles";
import { MahjongTile } from "./MahjongTile";
import "./RoundSettlementModal.scss";

type RoundSettlementModalProps = {
  settlement: RoundSettlementProjection;
  players: PlayerProjection[];
  wildcardKind: TileKind | null;
  mode: RoomMode;
  busy: boolean;
  onContinue: () => void;
  onLeave: () => void;
};

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export function RoundSettlementModal({
  settlement,
  players,
  wildcardKind,
  mode,
  busy,
  onContinue,
  onLeave,
}: RoundSettlementModalProps) {
  const playerName = (seat: Seat) => players[seat]?.nickname ?? `玩家 ${seat + 1}`;
  const outcomeLabel =
    settlement.kind === "DRAW"
      ? "本局流局"
      : `${playerName(settlement.winnerSeat ?? 0)} ${
          settlement.winType === "HARD" ? "硬胡" : "软胡"
        }`;
  const outcomeClass =
    settlement.kind === "DRAW"
      ? "is-draw"
      : settlement.winType === "HARD"
        ? "is-hard-win"
        : "is-soft-win";

  return (
    <View className="settlement-backdrop">
      <View className={`settlement-modal ${outcomeClass}`}>
        <View className="settlement-header">
          <View>
            <Text className="settlement-eyebrow">本局结算</Text>
            <Text className="settlement-outcome">{outcomeLabel}</Text>
          </View>
          <Text className="settlement-meta">
            {mode === "BOT" ? "等待你的选择" : "即将返回房间准备"}
          </Text>
        </View>

        <View className="settlement-list">
          {settlement.finalHands.map((finalHand) => {
            const change = settlement.scoreChanges.find((item) => item.seat === finalHand.seat);
            const winner = settlement.winnerSeat === finalHand.seat;
            return (
              <View
                key={finalHand.seat}
                className={`settlement-row${winner ? " is-winner" : ""}${
                  change !== undefined && change.roundDelta > 0 ? " is-gain" : ""
                }`}
              >
                <View className="settlement-identity">
                  <Text className="settlement-name">{playerName(finalHand.seat)}</Text>
                  <Text className="settlement-role">
                    {winner ? "本局赢家" : `座位 ${finalHand.seat + 1}`}
                  </Text>
                </View>
                <View className="settlement-hand">
                  {sortHand(finalHand.tiles).map((tile) => (
                    <MahjongTile key={tile.id} tile={tile} compact wildcardKind={wildcardKind} />
                  ))}
                </View>
                <View className="settlement-multiplier">
                  <Text className="settlement-multiplier__label">倍率</Text>
                  <Text className="settlement-multiplier__value">
                    {finalHand.personalMultiplier}×
                  </Text>
                </View>
                <View className="settlement-score">
                  <View className="settlement-score__item">
                    <Text className="settlement-score__label">本局</Text>
                    <Text className="settlement-score__value">
                      {change === undefined ? "0" : signedScore(change.roundDelta)}
                    </Text>
                  </View>
                  <View className="settlement-score__item">
                    <Text className="settlement-score__label">累计</Text>
                    <Text className="settlement-score__value settlement-score__value--total">
                      {change?.totalScore ?? 0}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {mode === "BOT" ? (
          <View className="settlement-actions">
            <Button className="btn-ghost" hoverClass="is-pressed" disabled={busy} onClick={onLeave}>
              退出到主页
            </Button>
            <Button
              className="btn-accent"
              hoverClass="is-pressed"
              disabled={busy}
              onClick={onContinue}
            >
              继续游戏
            </Button>
          </View>
        ) : null}
      </View>
    </View>
  );
}
