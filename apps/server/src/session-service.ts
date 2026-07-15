import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AnonymousSession, GameDatabase } from "./database.js";

const SESSION_COOKIE = "huanghuang_session";

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export class SessionService {
  constructor(private readonly database: GameDatabase) {}

  resolve(request: FastifyRequest): AnonymousSession | null {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) return null;
    return this.database.findSessionByTokenHash(hashToken(token));
  }

  resolveRawCookie(cookieHeader: string | undefined): AnonymousSession | null {
    if (cookieHeader === undefined) return null;
    const value = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (value === undefined || value.length === 0) return null;
    return this.database.findSessionByTokenHash(hashToken(decodeURIComponent(value)));
  }

  ensure(request: FastifyRequest, reply: FastifyReply, nickname: string): AnonymousSession {
    const existing = this.resolve(request);
    if (existing !== null) {
      const updated = { ...existing, nickname };
      this.database.updateSession(updated);
      return updated;
    }
    const token = randomBytes(32).toString("base64url");
    const session = { id: randomUUID(), nickname };
    this.database.createSession(session, hashToken(token));
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return session;
  }
}
