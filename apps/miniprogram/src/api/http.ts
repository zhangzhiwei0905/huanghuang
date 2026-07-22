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

async function request<T>(
  path: string,
  init?: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    data?: unknown;
  },
): Promise<T> {
  const response = await Taro.request({
    url: `${API_BASE}${path}`,
    method: init?.method ?? "GET",
    data: init?.data,
    header: {
      // wx.request always sends `Content-Type: application/json` on every
      // request regardless of what's in this header object — omitting the
      // key, or even setting it to "" here, does not suppress it (verified
      // against the live runtime). The actual fix for bodyless requests
      // (e.g. DELETE /api/rooms/:code) is server-side: apps/server/src/
      // index.ts registers a JSON content-type parser that tolerates an
      // empty body instead of Fastify's default 400. This header is kept
      // conditional only because it's still correct documentation of intent
      // for requests that do carry a body.
      ...(init?.data !== undefined ? { "Content-Type": "application/json" } : {}),
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

// WeChat Mini Program's JS runtime has no `crypto.randomUUID` (no Web Crypto
// API at all), so the previous fallback produced a `req_<timestamp>_<random>`
// string. The server's commandEnvelopeSchema requires `requestId` to be a
// real RFC 4122 UUID (`z.uuid()`) and rejects anything else with
// INVALID_COMMAND — which silently failed every single game:command sent
// from the mini program, regardless of game state or selection.
function randomUUIDv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createCommand(
  room: RoomProjection,
  type: CommandEnvelope["type"],
  payload: Record<string, unknown> = {},
): CommandEnvelope {
  return {
    type,
    requestId: randomUUIDv4(),
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
