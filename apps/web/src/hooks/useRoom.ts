import type {
  BaseScore,
  BotDifficulty,
  ChatMessageProjection,
  CommandEnvelope,
  RoomProjection,
  Seat,
} from "@huanghuang/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ApiError, createCommand, roomApi, type CommandAcknowledge } from "../api.js";

type RoomController = {
  room: RoomProjection | null;
  busy: boolean;
  connectionStatus: ConnectionStatus;
  pendingAction: CommandEnvelope["type"] | null;
  error: string | null;
  notice: string | null;
  chatMessages: ChatMessageProjection[];
  openRoom: (projection: RoomProjection) => void;
  leaveRoom: () => Promise<void>;
  dissolve: () => Promise<void>;
  ready: () => Promise<void>;
  updateBaseScore: (baseScore: BaseScore) => Promise<void>;
  updateBotDifficulty: (difficulty: BotDifficulty) => Promise<void>;
  addBot: () => Promise<void>;
  removeBot: (seat: Seat) => Promise<void>;
  continueBot: () => Promise<void>;
  sendChat: (message: string) => Promise<boolean>;
  send: (type: CommandEnvelope["type"], payload?: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
};

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

const COMMAND_ACK_TIMEOUT_MS = 8000;

const ROOM_CLOSE_NOTICES: Record<NonNullable<RoomProjection["closeReason"]>, string> = {
  OWNER_DISSOLVED: "房主已解散房间",
  WAITING_TIMEOUT: "3 分钟未开始，房间已解散，请重新创建或加入房间",
  EMPTY_ROOM: "房间已关闭，请重新创建或加入房间",
  MATCH_SETTLED: "竞技结算已确认，请继续匹配或返回大厅",
};

const ERROR_LABELS: Record<string, string> = {
  ACTION_NOT_AVAILABLE: "当前不能执行这个操作",
  CANNOT_WIN: "当前牌型不能胡",
  INVALID_COMMAND: "操作格式无效",
  INVALID_INPUT: "输入内容无效",
  NOT_A_MEMBER: "你不在这个牌局中",
  NOT_CURRENT_PLAYER: "还没轮到你",
  OWNER_ONLY: "只有房主可以执行这个操作",
  ROOM_NOT_FOUND: "房间不存在或已经解散",
  ROOM_FULL: "房间已经坐满了",
  ROOM_NOT_JOINABLE: "当前房间不能加入，请等待本局结束",
  UNAUTHENTICATED: "匿名会话已失效，请重新进入",
  VERSION_CONFLICT: "牌局刚刚发生变化，已为你同步",
  WALL_EMPTY: "牌墙已空",
  WILDCARD_CANNOT_BE_DISCARDED: "赖子只能放赖，不能直接打出",
  WRONG_PHASE: "当前阶段不能执行这个操作",
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? "操作没有成功，请再试一次";
}

function emitCommandWithTimeout(
  socket: Socket,
  command: CommandEnvelope,
): Promise<CommandAcknowledge> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new Error("COMMAND_ACK_TIMEOUT"));
    }, COMMAND_ACK_TIMEOUT_MS);

    socket.emit("game:command", command, (acknowledgement: CommandAcknowledge) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
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
  const [chatMessages, setChatMessages] = useState<ChatMessageProjection[]>([]);
  const roomRef = useRef(room);
  const socketRef = useRef<Socket | null>(null);
  const mutationInFlightRef = useRef(false);
  const hasEverConnectedRef = useRef(false);
  const chatTimersRef = useRef(new Map<string, number>());
  roomRef.current = room;

  const clearLocalRoom = useCallback((message: string | null = null) => {
    roomRef.current = null;
    setRoom(null);
    setChatMessages([]);
    setError(null);
    setNotice(message);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }, []);

  const replaceProjection = useCallback(
    (next: RoomProjection) => {
      if (next.status === "CLOSED") {
        clearLocalRoom(
          next.closeReason === null
            ? "房间已关闭，请重新创建或加入房间"
            : ROOM_CLOSE_NOTICES[next.closeReason],
        );
        return;
      }
      setRoom((current) => (current === null || next.version >= current.version ? next : current));
      setError(null);
    },
    [clearLocalRoom],
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    const socket: Socket = io({
      autoConnect: false,
      withCredentials: true,
      timeout: 5000,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    let connectedTimer: number | null = null;
    let reconnectTimer: number | null = null;
    socketRef.current = socket;

    const markConnectedAfterProjection = () => {
      if (connectedTimer !== null) window.clearTimeout(connectedTimer);
      connectedTimer = window.setTimeout(() => setConnectionStatus("connected"), 0);
    };
    const subscribe = () => {
      setConnectionStatus(hasEverConnectedRef.current ? "reconnecting" : "connecting");
      hasEverConnectedRef.current = true;
      socket.emit(
        "room:subscribe",
        current.roomCode,
        (projection: RoomProjection | { error: string }) => {
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
    const scheduleReconnect = () => {
      if (reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        setSocketGeneration((current) => current + 1);
      }, 1500);
    };
    const handleDisconnect = () => {
      setConnectionStatus("reconnecting");
      setError("实时连接暂时中断，正在重连");
      scheduleReconnect();
    };
    const handleConnectError = () => {
      setConnectionStatus("reconnecting");
      setError("实时连接暂时中断，正在重连");
      scheduleReconnect();
    };
    const handleRoomUpdate = () => void refresh();
    const handleChatMessage = (message: ChatMessageProjection) => {
      setChatMessages((current) =>
        [...current.filter((item) => item.id !== message.id), message].slice(-4),
      );
      const existingTimer = chatTimersRef.current.get(message.id);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        setChatMessages((current) => current.filter((item) => item.id !== message.id));
        chatTimersRef.current.delete(message.id);
      }, 3000);
      chatTimersRef.current.set(message.id, timer);
    };
    socket.on("connect", subscribe);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:update", handleRoomUpdate);
    socket.on("room:chat", handleChatMessage);
    socket.on("connect_error", handleConnectError);
    socket.connect();
    return () => {
      if (connectedTimer !== null) window.clearTimeout(connectedTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socketRef.current = null;
      socket.off("connect", subscribe);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:update", handleRoomUpdate);
      socket.off("room:chat", handleChatMessage);
      socket.disconnect();
      for (const timer of chatTimersRef.current.values()) window.clearTimeout(timer);
      chatTimersRef.current.clear();
      setChatMessages([]);
    };
  }, [clearLocalRoom, refresh, replaceProjection, room?.roomCode, socketGeneration]);

  const openRoom = useCallback(
    (projection: RoomProjection) => {
      setNotice(null);
      hasEverConnectedRef.current = false;
      setConnectionStatus("connecting");
      replaceProjection(projection);
      if (projection.status === "CLOSED") return;
      const url = new URL(window.location.href);
      url.searchParams.set("room", projection.roomCode);
      window.history.replaceState(null, "", url);
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
      } catch {
        setError("离开房间失败，请稍后再试");
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
          if (!socket?.connected) throw new Error("Socket is not connected");
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

  const sendChat = useCallback(async (message: string): Promise<boolean> => {
    const current = roomRef.current;
    const socket = socketRef.current;
    if (current === null || socket === null) {
      setError("实时连接尚未就绪");
      return false;
    }
    const acknowledgement = await new Promise<{ accepted: boolean; errorCode?: string }>(
      (resolve) => {
        socket.emit("room:chat", { roomCode: current.roomCode, message }, resolve);
      },
    );
    if (!acknowledgement.accepted) {
      setError(errorLabel(acknowledgement.errorCode ?? "UNKNOWN_ERROR"));
      return false;
    }
    setError(null);
    return true;
  }, []);

  return {
    room,
    busy,
    connectionStatus,
    pendingAction,
    error,
    notice,
    chatMessages,
    openRoom,
    leaveRoom,
    dissolve,
    ready,
    updateBaseScore,
    updateBotDifficulty,
    addBot,
    removeBot,
    continueBot,
    sendChat,
    send,
    refresh,
  };
}
