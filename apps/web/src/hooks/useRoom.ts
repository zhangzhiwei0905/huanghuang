import type { CommandEnvelope, RoomProjection } from "@huanghuang/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { createCommand, roomApi, type CommandAcknowledge } from "../api.js";

type RoomController = {
  room: RoomProjection | null;
  busy: boolean;
  error: string | null;
  openRoom: (projection: RoomProjection) => void;
  leaveRoom: () => Promise<void>;
  dissolve: () => Promise<void>;
  ready: () => Promise<void>;
  continueBot: () => Promise<void>;
  send: (type: CommandEnvelope["type"], payload?: Record<string, unknown>) => Promise<void>;
  refresh: () => Promise<void>;
};

const ERROR_LABELS: Record<string, string> = {
  ACTION_NOT_AVAILABLE: "当前不能执行这个操作",
  CANNOT_WIN: "当前牌型不能胡",
  INVALID_COMMAND: "操作格式无效",
  NOT_A_MEMBER: "你不在这个牌局中",
  NOT_CURRENT_PLAYER: "还没轮到你",
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

export function useRoom(): RoomController {
  const [room, setRoom] = useState<RoomProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef(room);
  const socketRef = useRef<Socket | null>(null);
  roomRef.current = room;

  const replaceProjection = useCallback((next: RoomProjection) => {
    if (next.status === "CLOSED") {
      setRoom(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState(null, "", url);
      return;
    }
    setRoom((current) => (current === null || next.version >= current.version ? next : current));
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    try {
      replaceProjection(await roomApi.get(current.roomCode));
    } catch {
      setError("无法同步牌局，请检查网络连接");
    }
  }, [replaceProjection]);

  useEffect(() => {
    const current = room;
    if (current === null) return;
    const socket: Socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.emit(
      "room:subscribe",
      current.roomCode,
      (projection: RoomProjection | { error: string }) => {
        if ("error" in projection) {
          setError(errorLabel(projection.error));
          return;
        }
        replaceProjection(projection);
      },
    );
    socket.on("room:update", () => void refresh());
    socket.on("connect_error", () => setError("实时连接暂时中断，正在重连"));
    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [refresh, replaceProjection, room?.roomCode]);

  const openRoom = useCallback(
    (projection: RoomProjection) => {
      replaceProjection(projection);
      const url = new URL(window.location.href);
      url.searchParams.set("room", projection.roomCode);
      window.history.replaceState(null, "", url);
    },
    [replaceProjection],
  );

  const leaveRoom = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    setBusy(true);
    try {
      await roomApi.leave(current.roomCode);
      setRoom(null);
      setError(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState(null, "", url);
    } catch {
      setError("离开房间失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, []);

  const dissolve = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    setBusy(true);
    try {
      replaceProjection(await roomApi.dissolve(current.roomCode));
    } catch {
      setError("设置解散失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, [replaceProjection]);

  const ready = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    setBusy(true);
    try {
      replaceProjection(await roomApi.ready(current.roomCode));
    } catch {
      setError("准备失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, [replaceProjection]);

  const continueBot = useCallback(async () => {
    const current = roomRef.current;
    if (current === null) return;
    setBusy(true);
    try {
      replaceProjection(await roomApi.continueBot(current.roomCode));
    } catch {
      setError("继续游戏失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, [replaceProjection]);

  const send = useCallback(
    async (type: CommandEnvelope["type"], payload: Record<string, unknown> = {}) => {
      const current = roomRef.current;
      if (current === null) return;
      setBusy(true);
      setError(null);
      try {
        const socket = socketRef.current;
        if (socket === null) throw new Error("Socket is not connected");
        const acknowledgement = await new Promise<CommandAcknowledge>((resolve) => {
          socket.emit("game:command", createCommand(current, type, payload), resolve);
        });
        if (!acknowledgement.accepted) {
          setError(errorLabel(acknowledgement.errorCode ?? "UNKNOWN_ERROR"));
        }
        await refresh();
      } catch {
        setError("操作发送失败，请检查网络连接");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { room, busy, error, openRoom, leaveRoom, dissolve, ready, continueBot, send, refresh };
}
