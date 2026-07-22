import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AnonymousSession, GameDatabase } from "./database.js";

export const SESSION_COOKIE = "huanghuang_session";
/** Response / request header carrying the raw session token for non-cookie clients. */
export const SESSION_TOKEN_HEADER = "x-session-token";

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function extractBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (raw === undefined || raw.length === 0) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (match === null) return null;
  const token = match[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

export function extractSessionTokenHeader(
  headerValue: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (raw === undefined) return null;
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

/** Pull a raw session token from common mini-program / HTTP locations. */
export function extractRawSessionToken(input: {
  authorization?: string | string[];
  sessionTokenHeader?: string | string[];
  cookieHeader?: string;
}): string | null {
  const fromBearer = extractBearerToken(input.authorization);
  if (fromBearer !== null) return fromBearer;
  const fromHeader = extractSessionTokenHeader(input.sessionTokenHeader);
  if (fromHeader !== null) return fromHeader;
  return extractCookieToken(input.cookieHeader);
}

function extractCookieToken(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (value === undefined || value.length === 0) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class SessionService {
  constructor(private readonly database: GameDatabase) {}

  resolveFromRawToken(token: string | null | undefined): AnonymousSession | null {
    if (token === null || token === undefined || token.length === 0) return null;
    return this.database.findSessionByTokenHash(hashToken(token));
  }

  resolve(request: FastifyRequest): AnonymousSession | null {
    const token = extractRawSessionToken({
      ...(request.headers.authorization !== undefined
        ? { authorization: request.headers.authorization }
        : {}),
      ...(request.headers[SESSION_TOKEN_HEADER] !== undefined
        ? { sessionTokenHeader: request.headers[SESSION_TOKEN_HEADER] }
        : {}),
      ...(request.headers.cookie !== undefined ? { cookieHeader: request.headers.cookie } : {}),
    });
    return this.resolveFromRawToken(token);
  }

  /** @deprecated prefer resolveFromRawToken / resolve; kept for call-site clarity in Socket layer */
  resolveRawCookie(cookieHeader: string | undefined): AnonymousSession | null {
    return this.resolveFromRawToken(extractCookieToken(cookieHeader));
  }

  resolveSocketHandshake(handshake: {
    auth?: unknown;
    headers: { authorization?: string | string[]; cookie?: string; [key: string]: unknown };
  }): AnonymousSession | null {
    const authRecord =
      typeof handshake.auth === "object" && handshake.auth !== null
        ? (handshake.auth as Record<string, unknown>)
        : undefined;
    const authToken =
      typeof authRecord?.token === "string" && authRecord.token.length > 0
        ? authRecord.token
        : null;
    const headerBag = handshake.headers[SESSION_TOKEN_HEADER];
    const sessionTokenHeader =
      typeof headerBag === "string" || Array.isArray(headerBag) ? headerBag : undefined;
    return this.resolveFromRawToken(
      authToken ??
        extractRawSessionToken({
          ...(handshake.headers.authorization !== undefined
            ? { authorization: handshake.headers.authorization }
            : {}),
          ...(sessionTokenHeader !== undefined ? { sessionTokenHeader } : {}),
          ...(handshake.headers.cookie !== undefined
            ? { cookieHeader: handshake.headers.cookie }
            : {}),
        }),
    );
  }

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  /** Expose raw token to mini-program clients (Web ignores this header). */
  attachSessionTokenHeader(reply: FastifyReply, token: string): void {
    reply.header(SESSION_TOKEN_HEADER, token);
  }

  /**
   * Ensure a session for create/join style routes.
   * Returns the session and the raw token when this request knows it (Bearer reuse or newly issued).
   * Cookie-only clients get Set-Cookie; rawToken may be null when the session was resolved only via
   * an opaque cookie we cannot reverse.
   */
  ensure(
    request: FastifyRequest,
    reply: FastifyReply,
    nickname: string,
  ): { session: AnonymousSession; rawToken: string | null } {
    const presented = extractRawSessionToken({
      ...(request.headers.authorization !== undefined
        ? { authorization: request.headers.authorization }
        : {}),
      ...(request.headers[SESSION_TOKEN_HEADER] !== undefined
        ? { sessionTokenHeader: request.headers[SESSION_TOKEN_HEADER] }
        : {}),
      ...(request.headers.cookie !== undefined ? { cookieHeader: request.headers.cookie } : {}),
    });
    const existing = this.resolveFromRawToken(presented);
    if (existing !== null) {
      const updated = { ...existing, nickname };
      this.database.updateSession(updated);
      if (presented !== null) {
        // Re-issue cookie for browser clients that also sent a header, and echo token for MP.
        const fromCookieOnly =
          extractCookieToken(request.headers.cookie) === presented &&
          extractBearerToken(request.headers.authorization) === null &&
          extractSessionTokenHeader(request.headers[SESSION_TOKEN_HEADER]) === null;
        if (!fromCookieOnly) {
          this.setSessionCookie(reply, presented);
          this.attachSessionTokenHeader(reply, presented);
        }
        return { session: updated, rawToken: presented };
      }
      return { session: updated, rawToken: null };
    }

    const token = randomBytes(32).toString("base64url");
    const session = { id: randomUUID(), nickname };
    this.database.createSession(session, hashToken(token));
    this.setSessionCookie(reply, token);
    this.attachSessionTokenHeader(reply, token);
    return { session, rawToken: token };
  }

  /** Explicit session issue for mini-programs (no room required). */
  issue(nickname: string, reply: FastifyReply): { session: AnonymousSession; rawToken: string } {
    const token = randomBytes(32).toString("base64url");
    const session = { id: randomUUID(), nickname };
    this.database.createSession(session, hashToken(token));
    this.setSessionCookie(reply, token);
    this.attachSessionTokenHeader(reply, token);
    return { session, rawToken: token };
  }
}
