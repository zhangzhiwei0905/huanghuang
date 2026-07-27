import type {
  BaseScore,
  BotDifficulty,
  ChatMessageProjection,
  CommandEnvelope,
  RoomProjection,
  Seat,
} from "@huanghuang/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-mp";
import { ApiError, createCommand, roomApi, type CommandAcknowledge } from "../api/http";
import { getStoredSessionToken } from "../api/session";
import { API_BASE } from "../config";
import { errorLabel } from "../lib/errors";
import { normalizeRoomProjection } from "../lib/roomProjection";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

type RoomController = {
  room: RoomProjection | null;
  busy: boolean;
  connectionStatus: ConnectionStatus;
  pendingAction: CommandEnvelope["type"] | null;
  error: string | null;
  notice: string | null;
  openRoom: (projection: RoomProjection) => void;
  leaveRoom: () => Promise<void>;
  dissolve: () => Promise<void>;
  ready: () => Promise<void>;
  updateBaseScore: (baseScore: BaseScore) => Promise<void>;
  updateBotDifficulty: (difficulty: BotDifficulty) => Promise<void>;
  addBot: () => Promise<void>;
  removeBot: (seat: Seat) => Promise<void>;
  continueBot: () => Promise<void>;
  send: (type: CommandEnvelope["type"], payload?: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  clearNotice: () => void;
  lastChatMessage: ChatMessageProjection | null;
  sendVoiceMessage: (message: string) => void;
};

const COMMAND_ACK_TIMEOUT_MS = 8000;

const ROOM_CLOSE_NOTICES: Record<NonNullable<RoomProjection["closeReason"]>, string> = {
  OWNER_DISSOLVED: "房主已解散房间",
  WAITING_TIMEOUT: "3 分钟未开始，房间已解散，请重新创建或加入房间",
  EMPTY_ROOM: "房间已关闭，请重新创建或加入房间",
};

function emitCommandWithTimeout(
  socket: Socket,
  command: CommandEnvelope,
): Promise<CommandAcknowledge> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("COMMAND_ACK_TIMEOUT"));
    }, COMMAND_ACK_TIMEOUT_MS);

    socket.emit("game:command", command, (acknowledgement: CommandAcknowledge) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(acknowledgement);
    });
  });
}

export function useRoom(): RoomController {
  const [room, setRoom] = useState<RoomProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [pendingAction, setPendingAction] = useState<CommandEnvelope["type"] | null>(null);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastChatMessage, setLastChatMessage] = useState<ChatMessageProjection | null>(null);
  const roomRef = useRef(room);
  const socketRef = useRef<Socket | null>(null);
  const mutationInFlightRef = useRef(false);
  const hasEverConnectedRef = useRef(false);
  roomRef.current = room;

  const clearLocalRoom = useCallback((message: string | null = null) => {
    roomRef.current = null;
    setRoom(null);
    setError(null);
    setNotice(message);
  }, []);

  const replaceProjection = useCallback(
    (next: RoomProjection) => {
      const normalized = normalizeRoomProjection(next);
      if (normalized.status === "CLOSED") {
        clearLocalRoom(
          normalized.closeReason === null
            ? "房间已关闭，请重新创建或加入房间"
            : ROOM_CLOSE_NOTICES[normalized.closeReason],
        );
        return;
      }
      setRoom((current) =>
        current === null || normalized.version >= current.version ? normalized : current,
      );
      setError(null);
    },
    [clearLocalRoom],
  );

  const refresh = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    try {
      replaceProjection(await roomApi.get(current.roomCode));
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.code === "ROOM_NOT_FOUND" || cause.code === "NOT_A_MEMBER")
      ) {
        clearLocalRoom("房间已关闭，请重新创建或加入房间");
        return;
      }
      setError("无法同步牌局，请检查网络连接");
    }
  }, [clearLocalRoom, replaceProjection]);

  const runExclusive = useCallback(
    async (
      action: CommandEnvelope["type"] | null,
      mutation: () => Promise<void>,
    ): Promise<boolean> => {
      if (mutationInFlightRef.current) return false;
      mutationInFlightRef.current = true;
      setBusy(true);
      setPendingAction(action);
      try {
        await mutation();
        return true;
      } finally {
        mutationInFlightRef.current = false;
        setPendingAction(null);
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const current = room;
    if (current === null) return;
    const token = getStoredSessionToken();
    // socket.io-mp uses WeChat native WebSocket; browser socket.io-client does not work in devtools.
    const socket: Socket = io(API_BASE, {
      autoConnect: false,
      withCredentials: false,
      timeout: 8000,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: token !== null ? { token } : {},
    });
    let connectedTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    socketRef.current = socket;

    const markConnectedAfterProjection = () => {
      if (disposed) return;
      if (connectedTimer !== null) clearTimeout(connectedTimer);
      connectedTimer = setTimeout(() => setConnectionStatus("connected"), 0);
    };
    const subscribe = () => {
      if (disposed) return;
      setConnectionStatus(hasEverConnectedRef.current ? "reconnecting" : "connecting");
      hasEverConnectedRef.current = true;
      const latestToken = getStoredSessionToken();
      if (latestToken !== null) {
        socket.auth = { token: latestToken };
      }
      setError(null);
      socket.emit(
        "room:subscribe",
        current.roomCode,
        (projection: RoomProjection | { error: string }) => {
          if (disposed) return;
          if ("error" in projection) {
            if (projection.error === "ROOM_NOT_FOUND" || projection.error === "NOT_A_MEMBER") {
              clearLocalRoom("房间已关闭，请重新创建或加入房间");
              return;
            }
            setError(errorLabel(projection.error));
            markConnectedAfterProjection();
            return;
          }
          replaceProjection(projection);
          markConnectedAfterProjection();
        },
      );
    };
    const scheduleHardReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!disposed) setSocketGeneration((value) => value + 1);
      }, 2000);
    };
    const handleDisconnect = (reason?: string) => {
      if (disposed) return;
      setConnectionStatus("reconnecting");
      setError(
        reason === "io server disconnect"
          ? "服务器断开了实时连接，正在重连"
          : "实时连接暂时中断，正在重连",
      );
      // Built-in reconnection handles most cases; hard recreate after auth failure / stuck state.
      if (reason === "io server disconnect") {
        scheduleHardReconnect();
      }
    };
    const handleConnectError = (err: Error) => {
      if (disposed) return;
      setConnectionStatus("reconnecting");
      const message = err.message || "";
      if (message.includes("UNAUTHENTICATED") || message.includes("unauthorized")) {
        setError("会话无效，请返回大厅重新进入房间");
      } else {
        setError(`实时连接失败（${message || "network"}），正在重连`);
      }
      scheduleHardReconnect();
    };
    const handleRoomUpdate = () => {
      if (!disposed) void refresh();
    };
    const handleChatMessage = (payload: ChatMessageProjection) => {
      if (!disposed) setLastChatMessage(payload);
    };

    socket.on("connect", subscribe);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:update", handleRoomUpdate);
    socket.on("connect_error", handleConnectError);
    socket.on("room:chat", handleChatMessage);
    socket.connect();

    return () => {
      disposed = true;
      if (connectedTimer !== null) clearTimeout(connectedTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socketRef.current = null;
      socket.off("connect", subscribe);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:update", handleRoomUpdate);
      socket.off("room:chat", handleChatMessage);
      socket.disconnect();
    };
  }, [clearLocalRoom, refresh, replaceProjection, room?.roomCode, socketGeneration]);

  const openRoom = useCallback(
    (projection: RoomProjection) => {
      setNotice(null);
      hasEverConnectedRef.current = false;
      setConnectionStatus("connecting");
      replaceProjection(projection);
    },
    [replaceProjection],
  );

  const leaveRoom = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    await runExclusive(null, async () => {
      try {
        await roomApi.leave(current.roomCode);
        clearLocalRoom();
      } catch (cause) {
        // Room already gone server-side (closed/evicted between page load and
        // this click) isn't really a failure from the player's perspective —
        // just finish leaving locally instead of showing an error they can't
        // act on.
        if (cause instanceof ApiError && cause.code === "ROOM_NOT_FOUND") {
          clearLocalRoom();
          return;
        }
        setError(errorLabel(cause instanceof ApiError ? cause.code : "UNKNOWN_ERROR"));
      }
    });
  }, [clearLocalRoom, runExclusive]);

  const dissolve = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    await runExclusive(null, async () => {
      try {
        replaceProjection(await roomApi.dissolve(current.roomCode));
      } catch {
        setError("解散房间失败，请稍后再试");
      }
    });
  }, [replaceProjection, runExclusive]);

  const ready = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    await runExclusive(null, async () => {
      try {
        replaceProjection(await roomApi.ready(current.roomCode, !current.selfReady));
      } catch {
        setError("准备失败，请稍后再试");
      }
    });
  }, [replaceProjection, runExclusive]);

  const updateBaseScore = useCallback(
    async (baseScore: BaseScore) => {
      const current = roomRef.current;
      if (current === null) return;
      await runExclusive(null, async () => {
        try {
          replaceProjection(await roomApi.updateBaseScore(current.roomCode, baseScore));
        } catch {
          setError("修改底分失败，请确认当前房主和房间状态");
        }
      });
    },
    [replaceProjection, runExclusive],
  );

  const updateBotDifficulty = useCallback(
    async (difficulty: BotDifficulty) => {
      const current = roomRef.current;
      if (current === null) return;
      await runExclusive(null, async () => {
        try {
          replaceProjection(await roomApi.updateBotDifficulty(current.roomCode, difficulty));
        } catch {
          setError("修改机器人难度失败，请确认当前房主和房间状态");
        }
      });
    },
    [replaceProjection, runExclusive],
  );

  const addBot = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    await runExclusive(null, async () => {
      try {
        replaceProjection(await roomApi.addBot(current.roomCode));
      } catch {
        setError("添加机器人失败，请确认房间仍有空位");
      }
    });
  }, [replaceProjection, runExclusive]);

  const removeBot = useCallback(
    async (seat: Seat) => {
      const current = roomRef.current;
      if (current === null) return;
      await runExclusive(null, async () => {
        try {
          replaceProjection(await roomApi.removeBot(current.roomCode, seat));
        } catch {
          setError("移除机器人失败，请确认当前房主和房间状态");
        }
      });
    },
    [replaceProjection, runExclusive],
  );

  const continueBot = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    await runExclusive(null, async () => {
      try {
        replaceProjection(await roomApi.continueBot(current.roomCode));
      } catch {
        setError("继续游戏失败，请稍后再试");
      }
    });
  }, [replaceProjection, runExclusive]);

  const send = useCallback(
    async (type: CommandEnvelope["type"], payload: Record<string, unknown> = {}) => {
      const current = roomRef.current;
      if (current === null) return;
      await runExclusive(type, async () => {
        setError(null);
        try {
          const socket = socketRef.current;
          if (socket?.connected !== true) throw new Error("Socket is not connected");
          const acknowledgement = await emitCommandWithTimeout(
            socket,
            createCommand(current, type, payload),
          );
          if (!acknowledgement.accepted) {
            setError(errorLabel(acknowledgement.errorCode ?? "UNKNOWN_ERROR"));
          }
          await refresh();
        } catch {
          setError("操作发送超时，正在同步牌局状态");
          await refresh();
        }
      });
    },
    [refresh, runExclusive],
  );

  const sendVoiceMessage = useCallback((message: string) => {
    const current = roomRef.current;
    const socket = socketRef.current;
    if (current === null || socket?.connected !== true) return;
    socket.emit("room:chat", { roomCode: current.roomCode, message }, () => {});
  }, []);

  return {
    room,
    busy,
    connectionStatus,
    pendingAction,
    error,
    notice,
    openRoom,
    leaveRoom,
    dissolve,
    ready,
    updateBaseScore,
    updateBotDifficulty,
    addBot,
    removeBot,
    continueBot,
    send,
    refresh,
    clearNotice: () => setNotice(null),
    lastChatMessage,
    sendVoiceMessage,
  };
}
