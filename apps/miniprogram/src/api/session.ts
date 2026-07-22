import Taro from "@tarojs/taro";
import { API_BASE, SESSION_TOKEN_HEADER, SESSION_TOKEN_STORAGE_KEY } from "../config";

export type SessionIssueResponse = {
  sessionId: string;
  nickname: string;
  sessionToken: string | null;
};

export function getStoredSessionToken(): string | null {
  try {
    const value = Taro.getStorageSync(SESSION_TOKEN_STORAGE_KEY);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string): void {
  Taro.setStorageSync(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
  try {
    Taro.removeStorageSync(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage failures on smoke path
  }
}

export function authHeaders(
  token: string | null = getStoredSessionToken(),
): Record<string, string> {
  if (token === null) return {};
  return {
    Authorization: `Bearer ${token}`,
    [SESSION_TOKEN_HEADER]: token,
  };
}

function pickSessionToken(
  header: string | undefined,
  bodyToken: string | null | undefined,
): string | null {
  if (typeof header === "string" && header.length > 0) return header;
  if (typeof bodyToken === "string" && bodyToken.length > 0) return bodyToken;
  return null;
}

/** Issue or refresh anonymous session against the shared server. */
export async function issueSession(nickname: string): Promise<SessionIssueResponse> {
  const response = await Taro.request({
    url: `${API_BASE}/api/session`,
    method: "POST",
    data: { nickname },
    header: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`SESSION_HTTP_${String(response.statusCode)}`);
  }

  const data = response.data as SessionIssueResponse;
  const headerToken =
    typeof response.header === "object" && response.header !== null
      ? ((response.header[SESSION_TOKEN_HEADER] as string | undefined) ??
        (response.header[SESSION_TOKEN_HEADER.toLowerCase()] as string | undefined))
      : undefined;
  const sessionToken = pickSessionToken(headerToken, data.sessionToken);
  if (sessionToken !== null) {
    setStoredSessionToken(sessionToken);
  }

  return {
    sessionId: data.sessionId,
    nickname: data.nickname,
    sessionToken,
  };
}

export async function pingHealth(): Promise<{ status: string }> {
  const response = await Taro.request({
    url: `${API_BASE}/health/live`,
    method: "GET",
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HEALTH_HTTP_${String(response.statusCode)}`);
  }
  return response.data as { status: string };
}
