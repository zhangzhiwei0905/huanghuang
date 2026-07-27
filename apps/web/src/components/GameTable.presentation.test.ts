import type {
  ChatMessageProjection,
  PlayerProjection,
  RoomProjection,
  Seat,
  Tile,
} from "@huanghuang/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameTable } from "./GameTable.js";

function tile(id: string, rank: Tile["rank"], suit: Tile["suit"] = "WAN"): Tile {
  return { id, rank, suit };
}

function finalHand(seat: Seat): Tile[] {
  return [
    tile(`${seat}-wan-1-a`, 1),
    tile(`${seat}-wan-1-b`, 1),
    tile(`${seat}-wan-1-c`, 1),
    tile(`${seat}-tiao-2-a`, 2, "TIAO"),
    tile(`${seat}-tiao-3-a`, 3, "TIAO"),
  ];
}

function player(seat: Seat): PlayerProjection {
  const releasedWildcards =
    seat === 1 ? [tile("released-1", 3, "TIAO"), tile("released-2", 3, "TIAO")] : [];
  return {
    seat,
    nickname: `玩家${seat + 1}`,
    avatarUrl: null,
    controller: seat === 0 ? "HUMAN" : "BOT",
    connected: true,
    handCount: finalHand(seat).length,
    hand: seat === 0 ? finalHand(seat) : null,
    melds:
      seat === 0
        ? [
            {
              id: "self-pong",
              kind: "PONG",
              tileIds: ["self-pong-1", "self-pong-2", "self-pong-3"],
              tileKind: { suit: "TONG", rank: 6 },
              sourcePlayerId: "seat-1",
              sourceDiscardId: "discard-1",
              createdAtVersion: 8,
            },
          ]
        : [],
    discards: [],
    releasedWildcards,
    personalMultiplier: seat === 1 ? 4 : 1,
    score: seat === 0 ? 12 : -4,
  };
}

function resultRoom(): RoomProjection {
  const players = ([0, 1, 2, 3] as const).map(player);
  return {
    schemaVersion: 6,
    roomId: "room-1",
    roomCode: "123456",
    version: 12,
    baseScore: 2,
    turnTimeoutSeconds: 20,
    botDifficulty: "HIGH",
    mode: "FRIEND",
    stage: "ROUND_RESULT",
    roundId: "round-1",
    roundStartedAt: "2026-07-17T00:00:00.000Z",
    waitingExpiresAt: null,
    isOwner: true,
    selfRole: "PLAYER",
    selfReady: false,
    selfSeat: 0,
    selfDrawnTileId: null,
    status: "ACTIVE",
    closeReason: null,
    dissolveAfterRound: false,
    indicatorTile: tile("indicator", 2, "TIAO"),
    wildcardKind: { rank: 3, suit: "TIAO" },
    wallRemaining: 18,
    actingSeat: null,
    currentSeat: null,
    roundPhase: "ROUND_OVER",
    actionDeadlineAt: null,
    roundOutcome: { kind: "WIN", winnerSeat: 0, winType: "HARD", nextDealerSeat: 2 },
    roundSettlement: {
      roundId: "round-1",
      kind: "WIN",
      winnerSeat: 0,
      winType: "HARD",
      baseScore: 2,
      winBaseMultiplier: 2,
      winnerMultiplier: 1,
      nextDealerSeat: 2,
      payments: [
        { payerSeat: 1, payerMultiplier: 4, amount: 16 },
        { payerSeat: 2, payerMultiplier: 1, amount: 4 },
        { payerSeat: 3, payerMultiplier: 1, amount: 4 },
      ],
      finalHands: ([0, 1, 2, 3] as const).map((seat) => ({
        seat,
        tiles: finalHand(seat),
        personalMultiplier: seat === 1 ? 4 : 1,
      })),
      scoreChanges: [
        { seat: 0, roundDelta: 24, totalScore: 12 },
        { seat: 1, roundDelta: -16, totalScore: -4 },
        { seat: 2, roundDelta: -4, totalScore: -4 },
        { seat: 3, roundDelta: -4, totalScore: -4 },
      ],
    },
    effectCue: null,
    legalActions: [],
    tingHints: [],
    players,
    lobbySeats: ([0, 1, 2, 3] as const).map((seat) => ({
      seat,
      controller: seat === 0 ? "HUMAN" : "BOT",
      nickname: `玩家${seat + 1}`,
      avatarUrl: null,
      occupied: true,
      ready: false,
      connected: true,
      isOwner: seat === 0,
      isSelf: seat === 0,
      score: seat === 0 ? 12 : -4,
    })),
    spectators: [],
  };
}

const chatMessages: ChatMessageProjection[] = [
  {
    id: "chat-1",
    roomId: "room-1",
    senderSeat: 2,
    nickname: "玩家3",
    message: "等我一下",
    sentAt: "2026-07-17T00:01:00.000Z",
  },
];

const resolveVoid = () => Promise.resolve();
const resolveChat = () => Promise.resolve(true);

describe("game table presentation", () => {
  it("renders compact player state, avatar chat bubbles and the central wall count", () => {
    const markup = renderToStaticMarkup(
      createElement(GameTable, {
        room: resultRoom(),
        busy: false,
        connectionStatus: "connected",
        pendingAction: null,
        error: null,
        chatMessages,
        onReady: resolveVoid,
        onBaseScoreChange: resolveVoid,
        onBotDifficultyChange: resolveVoid,
        onAddBot: resolveVoid,
        onRemoveBot: resolveVoid,
        onContinue: resolveVoid,
        onChat: resolveChat,
        onLeave: resolveVoid,
        onDissolve: resolveVoid,
        onSend: resolveVoid,
      }),
    );

    expect(markup.match(/class="player-avatar"/g)).toHaveLength(4);
    expect(markup.match(/class="player-hand-count"/g)).toHaveLength(4);
    expect(markup).toContain("余牌 18");
    expect(markup).toContain("等我一下");
    expect(markup).toContain('class="chat-form"');
    expect(markup).toContain("×2");
    expect(markup.match(/aria-label="玩家1的公开组合"/g)).toHaveLength(1);
    expect(markup).toContain('title="PONG"');
    expect(markup).not.toContain('class="meld-row"');
    expect(markup).not.toContain("hidden-hand");
  });

  it("renders every final hand as SVG tiles with multipliers and signed score changes", () => {
    const markup = renderToStaticMarkup(
      createElement(GameTable, {
        room: resultRoom(),
        busy: false,
        connectionStatus: "connected",
        pendingAction: null,
        error: null,
        chatMessages: [],
        onReady: resolveVoid,
        onBaseScoreChange: resolveVoid,
        onBotDifficultyChange: resolveVoid,
        onAddBot: resolveVoid,
        onRemoveBot: resolveVoid,
        onContinue: resolveVoid,
        onChat: resolveChat,
        onLeave: resolveVoid,
        onDissolve: resolveVoid,
        onSend: resolveVoid,
      }),
    );

    expect(markup.match(/class="settlement-avatar"/g)).toHaveLength(4);
    expect(markup.match(/class="settlement-hand"/g)).toHaveLength(4);
    expect(markup.match(/class="tile-face-artwork"/g)?.length).toBeGreaterThanOrEqual(20);
    expect(markup).toContain("玩家1 硬胡");
    expect(markup).not.toContain("settlement-win-badge");
    expect(markup).not.toContain("settlement-formula");
    expect(markup).not.toContain("settlement-payments");
    expect(markup.match(/<small>倍率<\/small>/g)).toHaveLength(4);
    expect(markup.match(/<small>本局<\/small>/g)).toHaveLength(4);
    expect(markup.match(/<small>累计<\/small>/g)).toHaveLength(4);
    expect(markup).toContain("+24");
    expect(markup).toContain("-16");
  });

  it("renders pong, kong and pass together in the primary action bar", () => {
    const room: RoomProjection = {
      ...resultRoom(),
      stage: "PLAYING",
      roundPhase: "DISCARD_RESPONSE",
      roundOutcome: null,
      roundSettlement: null,
      actingSeat: 0,
      currentSeat: 1,
      legalActions: ["CLAIM_PONG", "CLAIM_EXPOSED_KONG", "PASS_RESPONSE"],
    };
    const markup = renderToStaticMarkup(
      createElement(GameTable, {
        room,
        busy: false,
        connectionStatus: "connected",
        pendingAction: null,
        error: null,
        chatMessages: [],
        onReady: resolveVoid,
        onBaseScoreChange: resolveVoid,
        onBotDifficultyChange: resolveVoid,
        onAddBot: resolveVoid,
        onRemoveBot: resolveVoid,
        onContinue: resolveVoid,
        onChat: resolveChat,
        onLeave: resolveVoid,
        onDissolve: resolveVoid,
        onSend: resolveVoid,
      }),
    );

    expect(markup).toContain("primary-action-button action-pong");
    expect(markup).toContain("primary-action-button action-kong");
    expect(markup).toContain("primary-action-button action-pass");
    expect(markup).not.toContain("aux-action action-pass");
  });

  it("renders an in-round spectator without exposing a hand, actions or chat input", () => {
    const room: RoomProjection = {
      ...resultRoom(),
      stage: "PLAYING",
      roundPhase: "TURN_DECISION",
      roundOutcome: null,
      roundSettlement: null,
      selfRole: "SPECTATOR",
      selfSeat: null,
      selfDrawnTileId: null,
      isOwner: false,
      actingSeat: 1,
      currentSeat: 1,
      legalActions: [],
      players: resultRoom().players.map((candidate) => ({ ...candidate, hand: null })),
      spectators: [
        {
          nickname: "候补玩家",
          avatarUrl: null,
          connected: true,
          isSelf: true,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(GameTable, {
        room,
        busy: false,
        connectionStatus: "connected",
        pendingAction: null,
        error: null,
        chatMessages: [],
        onReady: resolveVoid,
        onBaseScoreChange: resolveVoid,
        onBotDifficultyChange: resolveVoid,
        onAddBot: resolveVoid,
        onRemoveBot: resolveVoid,
        onContinue: resolveVoid,
        onChat: resolveChat,
        onLeave: resolveVoid,
        onDissolve: resolveVoid,
        onSend: resolveVoid,
      }),
    );

    expect(markup).toContain("观战中");
    expect(markup).toContain("观战候补 1");
    expect(markup).not.toContain('class="chat-form"');
    expect(markup).not.toContain('class="hand-tile');
    expect(markup).not.toContain("primary-action-button");
  });
});
