import type {
  BaseScore,
  BotDifficulty,
  ChatMessageProjection,
  CommandEnvelope,
  Meld,
  PlayerProjection,
  RoomProjection,
  RoundSettlementProjection,
  Seat,
  Tile,
} from "@huanghuang/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConnectionStatus } from "../hooks/useRoom.js";
import {
  deriveAddedKongPayload,
  deriveConcealedKongPayload,
  handHighlightGroups,
} from "./actionEligibility.js";
import {
  ACTION_BUTTON_IMAGES,
  hasValidTileSelection,
  isPrimaryGameAction,
  isWildcardTile,
  primaryActionButtons,
  type ActionButtonModel,
  type PrimaryGameAction,
} from "./actionButtons.js";
import { MahjongTile } from "./MahjongTile.js";
import { decideTilePress } from "./handInteraction.js";
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
  connectionStatus: ConnectionStatus;
  pendingAction: CommandEnvelope["type"] | null;
  error: string | null;
  chatMessages: ChatMessageProjection[];
  onReady: () => Promise<void>;
  onBaseScoreChange: (baseScore: BaseScore) => Promise<void>;
  onBotDifficultyChange: (difficulty: BotDifficulty) => Promise<void>;
  onAddBot: () => Promise<void>;
  onRemoveBot: (seat: Seat) => Promise<void>;
  onContinue: () => Promise<void>;
  onChat: (message: string) => Promise<boolean>;
  onLeave: () => Promise<void>;
  onDissolve: () => Promise<void>;
  onSend: (type: CommandEnvelope["type"], payload?: Record<string, unknown>) => Promise<void>;
};

const SEATS: readonly Seat[] = [0, 1, 2, 3];
const BASE_SCORES: readonly BaseScore[] = [1, 2, 5, 10];
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
const TILE_ACTIONS: readonly CommandEnvelope["type"][] = [
  "DISCARD_TILE",
  "RELEASE_WILDCARD",
  "DECLARE_CONCEALED_KONG",
  "DECLARE_ADDED_KONG",
];
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
  DISCARD_TILE: "出牌",
  CLAIM_PONG: "碰",
  CLAIM_EXPOSED_KONG: "明杠",
  CLAIM_INDICATOR_PONG_KONG: "亮牌碰杠",
  DECLARE_CONCEALED_KONG: "暗杠",
  DECLARE_ADDED_KONG: "补杠",
  PASS_RESPONSE: "过",
};

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
  self,
  position,
  wildcardKind,
  chatMessage,
  landedMeldId,
  landedCategory,
}: {
  player: PlayerProjection;
  active: boolean;
  self: boolean;
  position: number;
  wildcardKind: RoomProjection["wildcardKind"];
  chatMessage: ChatMessageProjection | null;
  landedMeldId: string | null;
  landedCategory: ActionCategory | null;
}) {
  const latestReleasedWildcard = player.releasedWildcards.at(-1) ?? null;
  return (
    <section
      className={`player-station ${POSITION_CLASS[position] ?? ""} ${self ? "is-self" : ""} ${active ? "is-active" : ""}`}
      aria-label={active ? `${player.nickname}，当前行动玩家` : player.nickname}
    >
      {active ? (
        <span className="turn-arrow" aria-hidden="true">
          ➜
        </span>
      ) : null}
      {active && self ? <span className="self-turn-label">你的回合</span> : null}
      {chatMessage === null ? null : (
        <div className="player-chat-bubble" role="status">
          {chatMessage.message}
        </div>
      )}
      <span className="player-avatar" aria-label={`${player.nickname}的头像，暂未设置`} />
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
        <b>{player.score} 分</b>
        <span>{player.personalMultiplier}×</span>
        <small className="player-hand-count">手牌 {player.handCount} 张</small>
      </div>
      {player.melds.length > 0 || player.releasedWildcards.length > 0 ? (
        <div className="player-melds" aria-label={`${player.nickname}的公开组合`}>
          {player.melds.map((meld) => (
            <MeldGroup
              key={meld.id}
              meld={meld}
              landed={meld.id === landedMeldId}
              category={landedCategory}
            />
          ))}
          {latestReleasedWildcard === null ? null : (
            <div
              className={`released-wildcard-zone ${landedCategory === "wildcard" ? "is-landed" : ""}`}
              aria-label={`已放赖 ${player.releasedWildcards.length} 次，当前倍率 ${player.personalMultiplier} 倍`}
            >
              <MahjongTile tile={latestReleasedWildcard} wildcardKind={wildcardKind} compact />
              <b aria-hidden="true">×{player.releasedWildcards.length}</b>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DiscardZone({
  player,
  position,
  wildcardKind,
  recentDiscardId,
}: {
  player: PlayerProjection;
  position: number;
  wildcardKind: RoomProjection["wildcardKind"];
  recentDiscardId: string | null;
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
            <MahjongTile
              key={tile.id}
              tile={tile}
              wildcardKind={wildcardKind}
              compact
              motion={tile.id === recentDiscardId ? "discarded" : undefined}
            />
          ))
        )}
      </div>
    </section>
  );
}

function deadlineSeconds(deadline: string | null): number | null {
  return deadline === null
    ? null
    : Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));
}

function WaitingRoomExpiry({ expiresAt }: { expiresAt: string | null }) {
  const [secondsRemaining, setSecondsRemaining] = useState(() => deadlineSeconds(expiresAt));

  useEffect(() => {
    const update = () => setSecondsRemaining(deadlineSeconds(expiresAt));
    update();
    if (expiresAt === null) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (secondsRemaining === null) return null;
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = String(secondsRemaining % 60).padStart(2, "0");
  return (
    <p className={`waiting-expiry ${secondsRemaining <= 30 ? "is-urgent" : ""}`} role="timer">
      {secondsRemaining === 0
        ? "等待时间已结束，正在关闭房间…"
        : `未开局将在 ${minutes}:${seconds} 后自动解散`}
    </p>
  );
}

function TurnMarker({
  room,
  selfSeat,
  connectionStatus,
  pendingAction,
}: {
  room: RoomProjection;
  selfSeat: Seat | null;
  connectionStatus: ConnectionStatus;
  pendingAction: CommandEnvelope["type"] | null;
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    deadlineSeconds(room.actionDeadlineAt),
  );

  useEffect(() => {
    const update = () => setSecondsRemaining(deadlineSeconds(room.actionDeadlineAt));
    update();
    if (room.actionDeadlineAt === null) return;
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [room.actionDeadlineAt]);

  const selfTurn = room.actingSeat === selfSeat;
  const urgent = secondsRemaining !== null && secondsRemaining <= 5;
  const stateLabel =
    connectionStatus === "connecting"
      ? "正在连接"
      : connectionStatus === "reconnecting"
        ? "正在恢复"
        : pendingAction !== null
          ? "服务器确认中"
          : room.roundPhase === "DISCARD_RESPONSE"
            ? "等待响应"
            : room.roundPhase === "ROUND_OVER"
              ? "本局结束"
              : selfTurn
                ? "轮到你"
                : "当前回合";
  const actorLabel =
    room.roundOutcome?.kind === "WIN"
      ? `${playerAt(room, room.roundOutcome.winnerSeat).nickname} · ${room.roundOutcome.winType === "HARD" ? "硬胡" : "软胡"}`
      : room.roundOutcome?.kind === "DRAW"
        ? "流局"
        : pendingAction !== null
          ? (ACTION_LABELS[pendingAction] ?? pendingAction)
          : room.actingSeat === null
            ? "等待"
            : playerAt(room, room.actingSeat).nickname;

  return (
    <div
      className={`turn-marker ${selfTurn ? "is-self-turn" : ""} ${urgent ? "is-urgent" : ""} ${connectionStatus !== "connected" || pendingAction !== null ? "is-network-wait" : ""}`}
      role="status"
    >
      <small>{stateLabel}</small>
      <b>{actorLabel}</b>
      <div className="turn-stats">
        <span className="wall-remaining" aria-label={`牌墙剩余 ${room.wallRemaining} 张`}>
          余牌 {room.wallRemaining}
        </span>
        {secondsRemaining === null ||
        room.roundPhase === "ROUND_OVER" ||
        connectionStatus !== "connected" ||
        pendingAction !== null ? null : (
          <span className="turn-countdown" aria-label={`剩余 ${secondsRemaining} 秒`}>
            {secondsRemaining}
            <i>秒</i>
          </span>
        )}
      </div>
    </div>
  );
}

function AnimatedHandRow({
  tiles,
  motionEnabled,
  renderTile,
}: {
  tiles: Tile[];
  motionEnabled: boolean;
  renderTile: (tile: Tile) => ReactNode;
}) {
  const nodesRef = useRef(new Map<string, HTMLSpanElement>());
  const positionsRef = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const nextPositions = new Map<string, DOMRect>();
    for (const tile of tiles) {
      const node = nodesRef.current.get(tile.id);
      if (node !== undefined) nextPositions.set(tile.id, node.getBoundingClientRect());
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (motionEnabled && !reduceMotion && positionsRef.current.size > 0) {
      for (const tile of tiles) {
        const node = nodesRef.current.get(tile.id);
        const next = nextPositions.get(tile.id);
        if (node === undefined || next === undefined) continue;
        node.getAnimations().forEach((animation) => animation.cancel());
        const previous = positionsRef.current.get(tile.id);
        if (previous === undefined) {
          node.animate(
            [
              { opacity: 0.55, transform: "translate3d(18px, 0, 0)" },
              { opacity: 1, transform: "translate3d(0, 0, 0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
          continue;
        }
        const deltaX = previous.left - next.left;
        if (Math.abs(deltaX) < 0.5) continue;
        node.animate(
          [{ transform: `translate3d(${deltaX}px, 0, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    }
    positionsRef.current = nextPositions;
  }, [motionEnabled, tiles]);

  return (
    <div className="hand-row">
      {tiles.map((tile) => (
        <span
          key={tile.id}
          className="hand-tile-shell"
          ref={(node) => {
            if (node === null) nodesRef.current.delete(tile.id);
            else nodesRef.current.set(tile.id, node);
          }}
        >
          {renderTile(tile)}
        </span>
      ))}
    </div>
  );
}

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function sortedTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank);
}

function RoundSettlementModal({
  settlement,
  players,
  wildcardKind,
  mode,
  busy,
  onContinue,
  onLeave,
}: {
  settlement: RoundSettlementProjection;
  players: PlayerProjection[];
  wildcardKind: RoomProjection["wildcardKind"];
  mode: RoomProjection["mode"];
  busy: boolean;
  onContinue: () => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const playerName = (seat: Seat) => players[seat]?.nickname ?? `玩家 ${seat + 1}`;
  const outcomeLabel =
    settlement.kind === "DRAW"
      ? "本局流局"
      : `${playerName(settlement.winnerSeat ?? 0)} ${settlement.winType === "HARD" ? "硬胡" : "软胡"}`;
  const outcomeClass =
    settlement.kind === "DRAW"
      ? "is-draw"
      : settlement.winType === "HARD"
        ? "is-hard-win"
        : "is-soft-win";

  return (
    <div className="round-settlement-backdrop">
      <section
        className={`round-settlement-modal ${outcomeClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-settlement-title"
      >
        <header>
          <div>
            <span>ROUND RESULT</span>
            <h2 id="round-settlement-title">{outcomeLabel}</h2>
          </div>
          <div className="settlement-result-meta">
            <small>{mode === "BOT" ? "等待你的选择" : "即将返回房间准备"}</small>
          </div>
        </header>

        <div className="settlement-player-list" aria-label="本局终局手牌与积分">
          {settlement.finalHands.map((finalHand) => {
            const change = settlement.scoreChanges.find((item) => item.seat === finalHand.seat);
            const winner = settlement.winnerSeat === finalHand.seat;
            return (
              <article
                key={finalHand.seat}
                className={`${winner ? "is-winner" : ""} ${change !== undefined && change.roundDelta > 0 ? "is-gain" : ""}`}
              >
                <span
                  className="settlement-avatar"
                  aria-label={`${playerName(finalHand.seat)}的头像，暂未设置`}
                />
                <div className="settlement-player-identity">
                  <strong>{playerName(finalHand.seat)}</strong>
                  <small>{winner ? "本局赢家" : `座位 ${finalHand.seat + 1}`}</small>
                </div>
                <div
                  className="settlement-hand"
                  aria-label={`${playerName(finalHand.seat)}的终局手牌`}
                >
                  {sortedTiles(finalHand.tiles).map((tile) => (
                    <MahjongTile key={tile.id} tile={tile} wildcardKind={wildcardKind} compact />
                  ))}
                </div>
                <div className="settlement-player-multiplier">
                  <small>倍率</small>
                  <b>{finalHand.personalMultiplier}×</b>
                </div>
                <div className="settlement-player-score">
                  <span>
                    <small>本局</small>
                    <strong>{change === undefined ? "0" : signedScore(change.roundDelta)}</strong>
                  </span>
                  <span>
                    <small>累计</small>
                    <b>{change?.totalScore ?? 0}</b>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
        {mode === "BOT" ? (
          <footer className="has-actions">
            <div className="settlement-actions">
              <button type="button" disabled={busy} onClick={() => void onLeave()}>
                退出到主页
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={busy}
                onClick={() => void onContinue()}
              >
                继续游戏
              </button>
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function PrimaryActionBar({
  room,
  self,
  selectedTile,
  busy,
  onSend,
}: {
  room: RoomProjection;
  self: PlayerProjection;
  selectedTile: Tile | null;
  busy: boolean;
  onSend: (type: PrimaryGameAction, payload?: Record<string, unknown>) => void;
}) {
  const hand = self.hand ?? [];
  const buttons = primaryActionButtons(room.legalActions);
  if (buttons.length === 0) return null;

  const selectedIsWildcard = isWildcardTile(selectedTile, room.wildcardKind);

  function detailFor(button: ActionButtonModel): string {
    if (button.kind === "discard") {
      return selectedTile !== null && !selectedIsWildcard
        ? `打出 ${tileKindLabel(selectedTile)}`
        : "选择手牌";
    }
    if (button.kind === "wildcard") {
      return selectedIsWildcard && selectedTile !== null
        ? `放出 ${tileKindLabel(selectedTile)}`
        : button.detail;
    }
    return button.detail;
  }

  function isDisabled(button: ActionButtonModel): boolean {
    if (busy) return true;
    return !hasValidTileSelection(button.action, selectedTile, room.wildcardKind);
  }

  function clickAction(button: ActionButtonModel) {
    if (isDisabled(button)) return;
    if (button.action === "DISCARD_TILE" || button.action === "RELEASE_WILDCARD") {
      if (selectedTile !== null) onSend(button.action, { tileId: selectedTile.id });
      return;
    }
    if (button.action === "DECLARE_CONCEALED_KONG") {
      const payload = deriveConcealedKongPayload(hand, room.wildcardKind, selectedTile?.id ?? null);
      onSend(button.action, payload ?? undefined);
      return;
    }
    if (button.action === "DECLARE_ADDED_KONG") {
      const payload = deriveAddedKongPayload(
        hand,
        self.melds,
        room.wildcardKind,
        selectedTile?.id ?? null,
      );
      onSend(button.action, payload ?? undefined);
      return;
    }
    onSend(button.action);
  }

  return (
    <div className="primary-action-bar" aria-label="当前可用操作" aria-busy={busy}>
      {buttons.map((button) => {
        const detail = detailFor(button);
        return (
          <button
            key={button.kind}
            type="button"
            className={`primary-action-button action-${button.kind}`}
            disabled={isDisabled(button)}
            aria-label={`${button.label}，${detail}`}
            onClick={() => clickAction(button)}
          >
            <img
              className="primary-action-art"
              src={ACTION_BUTTON_IMAGES[button.kind]}
              alt=""
              aria-hidden="true"
            />
            <small className="primary-action-detail">{detail}</small>
          </button>
        );
      })}
    </div>
  );
}

export function GameTable({
  room,
  busy,
  connectionStatus,
  pendingAction,
  error,
  chatMessages,
  onReady,
  onBaseScoreChange,
  onBotDifficultyChange,
  onAddBot,
  onRemoveBot,
  onContinue,
  onChat,
  onLeave,
  onDissolve,
  onSend,
}: GameTableProps) {
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState("复制邀请");
  const [actionNotice, setActionNotice] = useState<PlayerActionNotice | null>(null);
  const [landedHighlight, setLandedHighlight] = useState<LandedHighlight | null>(null);
  const [showRoundStart, setShowRoundStart] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const actionSnapshotRef = useRef<PlayerActionSnapshot | null>(null);
  const displayedRoundIdRef = useRef<string | null>(null);
  const discardTailRef = useRef(
    new Map(room.players.map((player) => [player.seat, player.discards.at(-1)?.id ?? null])),
  );
  const previousDrawnTileIdRef = useRef(room.selfDrawnTileId);
  const selfSeat = room.selfSeat;
  const self = selfSeat === null || room.stage === "WAITING" ? null : playerAt(room, selfSeat);
  const selectedTile = self?.hand?.find((tile) => tile.id === selectedTileId) ?? null;
  const interactionLocked = busy || connectionStatus !== "connected";

  useEffect(() => {
    if (
      selectedTileId !== null &&
      self?.hand?.some((tile) => tile.id === selectedTileId) !== true
    ) {
      setSelectedTileId(null);
    }
  }, [selectedTileId, self?.hand]);

  useEffect(() => {
    if (room.players.length !== 4) {
      actionSnapshotRef.current = null;
      return;
    }
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

  useEffect(() => {
    if (room.stage !== "PLAYING" || room.roundId === null) {
      setShowRoundStart(false);
      if (room.stage === "WAITING") displayedRoundIdRef.current = null;
      return;
    }
    if (displayedRoundIdRef.current === room.roundId) return;
    displayedRoundIdRef.current = room.roundId;
    const startedAt = room.roundStartedAt === null ? Number.NaN : Date.parse(room.roundStartedAt);
    const roundAge = Date.now() - startedAt;
    if (!Number.isFinite(startedAt) || roundAge < -1000 || roundAge > 5000) return;
    setShowRoundStart(true);
    const timer = window.setTimeout(() => setShowRoundStart(false), 2400);
    return () => window.clearTimeout(timer);
  }, [room.roundId, room.roundStartedAt, room.stage]);

  const drawnTile = self?.hand?.find((tile) => tile.id === room.selfDrawnTileId) ?? null;
  const animateDrawnTile =
    connectionStatus === "connected" &&
    drawnTile !== null &&
    previousDrawnTileIdRef.current !== drawnTile.id;
  const recentDiscardIds = new Map<Seat, string>();
  if (connectionStatus === "connected") {
    for (const player of room.players) {
      const currentTail = player.discards.at(-1)?.id ?? null;
      const previousTail = discardTailRef.current.get(player.seat);
      if (previousTail !== undefined && currentTail !== null && currentTail !== previousTail) {
        recentDiscardIds.set(player.seat, currentTail);
      }
    }
  }

  useLayoutEffect(() => {
    discardTailRef.current = new Map(
      room.players.map((player) => [player.seat, player.discards.at(-1)?.id ?? null]),
    );
    previousDrawnTileIdRef.current = room.selfDrawnTileId;
  }, [connectionStatus, room.players, room.selfDrawnTileId]);
  const sortedHand = useMemo(
    () => sortedTiles((self?.hand ?? []).filter((tile) => tile.id !== room.selfDrawnTileId)),
    [room.selfDrawnTileId, self?.hand],
  );
  const latestChatBySeat = useMemo(() => {
    const latest = new Map<Seat, ChatMessageProjection>();
    for (const message of chatMessages) latest.set(message.senderSeat, message);
    return latest;
  }, [chatMessages]);
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

  async function submitChat() {
    const message = chatDraft.trim();
    if (message.length === 0 || chatSending) return;
    setChatSending(true);
    try {
      if (await onChat(message)) setChatDraft("");
    } finally {
      setChatSending(false);
    }
  }

  function pressHandTile(tile: Tile) {
    const decision = decideTilePress({
      tile,
      selectedTileId,
      wildcardKind: room.wildcardKind,
      canDiscard: room.legalActions.includes("DISCARD_TILE"),
      locked: interactionLocked,
    });
    if (decision.kind === "select") {
      setSelectedTileId(decision.tileId);
      return;
    }
    if (decision.kind === "discard") {
      void onSend("DISCARD_TILE", { tileId: decision.tileId });
    }
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

  if (room.stage === "WAITING") {
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
          <h2>等待玩家准备</h2>
          <p>房主可用机器人补齐空位。所有真人准备后自动开始，机器人默认已准备。</p>
          <WaitingRoomExpiry expiresAt={room.waitingExpiresAt} />
          {connectionStatus === "connected" ? null : (
            <p className="network-inline-status" role="status">
              {connectionStatus === "connecting" ? "正在连接房间…" : "网络已中断，正在恢复房间…"}
            </p>
          )}
          <div className="waiting-list">
            {room.lobbySeats.map((seat) => (
              <article
                key={seat.seat}
                className={`${seat.occupied ? "is-occupied" : "is-empty"} ${seat.ready ? "is-ready" : ""}`}
              >
                <span>座位 {seat.seat + 1}</span>
                <strong>
                  {seat.nickname ?? "等待加入"}
                  {seat.isSelf ? " · 你" : ""}
                </strong>
                <small>
                  {!seat.occupied
                    ? "空位"
                    : seat.controller === "BOT"
                      ? "机器人 · 自动准备"
                      : seat.ready
                        ? "已准备"
                        : seat.connected
                          ? "未准备"
                          : "离线"}
                  {seat.isOwner ? " · 房主" : ""}
                </small>
                <b>{seat.score} 分</b>
                {room.isOwner && seat.controller === "BOT" ? (
                  <button
                    type="button"
                    className="seat-bot-remove"
                    disabled={interactionLocked}
                    onClick={() => void onRemoveBot(seat.seat)}
                  >
                    移除
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {room.isOwner && room.lobbySeats.some((seat) => !seat.occupied) ? (
            <button
              type="button"
              className="bot-add-button"
              disabled={interactionLocked}
              onClick={() => void onAddBot()}
            >
              添加机器人
            </button>
          ) : null}
          <fieldset className="room-score-settings">
            <legend>本房间底分</legend>
            <div className="score-options">
              {BASE_SCORES.map((score) => (
                <button
                  type="button"
                  key={score}
                  className={score === room.baseScore ? "is-active" : ""}
                  disabled={interactionLocked || !room.isOwner}
                  onClick={() => void onBaseScoreChange(score)}
                >
                  {score} 分
                </button>
              ))}
            </div>
            <small>{room.isOwner ? "修改底分后全员需要重新准备" : "仅房主可修改底分"}</small>
          </fieldset>
          <fieldset className="room-score-settings">
            <legend>机器人难度</legend>
            <div className="score-options">
              {(["LOW", "HIGH"] as const).map((difficulty) => (
                <button
                  type="button"
                  key={difficulty}
                  className={difficulty === room.botDifficulty ? "is-active" : ""}
                  disabled={interactionLocked || !room.isOwner}
                  onClick={() => void onBotDifficultyChange(difficulty)}
                >
                  {difficulty === "LOW" ? "低 · 只硬胡" : "高 · 可软胡"}
                </button>
              ))}
            </div>
            <small>
              {room.isOwner ? "难度修改后全员需要重新准备" : "本房间机器人使用统一难度"}
            </small>
          </fieldset>
          <button
            type="button"
            className={room.selfReady ? "ready-toggle is-ready" : "primary-action ready-toggle"}
            disabled={interactionLocked || room.selfSeat === null}
            onClick={() => void onReady()}
          >
            {room.selfReady ? "取消准备" : "准备"}
          </button>
          {room.isOwner ? (
            <button
              type="button"
              className="text-action danger-action"
              disabled={interactionLocked}
              onClick={() => void onDissolve()}
            >
              解散房间
            </button>
          ) : null}
          <button
            type="button"
            className="text-action"
            disabled={interactionLocked}
            onClick={() => void onLeave()}
          >
            离开房间
          </button>
        </section>
      </main>
    );
  }

  const viewSeat = selfSeat ?? 0;
  const actions = room.legalActions as CommandEnvelope["type"][];
  const dockActions = actions.filter((action) => !isPrimaryGameAction(action));
  const canSelectHand = actions.some((action) => TILE_ACTIONS.includes(action));
  const selfTurn = selfSeat !== null && room.actingSeat === selfSeat;
  const statusMessage =
    connectionStatus === "connecting"
      ? "正在连接牌局…"
      : connectionStatus === "reconnecting"
        ? "网络已中断，正在恢复牌局…"
        : pendingAction === null
          ? error
          : `正在提交“${ACTION_LABELS[pendingAction] ?? pendingAction}”，等待服务器确认…`;

  return (
    <main className={`game-shell ${selfTurn ? "is-self-turn" : ""}`} aria-busy={interactionLocked}>
      <header className="room-header game-header">
        <button type="button" className="quiet-action" onClick={() => void onLeave()}>
          离开房间
        </button>
        <div className="room-code">
          <span>{room.mode === "BOT" ? "MODE" : "ROOM"}</span>
          <strong>{room.mode === "BOT" ? "人机对战" : room.roomCode}</strong>
        </div>
        <div className="game-meta">
          <span>底分 {room.baseScore}</span>
          {room.mode === "FRIEND" && room.isOwner ? (
            <button
              type="button"
              className="danger-action"
              disabled={interactionLocked}
              onClick={() => void onDissolve()}
            >
              解散房间
            </button>
          ) : null}
          {room.mode === "FRIEND" ? (
            <button type="button" onClick={() => void copyInvite()}>
              {inviteStatus}
            </button>
          ) : null}
        </div>
      </header>

      <section className={`table-surface ${selfTurn ? "is-self-turn" : ""}`} aria-label="晃晃牌桌">
        {SEATS.map((seat) => (
          <PlayerStation
            key={seat}
            player={playerAt(room, seat)}
            active={room.actingSeat === seat}
            self={selfSeat !== null && seat === selfSeat}
            position={relativePosition(seat, viewSeat)}
            wildcardKind={room.wildcardKind}
            chatMessage={latestChatBySeat.get(seat) ?? null}
            landedMeldId={landedHighlight?.seat === seat ? landedHighlight.meldId : null}
            landedCategory={landedHighlight?.seat === seat ? landedHighlight.category : null}
          />
        ))}

        <div className="table-center">
          <div className={`indicator-block ${showRoundStart ? "is-revealing" : ""}`}>
            <span className="special-tile-label">亮牌</span>
            {room.indicatorTile === null ? (
              <i>无</i>
            ) : (
              <MahjongTile tile={room.indicatorTile} indicator compact />
            )}
          </div>
          <TurnMarker
            room={room}
            selfSeat={selfSeat}
            connectionStatus={connectionStatus}
            pendingAction={pendingAction}
          />
          <div className={`wildcard-block ${showRoundStart ? "is-revealing" : ""}`}>
            <span className="special-tile-label">赖子</span>
            {room.wildcardKind === null ? (
              <i>无</i>
            ) : (
              <MahjongTile
                tile={{ id: "wildcard-kind-preview", ...room.wildcardKind }}
                wildcardKind={room.wildcardKind}
                compact
              />
            )}
          </div>
        </div>

        {showRoundStart ? (
          <div className="round-start-notice" role="status" aria-live="polite">
            <span>ROUND START</span>
            <strong>本局开始</strong>
          </div>
        ) : null}

        {actionNotice === null ? null : (
          <div
            key={`${room.version}-${actionNotice.seat}-${actionNotice.action}`}
            className={`player-action-notice ${ACTION_NOTICE_POSITION_CLASS[relativePosition(actionNotice.seat, viewSeat)] ?? ""}`}
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
            position={relativePosition(seat, viewSeat)}
            wildcardKind={room.wildcardKind}
            recentDiscardId={recentDiscardIds.get(seat) ?? null}
          />
        ))}

        {selfSeat === null ? (
          <div className="spectator-banner" role="status">
            <strong>观战中</strong>
            <span>本局结束后自动替换机器人入座</span>
          </div>
        ) : null}

        <section className={`self-area ${selfTurn ? "is-self-turn" : ""}`}>
          {self === null ? null : (
            <PrimaryActionBar
              room={room}
              self={self}
              selectedTile={selectedTile}
              busy={interactionLocked}
              onSend={(type, payload) => void onSend(type, payload)}
            />
          )}
          <div className="hand-composition">
            <AnimatedHandRow
              tiles={sortedHand}
              motionEnabled={connectionStatus === "connected"}
              renderTile={(tile) => (
                <MahjongTile
                  key={tile.id}
                  tile={tile}
                  wildcardKind={room.wildcardKind}
                  selected={tile.id === selectedTileId}
                  disabled={interactionLocked || !canSelectHand}
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
                  onSelect={pressHandTile}
                />
              )}
            />
            {drawnTile === null ? null : (
              <div className="drawn-tile-slot" title="本回合摸到的牌">
                <span aria-hidden="true">摸</span>
                <MahjongTile
                  tile={drawnTile}
                  wildcardKind={room.wildcardKind}
                  selected={drawnTile.id === selectedTileId}
                  disabled={interactionLocked || !canSelectHand}
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
                  motion={animateDrawnTile ? "drawn" : undefined}
                  onSelect={pressHandTile}
                />
              </div>
            )}
          </div>
        </section>
      </section>

      <div className="action-dock" aria-live="polite">
        {room.mode === "FRIEND" && selfSeat !== null ? (
          <>
            <div className="action-status">
              {statusMessage ??
                (room.actingSeat === selfSeat || actions.length > 0
                  ? "请选择牌或操作"
                  : "等待其他玩家")}
            </div>
            <form
              className="chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitChat();
              }}
            >
              <input
                value={chatDraft}
                maxLength={60}
                aria-label="发送房间消息"
                placeholder="说点什么…"
                onChange={(event) => setChatDraft(event.target.value)}
              />
              <button type="submit" disabled={chatSending || chatDraft.trim().length === 0}>
                发送
              </button>
            </form>
          </>
        ) : (
          <div className="action-status">
            {selfSeat === null
              ? `观战候补 ${room.spectators.findIndex((spectator) => spectator.isSelf) + 1} · 本局结束后自动入座`
              : (statusMessage ??
                (room.actingSeat === selfSeat || actions.length > 0
                  ? "请选择牌或操作"
                  : "等待其他玩家"))}
          </div>
        )}
        <div className="action-buttons">
          {dockActions.map((action) => (
            <button
              key={action}
              type="button"
              className="aux-action"
              disabled={interactionLocked}
              onClick={() => sendAction(action)}
            >
              {ACTION_LABELS[action] ?? action}
            </button>
          ))}
        </div>
      </div>
      {room.roundSettlement === null ? null : (
        <RoundSettlementModal
          settlement={room.roundSettlement}
          players={room.players}
          wildcardKind={room.wildcardKind}
          mode={room.mode}
          busy={busy}
          onContinue={onContinue}
          onLeave={onLeave}
        />
      )}
      <div className="portrait-notice">请将设备横过来继续牌局</div>
    </main>
  );
}
