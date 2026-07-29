import Taro from "@tarojs/taro";
import { API_BASE, SESSION_TOKEN_HEADER, SESSION_TOKEN_STORAGE_KEY } from "../config";

export type SessionIssueResponse = {
  sessionId: string;
  playerId: string | null;
  nickname: string;
  avatarUrl: string | null;
  sessionToken: string | null;
};

export type Identity = {
  nickname: string;
  playerId: string;
  avatarUrl: string | null;
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
    playerId: data.playerId,
    nickname: data.nickname,
    avatarUrl: data.avatarUrl,
    sessionToken,
  };
}

/** Resolve the identity behind an already-stored session token, if any (app relaunch). */
export async function resolveIdentity(): Promise<Identity | null> {
  const token = getStoredSessionToken();
  if (token === null) return null;
  const response = await Taro.request({
    url: `${API_BASE}/api/session`,
    method: "GET",
    header: authHeaders(token),
  });
  if (response.statusCode !== 200) return null;
  const data = response.data as {
    nickname: string;
    playerId: string | null;
    avatarUrl: string | null;
    wechatLinked: boolean;
  };
  // A device that used the app before the WeChat-login feature shipped may
  // still carry a valid plain anonymous session token — that must not
  // count as "already logged in" here, or it silently skips the login
  // gate forever with its old nickname and no avatar.
  if (!data.wechatLinked || data.playerId === null) return null;
  return { nickname: data.nickname, playerId: data.playerId, avatarUrl: data.avatarUrl };
}

/** Exchange a fresh wx.login() code (+ optional uploaded avatar) for a persistent WeChat identity. */
export async function wechatLogin(nickname: string, avatarUrl: string | null): Promise<Identity> {
  const { code } = await Taro.login();
  const response = await Taro.request({
    url: `${API_BASE}/api/auth/wechat`,
    method: "POST",
    data: { code, nickname, avatarUrl },
    header: { "Content-Type": "application/json" },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`WECHAT_AUTH_HTTP_${String(response.statusCode)}`);
  }
  const data = response.data as SessionIssueResponse;
  if (data.sessionToken !== null) {
    setStoredSessionToken(data.sessionToken);
  }
  if (data.playerId === null) throw new Error("PLAYER_ID_NOT_ASSIGNED");
  return { nickname: data.nickname, playerId: data.playerId, avatarUrl: data.avatarUrl };
}

/**
 * Resume a profile previously linked to the current WeChat openid.
 * First-time users return null and continue through explicit profile capture.
 */
export async function resumeWechatIdentity(): Promise<Identity | null> {
  const { code } = await Taro.login();
  const response = await Taro.request({
    url: `${API_BASE}/api/auth/wechat`,
    method: "POST",
    data: { code, resumeOnly: true },
    header: { "Content-Type": "application/json" },
  });
  const errorCode =
    typeof response.data === "object" &&
    response.data !== null &&
    "error" in response.data &&
    typeof response.data.error === "string"
      ? response.data.error
      : null;
  if (response.statusCode === 404 && errorCode === "WECHAT_PROFILE_REQUIRED") {
    return null;
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(errorCode ?? `WECHAT_AUTH_HTTP_${String(response.statusCode)}`);
  }
  const data = response.data as SessionIssueResponse;
  if (data.sessionToken !== null) {
    setStoredSessionToken(data.sessionToken);
  }
  if (data.playerId === null) throw new Error("PLAYER_ID_NOT_ASSIGNED");
  return { nickname: data.nickname, playerId: data.playerId, avatarUrl: data.avatarUrl };
}

function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success: (result) => {
        if (typeof result.data === "string" && result.data.length > 0) {
          resolve(result.data);
        } else {
          reject(new Error("AVATAR_FILE_EMPTY"));
        }
      },
      fail: reject,
    });
  });
}

async function compressAvatar(tempFilePath: string): Promise<string> {
  try {
    const result = await Taro.compressImage({
      src: tempFilePath,
      quality: 82,
      compressedWidth: 256,
      compressedHeight: 256,
    });
    return result.tempFilePath;
  } catch {
    // Some older runtimes cannot compress every image format. Reading the
    // original path still gives the server a chance to accept a small image.
    return tempFilePath;
  }
}

/** Upload a chooseAvatar temp file path through the normal request domain. */
export async function uploadAvatar(tempFilePath: string): Promise<string> {
  const compressedPath = await compressAvatar(tempFilePath);
  const data = await readFileAsBase64(compressedPath);
  const response = await Taro.request({
    url: `${API_BASE}/api/upload/avatar-data`,
    method: "POST",
    data: { data },
    header: { "Content-Type": "application/json" },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error =
      typeof response.data === "object" &&
      response.data !== null &&
      "error" in response.data &&
      typeof response.data.error === "string"
        ? response.data.error
        : `HTTP_${String(response.statusCode)}`;
    throw new Error(`AVATAR_UPLOAD_${error}`);
  }
  const payload = response.data as { avatarUrl?: unknown };
  if (typeof payload.avatarUrl !== "string" || !payload.avatarUrl.startsWith("/avatars/")) {
    throw new Error("AVATAR_UPLOAD_INVALID_RESPONSE");
  }
  return payload.avatarUrl;
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
