/** API origin for REST + Socket.IO. Injected at build via TARO_APP_API_BASE. */
export const API_BASE: string =
  typeof TARO_APP_API_BASE === "string" && TARO_APP_API_BASE.length > 0
    ? TARO_APP_API_BASE.replace(/\/$/, "")
    : "https://huanghuang.amazingzz.xyz";

export const SESSION_TOKEN_STORAGE_KEY = "huanghuang_session_token";
export const SESSION_TOKEN_HEADER = "X-Session-Token";

/**
 * Frontend build version (MAJOR.MINOR.PATCH), read from
 * apps/miniprogram/package.json at build time. Injected via
 * TARO_APP_VERSION — see config/index.ts for the manual-sync convention
 * that keeps this in sync with the WeChat DevTools upload dialog.
 */
export const APP_VERSION: string =
  typeof TARO_APP_VERSION === "string" && TARO_APP_VERSION.length > 0
    ? TARO_APP_VERSION
    : "unknown";

/** Frontend build timestamp (ISO string). Injected at build via TARO_APP_BUILT_AT. */
export const APP_BUILT_AT: string =
  typeof TARO_APP_BUILT_AT === "string" && TARO_APP_BUILT_AT.length > 0
    ? TARO_APP_BUILT_AT
    : "unknown";
