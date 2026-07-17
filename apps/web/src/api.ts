import type {
  BaseScore,
  CommandEnvelope,
  CommandResult,
  RoomMode,
  RoomProjection,
} from "@huanghuang/protocol";

type ErrorBody = { error?: string };

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(body.error ?? `HTTP_${response.status}`);
  }
  return (await response.json()) as T;
}

export const roomApi = {
  create(nickname: string, baseScore: BaseScore, mode: RoomMode): Promise<RoomProjection> {
    return request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ nickname, baseScore, mode }),
    });
  },
  join(nickname: string, roomCode: string): Promise<RoomProjection> {
    return request("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ nickname, roomCode }),
    });
  },
  get(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}`);
  },
  ready(roomCode: string, ready: boolean): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/ready`, {
      method: "POST",
      body: JSON.stringify({ ready }),
    });
  },
  updateBaseScore(roomCode: string, baseScore: BaseScore): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/settings`, {
      method: "PATCH",
      body: JSON.stringify({ baseScore }),
    });
  },
  continueBot(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/continue`, { method: "POST", body: "{}" });
  },
  dissolve(roomCode: string): Promise<RoomProjection> {
    return request(`/api/rooms/${roomCode}/dissolve`, { method: "POST", body: "{}" });
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
  return {
    type,
    requestId: crypto.randomUUID(),
    roomId: room.roomId,
    roundId: null,
    expectedVersion: room.version,
    payload,
  };
}

export type CommandAcknowledge = CommandResult | { accepted: false; errorCode: string };
