import type { FastifyReply } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractBearerToken,
  extractRawSessionToken,
  SessionService,
  SESSION_TOKEN_HEADER,
} from "./session-service.js";
import { GameDatabase } from "./database.js";

describe("session token extraction", () => {
  it("parses Bearer tokens case-insensitively", () => {
    expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(extractBearerToken("bearer xyz")).toBe("xyz");
    expect(extractBearerToken("Basic nope")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("prefers Authorization Bearer over X-Session-Token over cookie", () => {
    expect(
      extractRawSessionToken({
        authorization: "Bearer from-auth",
        sessionTokenHeader: "from-header",
        cookieHeader: "huanghuang_session=from-cookie",
      }),
    ).toBe("from-auth");
    expect(
      extractRawSessionToken({
        sessionTokenHeader: "from-header",
        cookieHeader: "huanghuang_session=from-cookie",
      }),
    ).toBe("from-header");
    expect(
      extractRawSessionToken({
        cookieHeader: "a=1; huanghuang_session=from-cookie; b=2",
      }),
    ).toBe("from-cookie");
  });
});

describe("SessionService", () => {
  let database: GameDatabase;
  let sessions: SessionService;

  afterEach(() => {
    database.close();
  });

  function setup(): void {
    database = new GameDatabase(":memory:");
    sessions = new SessionService(database);
  }

  it("issues a session and resolves it via Bearer and header", () => {
    setup();
    const headers: Record<string, string> = {};
    const reply = {
      setCookie: () => reply,
      header: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
        return reply;
      },
    } as unknown as FastifyReply;

    const issued = sessions.issue("牌友", reply);
    expect(issued.rawToken.length).toBeGreaterThan(10);
    expect(headers[SESSION_TOKEN_HEADER]).toBe(issued.rawToken);

    const viaBearer = sessions.resolveFromRawToken(issued.rawToken);
    expect(viaBearer).toEqual({ id: issued.session.id, nickname: "牌友" });

    const viaSocket = sessions.resolveSocketHandshake({
      auth: { token: issued.rawToken },
      headers: {},
    });
    expect(viaSocket?.id).toBe(issued.session.id);

    const viaHeader = sessions.resolveSocketHandshake({
      headers: { [SESSION_TOKEN_HEADER]: issued.rawToken },
    });
    expect(viaHeader?.id).toBe(issued.session.id);
  });

  it("resolves cookie-only sessions without requiring Bearer", () => {
    setup();
    const cookies: string[] = [];
    const reply = {
      setCookie: (_name: string, value: string) => {
        cookies.push(value);
        return reply;
      },
      header: () => reply,
    } as unknown as FastifyReply;

    const issued = sessions.issue("Cookie君", reply);
    const cookieHeader = `huanghuang_session=${issued.rawToken}`;
    const resolved = sessions.resolveFromRawToken(extractRawSessionToken({ cookieHeader }));
    expect(resolved?.nickname).toBe("Cookie君");
  });
});
