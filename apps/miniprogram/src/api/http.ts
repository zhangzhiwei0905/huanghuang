import Taro from "@tarojs/taro";
import type {
  BaseScore,
  CommandEnvelope,
  CommandResult,
  RoomMode,
  RoomProjection,
} from "@huanghuang/protocol";
import { API_BASE } from "../config";
import { authHeaders, getStoredSessionToken, setStoredSessionToken } from "./session";

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type ErrorBody = { error?: string };

function captureSessionToken(header: Record<string, unknown> | undefined): void {
  if (header === undefined) return;
  const token =
    (header["X-Session-Token"] as string | undefined) ??
    (header["x-session-token"] as string | undefined);
  if (typeof token === "string" && token.length > 0) {
    setStoredSessionToken(token);
  }
}

async function request<T>(path: string, init?: {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  data?: unknown;
}): Promise<T> {
  const response = await Taro.request({
    url: `${API_BASE}${path}`,
    method: init?.method ?? "GET",
    data: init?.data,
    header: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
  });
  captureSessionToken(response.header as Record<string, unknown> | undefined);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = (response.data ?? {}) as ErrorBody;
    throw new ApiError(body.error ?? `HTTP_${String(response.statusCode)}`);
  }
  return response.data as T;
}

export const roomApi = {
  create(nickname: string, baseScore: BaseScore, mode: RoomMode): Promise<RoomProjection> {
    return request("/api/rooms", {
      method: "POST",
      data: { nickname, baseScore, mode },
    });
  },
  join(nickname: string, roomCode: string): Promise<RoomProjection> {
    return request("/api/rooms/join", {
      method: "POST",
      data: { nickname, roomCode },
    });
  },
  get(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}`);
  },
  ready(roomCode: string, ready: boolean): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/ready`, {
      method: "POST",
      data: { ready },
    });
  },
  updateBaseScore(roomCode: string, baseScore: BaseScore): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/settings`, {
      method: "PATCH",
      data: { baseScore },
    });
  },
  continueBot(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/continue`, { method: "POST", data: {} });
  },
  dissolve(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/dissolve`, { method: "POST", data: {} });
  },
  leave(roomCode: string): Promise<{ closed: boolean }> {
    return request(`/api/rooms/${roomCode}`, { method: "DELETE" });
  },
};

export function createCommand(
  room: RoomProjection,
  type: CommandEnvelope["type"],
  payload: Record<string, unknown> = {},
): CommandEnvelope {
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    type,
    requestId,
    roomId: room.roomId,
    roundId: null,
    expectedVersion: room.version,
    payload,
  };
}

export type CommandAcknowledge = CommandResult | { accepted: false; errorCode: string };

export function requireSessionToken(): string {
  const token = getStoredSessionToken();
  if (token === null) throw new ApiError("UNAUTHENTICATED");
  return token;
}
