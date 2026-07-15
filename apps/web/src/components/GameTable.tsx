import type {
  CommandEnvelope,
  Meld,
  PlayerProjection,
  RoomProjection,
  RoundSettlementProjection,
  Seat,
  Tile,
} from "@huanghuang/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
  handHighlightGroups,
} from "./actionEligibility.js";
import { MahjongTile } from "./MahjongTile.js";
import {
  createPlayerActionSnapshot,
  detectPlayerActionNotice,
  PLAYER_ACTION_LABELS,
  type PlayerActionNotice,
  type PlayerActionSnapshot,
} from "./playerActionNotice.js";

type GameTableProps = {
  room: RoomProjection;
  busy: boolean;
  error: string | null;
  onReady: () => Promise<void>;
  onLeave: () => Promise<void>;
  onDissolve: () => Promise<void>;
  onSend: (type: CommandEnvelope["type"], payload?: Record<string, unknown>) => Promise<void>;
};

const SEATS: readonly Seat[] = [0, 1, 2, 3];
const POSITION_CLASS = [
  "position-bottom",
  "position-right",
  "position-top",
  "position-left",
] as const;
const DISCARD_POSITION_CLASS = [
  "discard-position-bottom",
  "discard-position-right",
  "discard-position-top",
  "discard-position-left",
] as const;
const ACTION_NOTICE_POSITION_CLASS = [
  "action-position-bottom",
  "action-position-right",
  "action-position-top",
  "action-position-left",
] as const;
const SUIT_ORDER = { WAN: 0, TIAO: 1, TONG: 2 } as const;
type ActionCategory = "pong" | "kong" | "wildcard";
const KONG_ACTIONS = new Set<PlayerActionNotice["action"]>([
  "EXPOSED_KONG",
  "CONCEALED_KONG",
  "ADDED_KONG",
  "INDICATOR_PONG_KONG",
]);
type LandedHighlight = {
  seat: Seat;
  category: ActionCategory;
  meldId: string | null;
};
const ACTION_LABELS: Partial<Record<CommandEnvelope["type"], string>> = {
  DECLARE_WIN: "自摸",
  CONTINUE_TURN: "继续打牌",
  RELEASE_WILDCARD: "放赖",
  DISCARD_TILE: "打出",
  CLAIM_PONG: "碰",
  CLAIM_EXPOSED_KONG: "明杠",
  CLAIM_INDICATOR_PONG_KONG: "亮牌碰杠",
  DECLARE_CONCEALED_KONG: "暗杠",
  DECLARE_ADDED_KONG: "补杠",
  PASS_RESPONSE: "过",
};
const HAND_ACTIONS = new Set<CommandEnvelope["type"]>(["RELEASE_WILDCARD", "DISCARD_TILE"]);
// These six action types are surfaced by the larger PrimaryActionBar above the
// hand, so they're excluded from the small bottom action-dock to avoid a
// duplicate entry point.
const PRIMARY_BAR_ACTIONS = new Set<CommandEnvelope["type"]>([
  "DECLARE_WIN",
  "CLAIM_PONG",
  "CLAIM_EXPOSED_KONG",
  "CLAIM_INDICATOR_PONG_KONG",
  "DECLARE_CONCEALED_KONG",
  "DECLARE_ADDED_KONG",
]);

function relativePosition(seat: Seat, selfSeat: Seat): number {
  return (seat - selfSeat + 4) % 4;
}

function playerAt(room: RoomProjection, seat: Seat): PlayerProjection {
  const player = room.players[seat];
  if (player === undefined) throw new Error(`Projection is missing seat ${seat}`);
  return player;
}

function actionCategory(action: PlayerActionNotice["action"]): ActionCategory {
  if (action === "RELEASE_WILDCARD") return "wildcard";
  return KONG_ACTIONS.has(action) ? "kong" : "pong";
}

function findMeldIdByTileIds(player: PlayerProjection, tileIds: string[]): string | null {
  const idSet = new Set(tileIds);
  const match = player.melds.find(
    (meld) => meld.tileIds.length === tileIds.length && meld.tileIds.every((id) => idSet.has(id)),
  );
  return match?.id ?? null;
}

function tileKindLabel(tile: { rank: number; suit: string }): string {
  const suit = tile.suit === "WAN" ? "万" : tile.suit === "TIAO" ? "条" : "筒";
  return `${tile.rank}${suit}`;
}

function playerActionNoticeLabel(room: RoomProjection, notice: PlayerActionNotice): string {
  const tile = notice.tiles[0];
  const tileDescription =
    tile === undefined ? "" : `，${tileKindLabel(tile)}，${notice.tiles.length}张`;
  return `${playerAt(room, notice.seat).nickname}${PLAYER_ACTION_LABELS[notice.action]}${tileDescription}`;
}

function MeldGroup({
  meld,
  landed = false,
  category = null,
}: {
  meld: Meld;
  landed?: boolean;
  category?: ActionCategory | null;
}) {
  const landedClass = landed && category !== null ? `is-landed action-${category}` : "";
  return (
    <div className={["meld-group", landedClass].filter(Boolean).join(" ")} title={meld.kind}>
      {meld.tileIds.map((id) => (
        <MahjongTile key={id} compact tile={{ id, ...meld.tileKind }} />
      ))}
    </div>
  );
}

function PlayerStation({
  player,
  active,
  position,
  landedMeldId,
  landedCategory,
}: {
  player: PlayerProjection;
  active: boolean;
  position: number;
  landedMeldId: string | null;
  landedCategory: ActionCategory | null;
}) {
  return (
    <section
      className={`player-station ${POSITION_CLASS[position] ?? ""} ${active ? "is-active" : ""}`}
    >
      <div className="player-identity">
        <span className="status-dot" />
        <strong>{player.nickname}</strong>
        <small>
          {player.controller === "BOT"
            ? "机器人"
            : player.controller === "TRUSTEE"
              ? "托管"
              : "在线"}
        </small>
      </div>
      <div className="player-score">
        <b>{player.score}</b>
        <span>分 · {player.personalMultiplier}×</span>
      </div>
      {position === 0 ? null : (
        <div className="hidden-hand" aria-label={`${player.handCount} 张手牌`}>
          {Array.from({ length: Math.min(player.handCount, 14) }, (_, index) => (
            <i key={`${player.seat}-${index}`} />
          ))}
        </div>
      )}
      {/* Self already renders their own melds in the .self-area meld-row, so skip the
          duplicate meld tiles here for position 0 and only surface the wildcard count
          (which has no other on-screen representation for self). */}
      {(position !== 0 && player.melds.length > 0) || player.releasedWildcards.length > 0 ? (
        <div className="player-melds" aria-label={`${player.nickname}的公开组合`}>
          {position === 0
            ? null
            : player.melds.map((meld) => (
                <MeldGroup
                  key={meld.id}
                  meld={meld}
                  landed={meld.id === landedMeldId}
                  category={landedCategory}
                />
              ))}
          {player.releasedWildcards.length > 0 ? (
            <span
              className={`wildcard-tag ${landedCategory === "wildcard" ? "is-landed" : ""}`}
              aria-label={`已放赖 ${player.releasedWildcards.length} 次`}
            >
              赖 ×{player.releasedWildcards.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DiscardZone({
  player,
  position,
  wildcardKind,
}: {
  player: PlayerProjection;
  position: number;
  wildcardKind: RoomProjection["wildcardKind"];
}) {
  const visibleLimit = position === 1 || position === 3 ? 12 : 18;
  const visibleDiscards = player.discards.slice(-visibleLimit);
  return (
    <section
      className={`discard-zone ${DISCARD_POSITION_CLASS[position] ?? ""}`}
      aria-label={`${player.nickname}的弃牌，共${player.discards.length}张`}
    >
      <header>
        <span>{player.nickname}</span>
        <small>{player.discards.length} 张</small>
      </header>
      <div className="discard-tiles">
        {visibleDiscards.length === 0 ? (
          <i className="discard-empty">暂无弃牌</i>
        ) : (
          visibleDiscards.map((tile) => (
            <MahjongTile key={tile.id} tile={tile} wildcardKind={wildcardKind} compact />
          ))
        )}
      </div>
    </section>
  );
}

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function RoundSettlementModal({
  settlement,
  players,
}: {
  settlement: RoundSettlementProjection;
  players: PlayerProjection[];
}) {
  const playerName = (seat: Seat) => players[seat]?.nickname ?? `玩家 ${seat + 1}`;
  const outcomeLabel =
    settlement.kind === "DRAW"
      ? "本局流局"
      : `${playerName(settlement.winnerSeat ?? 0)} ${settlement.winType === "HARD" ? "硬胡" : "软胡"}`;

  return (
    <div className="round-settlement-backdrop">
      <section
        className="round-settlement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-settlement-title"
      >
        <header>
          <div>
            <span>ROUND RESULT</span>
            <h2 id="round-settlement-title">{outcomeLabel}</h2>
          </div>
          <small>下一局即将开始</small>
        </header>

        {settlement.kind === "WIN" ? (
          <div className="settlement-formula" aria-label="胡牌倍率">
            <span>底分 {settlement.baseScore}</span>
            <i>×</i>
            <span>{settlement.winType === "HARD" ? "硬胡 2×" : "软胡 1×"}</span>
            <i>×</i>
            <span>赢家 {settlement.winnerMultiplier}×</span>
          </div>
        ) : (
          <p className="settlement-draw-note">无人自摸，本局仅保留已产生的杠分变化。</p>
        )}

        {settlement.payments.length > 0 ? (
          <div className="settlement-payments" aria-label="胡牌付款明细">
            {settlement.payments.map((payment) => (
              <span key={payment.payerSeat}>
                {playerName(payment.payerSeat)} · {payment.payerMultiplier}×<b>-{payment.amount}</b>
              </span>
            ))}
          </div>
        ) : null}

        <div className="settlement-score-list" aria-label="本局积分结算">
          {settlement.scoreChanges.map((change) => (
            <div key={change.seat} className={change.roundDelta > 0 ? "is-gain" : ""}>
              <strong>{playerName(change.seat)}</strong>
              <span>本局 {signedScore(change.roundDelta)}</span>
              <b>累计 {change.totalScore}</b>
            </div>
          ))}
        </div>
        <footer>本局净变化已包含碰杠相关得分</footer>
      </section>
    </div>
  );
}

type PrimaryActionType =
  | "DECLARE_WIN"
  | "CLAIM_EXPOSED_KONG"
  | "DECLARE_CONCEALED_KONG"
  | "CLAIM_PONG"
  | "CLAIM_INDICATOR_PONG_KONG"
  | "DECLARE_ADDED_KONG";

function PrimaryActionBar({
  room,
  self,
  selectedTileId,
  busy,
  onSend,
}: {
  room: RoomProjection;
  self: PlayerProjection;
  selectedTileId: string | null;
  busy: boolean;
  onSend: (type: PrimaryActionType, payload?: Record<string, unknown>) => void;
}) {
  const legal = room.legalActions;
  const hand = self.hand ?? [];

  const kongType: "CLAIM_EXPOSED_KONG" | "DECLARE_CONCEALED_KONG" | null = legal.includes(
    "CLAIM_EXPOSED_KONG",
  )
    ? "CLAIM_EXPOSED_KONG"
    : legal.includes("DECLARE_CONCEALED_KONG")
      ? "DECLARE_CONCEALED_KONG"
      : null;
  const pongType: "CLAIM_PONG" | "CLAIM_INDICATOR_PONG_KONG" | null = legal.includes("CLAIM_PONG")
    ? "CLAIM_PONG"
    : legal.includes("CLAIM_INDICATOR_PONG_KONG")
      ? "CLAIM_INDICATOR_PONG_KONG"
      : null;
  const winEnabled = legal.includes("DECLARE_WIN");
  const addedKongEnabled = legal.includes("DECLARE_ADDED_KONG");

  function clickWin() {
    if (!winEnabled || busy) return;
    onSend("DECLARE_WIN");
  }

  function clickKong() {
    if (kongType === null || busy) return;
    if (kongType === "CLAIM_EXPOSED_KONG") {
      onSend("CLAIM_EXPOSED_KONG");
      return;
    }
    const payload = deriveConcealedKongPayload(hand, room.wildcardKind, selectedTileId);
    onSend("DECLARE_CONCEALED_KONG", payload ?? undefined);
  }

  function clickPong() {
    if (pongType === null || busy) return;
    onSend(pongType);
  }

  function clickAddedKong() {
    if (!addedKongEnabled || busy) return;
    const payload = deriveAddedKongPayload(hand, self.melds, room.wildcardKind, selectedTileId);
    onSend("DECLARE_ADDED_KONG", payload ?? undefined);
  }

  const kongSubLabel =
    kongType === "CLAIM_EXPOSED_KONG"
      ? "明杠"
      : kongType === "DECLARE_CONCEALED_KONG"
        ? "暗杠"
        : "杠";
  const pongSubLabel =
    pongType === "CLAIM_PONG" ? "碰" : pongType === "CLAIM_INDICATOR_PONG_KONG" ? "亮牌碰" : "碰";

  return (
    <div className="primary-action-bar" aria-label="碰杠自摸大动作条">
      <button
        type="button"
        className={`primary-action-button ${winEnabled ? "is-armed" : ""}`}
        disabled={busy || !winEnabled}
        aria-label="自摸"
        onClick={clickWin}
      >
        <strong>自摸</strong>
      </button>
      <button
        type="button"
        className={`primary-action-button ${kongType !== null ? "is-armed" : ""}`}
        disabled={busy || kongType === null}
        aria-label={kongSubLabel}
        onClick={clickKong}
      >
        <strong>杠</strong>
        <small>{kongSubLabel}</small>
      </button>
      <button
        type="button"
        className={`primary-action-button ${pongType !== null ? "is-armed" : ""}`}
        disabled={busy || pongType === null}
        aria-label={pongSubLabel}
        onClick={clickPong}
      >
        <strong>碰</strong>
        <small>{pongSubLabel}</small>
      </button>
      <button
        type="button"
        className={`primary-action-button ${addedKongEnabled ? "is-armed" : ""}`}
        disabled={busy || !addedKongEnabled}
        aria-label="补杠"
        onClick={clickAddedKong}
      >
        <strong>补杠</strong>
      </button>
    </div>
  );
}

export function GameTable({
  room,
  busy,
  error,
  onReady,
  onLeave,
  onDissolve,
  onSend,
}: GameTableProps) {
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState("复制邀请");
  const [now, setNow] = useState(Date.now());
  const [actionNotice, setActionNotice] = useState<PlayerActionNotice | null>(null);
  const [landedHighlight, setLandedHighlight] = useState<LandedHighlight | null>(null);
  const actionSnapshotRef = useRef<PlayerActionSnapshot | null>(null);
  const selfSeat = room.selfSeat;
  const self = selfSeat === null ? null : playerAt(room, selfSeat);
  const selectedTile = self?.hand?.find((tile) => tile.id === selectedTileId) ?? null;

  useEffect(() => {
    if (
      selectedTileId !== null &&
      self?.hand?.some((tile) => tile.id === selectedTileId) !== true
    ) {
      setSelectedTileId(null);
    }
  }, [selectedTileId, self?.hand]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextSnapshot = createPlayerActionSnapshot(room.players);
    const previousSnapshot = actionSnapshotRef.current;
    actionSnapshotRef.current = nextSnapshot;
    if (previousSnapshot === null) return;

    const nextNotice = detectPlayerActionNotice(previousSnapshot, room.players);
    if (nextNotice !== null) {
      setActionNotice(nextNotice);
      const category = actionCategory(nextNotice.action);
      const meldId =
        category === "wildcard"
          ? null
          : findMeldIdByTileIds(
              playerAt(room, nextNotice.seat),
              nextNotice.tiles.map((tile) => tile.id),
            );
      setLandedHighlight({ seat: nextNotice.seat, category, meldId });
    }
  }, [room.players]);

  useEffect(() => {
    if (actionNotice === null) return;
    const timer = window.setTimeout(() => setActionNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (landedHighlight === null) return;
    const timer = window.setTimeout(() => setLandedHighlight(null), 750);
    return () => window.clearTimeout(timer);
  }, [landedHighlight]);

  const secondsRemaining =
    room.actionDeadlineAt === null
      ? null
      : Math.max(0, Math.ceil((Date.parse(room.actionDeadlineAt) - now) / 1000));

  const drawnTile = self?.hand?.find((tile) => tile.id === room.selfDrawnTileId) ?? null;
  const sortedHand = useMemo(
    () =>
      [...(self?.hand ?? [])]
        .filter((tile) => tile.id !== room.selfDrawnTileId)
        .sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank),
    [room.selfDrawnTileId, self?.hand],
  );
  const handHighlight = useMemo(
    () =>
      self === null
        ? { pongTileIds: new Set<string>(), kongTileIds: new Set<string>() }
        : handHighlightGroups(room, self),
    [room, self],
  );

  async function copyInvite() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.roomCode);
    await navigator.clipboard.writeText(url.toString());
    setInviteStatus("已复制");
    window.setTimeout(() => setInviteStatus("复制邀请"), 1600);
  }

  function sendAction(type: CommandEnvelope["type"]) {
    if (type === "DISCARD_TILE" || type === "RELEASE_WILDCARD") {
      if (selectedTile === null) return;
      void onSend(type, { tileId: selectedTile.id });
      return;
    }
    if (type === "DECLARE_CONCEALED_KONG") {
      if (selectedTile === null) return;
      void onSend(type, { suit: selectedTile.suit, rank: selectedTile.rank });
      return;
    }
    if (type === "DECLARE_ADDED_KONG") {
      if (selectedTile === null) return;
      const meld = self?.melds.find(
        (candidate) =>
          candidate.kind === "PONG" &&
          candidate.tileKind.suit === selectedTile.suit &&
          candidate.tileKind.rank === selectedTile.rank,
      );
      if (meld === undefined) return;
      void onSend(type, { meldId: meld.id, tileId: selectedTile.id });
      return;
    }
    void onSend(type);
  }

  function doubleClickDiscard(tile: Tile) {
    if (busy || !room.legalActions.includes("DISCARD_TILE")) return;
    void onSend("DISCARD_TILE", { tileId: tile.id });
  }

  if (selfSeat === null) {
    const selfWaiting = room.waitingPlayers.find((player) => player.isSelf);
    return (
      <main className="waiting-shell">
        <header className="room-header">
          <div>
            <span>房间</span>
            <strong>{room.roomCode}</strong>
          </div>
          <button type="button" onClick={() => void copyInvite()}>
            {inviteStatus}
          </button>
        </header>
        <section className="waiting-panel">
          <p className="eyebrow">WAITING ROOM</p>
          <h2>等待四位真人准备</h2>
          <p>当前机器人牌局不会影响真人局积分。四人全部准备后，会终止机器人局并随机庄家。</p>
          <div className="waiting-list">
            {room.players
              .filter((player) => player.controller === "HUMAN")
              .map((player) => (
                <span key={player.seat}>
                  {player.nickname}
                  <b>已入座</b>
                </span>
              ))}
            {room.waitingPlayers.map((player, index) => (
              <span key={`${player.nickname}-${index}`}>
                {player.nickname}
                <b>{player.ready ? "已准备" : "未准备"}</b>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="primary-action"
            disabled={busy || selfWaiting?.ready === true}
            onClick={() => void onReady()}
          >
            {selfWaiting?.ready === true ? "已准备，等待其他人" : "准备"}
          </button>
          <button type="button" className="text-action" onClick={() => void onLeave()}>
            离开房间
          </button>
        </section>
      </main>
    );
  }

  const actions = room.legalActions as CommandEnvelope["type"][];
  const handActions = actions.filter((action) => HAND_ACTIONS.has(action));
  const dockActions = actions.filter(
    (action) => !HAND_ACTIONS.has(action) && !PRIMARY_BAR_ACTIONS.has(action),
  );
  const needsTile = (action: CommandEnvelope["type"]) =>
    ["DISCARD_TILE", "RELEASE_WILDCARD", "DECLARE_CONCEALED_KONG", "DECLARE_ADDED_KONG"].includes(
      action,
    );

  return (
    <main className="game-shell">
      <header className="room-header game-header">
        <button type="button" className="quiet-action" onClick={() => void onLeave()}>
          离开房间
        </button>
        <div className="room-code">
          <span>ROOM</span>
          <strong>{room.roomCode}</strong>
        </div>
        <div className="game-meta">
          <span>底分 {room.baseScore}</span>
          <span>余牌 {room.wallRemaining}</span>
          {room.waitingPlayers.length > 0 ? (
            <button type="button" disabled={busy || room.selfReady} onClick={() => void onReady()}>
              {room.selfReady ? "已准备" : `准备真人局 · ${room.waitingPlayers.length}`}
            </button>
          ) : null}
          {room.isOwner ? (
            <button
              type="button"
              disabled={busy || room.dissolveAfterRound}
              onClick={() => void onDissolve()}
            >
              {room.dissolveAfterRound ? "本局后解散" : "结束房间"}
            </button>
          ) : null}
          <button type="button" onClick={() => void copyInvite()}>
            {inviteStatus}
          </button>
        </div>
      </header>

      <section className="table-surface" aria-label="晃晃牌桌">
        {SEATS.map((seat) => (
          <PlayerStation
            key={seat}
            player={playerAt(room, seat)}
            active={room.currentSeat === seat}
            position={relativePosition(seat, selfSeat)}
            landedMeldId={landedHighlight?.seat === seat ? landedHighlight.meldId : null}
            landedCategory={landedHighlight?.seat === seat ? landedHighlight.category : null}
          />
        ))}

        <div className="table-center">
          <div className="indicator-block">
            <span>亮牌</span>
            {room.indicatorTile === null ? (
              <i>无</i>
            ) : (
              <MahjongTile tile={room.indicatorTile} indicator compact />
            )}
          </div>
          <div className="turn-marker">
            <small>
              {room.roundPhase === "DISCARD_RESPONSE"
                ? "等待响应"
                : room.roundPhase === "ROUND_OVER"
                  ? "本局结束"
                  : secondsRemaining === null
                    ? "当前回合"
                    : `剩余 ${secondsRemaining} 秒`}
            </small>
            <b>
              {room.roundOutcome?.kind === "WIN"
                ? `${playerAt(room, room.roundOutcome.winnerSeat).nickname} · ${room.roundOutcome.winType === "HARD" ? "硬胡" : "软胡"}`
                : room.roundOutcome?.kind === "DRAW"
                  ? "流局"
                  : room.currentSeat === null
                    ? "等待"
                    : playerAt(room, room.currentSeat).nickname}
            </b>
          </div>
          <div className="wildcard-block">
            <span>赖子</span>
            <strong>{room.wildcardKind === null ? "无" : tileKindLabel(room.wildcardKind)}</strong>
          </div>
        </div>

        {actionNotice === null ? null : (
          <div
            key={`${room.version}-${actionNotice.seat}-${actionNotice.action}`}
            className={`player-action-notice ${ACTION_NOTICE_POSITION_CLASS[relativePosition(actionNotice.seat, selfSeat)] ?? ""}`}
            role="status"
            aria-label={playerActionNoticeLabel(room, actionNotice)}
          >
            <div
              className={`player-action-tiles action-${actionCategory(actionNotice.action)}`}
              aria-hidden="true"
            >
              {actionNotice.tiles.map((tile) => (
                <MahjongTile key={tile.id} tile={tile} wildcardKind={room.wildcardKind} compact />
              ))}
            </div>
          </div>
        )}

        {SEATS.map((seat) => (
          <DiscardZone
            key={`discards-${seat}`}
            player={playerAt(room, seat)}
            position={relativePosition(seat, selfSeat)}
            wildcardKind={room.wildcardKind}
          />
        ))}

        <section className="self-area">
          {self === null ? null : (
            <PrimaryActionBar
              room={room}
              self={self}
              selectedTileId={selectedTileId}
              busy={busy}
              onSend={(type, payload) => void onSend(type, payload)}
            />
          )}
          {handActions.length === 0 ? null : (
            <div className="hand-action-bar" aria-label="手牌操作">
              {handActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy || selectedTile === null}
                  onClick={() => sendAction(action)}
                >
                  {ACTION_LABELS[action] ?? action}
                </button>
              ))}
            </div>
          )}
          <div className="meld-row">
            {self?.melds.map((meld) => (
              <MeldGroup
                key={meld.id}
                meld={meld}
                landed={landedHighlight?.seat === selfSeat && meld.id === landedHighlight.meldId}
                category={landedHighlight?.seat === selfSeat ? landedHighlight.category : null}
              />
            ))}
          </div>
          <div className="hand-composition">
            <div className="hand-row">
              {sortedHand.map((tile: Tile) => (
                <MahjongTile
                  key={tile.id}
                  tile={tile}
                  wildcardKind={room.wildcardKind}
                  selected={tile.id === selectedTileId}
                  disabled={busy}
                  highlighted={
                    handHighlight.kongTileIds.has(tile.id) || handHighlight.pongTileIds.has(tile.id)
                  }
                  highlightHint={
                    handHighlight.kongTileIds.has(tile.id)
                      ? "可杠"
                      : handHighlight.pongTileIds.has(tile.id)
                        ? "可碰"
                        : undefined
                  }
                  onSelect={(next) =>
                    setSelectedTileId(next.id === selectedTileId ? null : next.id)
                  }
                  onDoubleSelect={doubleClickDiscard}
                />
              ))}
            </div>
            {drawnTile === null ? null : (
              <div className="drawn-tile-slot" title="本回合摸到的牌">
                <span aria-hidden="true">摸</span>
                <MahjongTile
                  tile={drawnTile}
                  wildcardKind={room.wildcardKind}
                  selected={drawnTile.id === selectedTileId}
                  disabled={busy}
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
                  onSelect={(next) =>
                    setSelectedTileId(next.id === selectedTileId ? null : next.id)
                  }
                  onDoubleSelect={doubleClickDiscard}
                />
              </div>
            )}
          </div>
        </section>
      </section>

      <div className="action-dock" aria-live="polite">
        <div className="action-status">
          {error ??
            (room.currentSeat === selfSeat || actions.length > 0
              ? "请选择牌或操作"
              : "等待其他玩家")}
        </div>
        <div className="action-buttons">
          {dockActions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy || (needsTile(action) && selectedTile === null)}
              onClick={() => sendAction(action)}
            >
              {ACTION_LABELS[action] ?? action}
            </button>
          ))}
        </div>
      </div>
      {room.roundSettlement === null ? null : (
        <RoundSettlementModal settlement={room.roundSettlement} players={room.players} />
      )}
      <div className="portrait-notice">请将设备横过来继续牌局</div>
    </main>
  );
}
