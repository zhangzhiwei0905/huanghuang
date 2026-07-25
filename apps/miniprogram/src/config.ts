/** API origin for REST + Socket.IO. Injected at build via TARO_APP_API_BASE. */
export const API_BASE: string =
  typeof TARO_APP_API_BASE === "string" && TARO_APP_API_BASE.length > 0
    ? TARO_APP_API_BASE.replace(/\/$/, "")
    : "https://huanghuang.amazingzz.xyz";

export const SESSION_TOKEN_STORAGE_KEY = "huanghuang_session_token";
export const SESSION_TOKEN_HEADER = "X-Session-Token";
