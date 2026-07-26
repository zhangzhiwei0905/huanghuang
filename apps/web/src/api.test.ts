import { afterEach, describe, expect, it, vi } from "vitest";
import { roomApi } from "./api.js";

describe("roomApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the selected room mode when creating a room", async () => {
    vi.stubGlobal("fetch", (_path: string, init: RequestInit | undefined): Promise<Response> => {
      expect(_path).toBe("/api/rooms");
      const body = init?.body;
      if (typeof body !== "string") throw new Error("Expected a JSON request body");
      expect(JSON.parse(body)).toEqual({
        nickname: "玩家",
        baseScore: 2,
        mode: "BOT",
        turnTimeoutSeconds: 25,
        botDifficulty: "LOW",
      });
      return Promise.resolve(
        new Response(JSON.stringify({ mode: "BOT" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await expect(roomApi.create("玩家", 2, "BOT", 25, "LOW")).resolves.toMatchObject({
      mode: "BOT",
    });
  });

  it("uses the explicit continue endpoint for bot rounds", async () => {
    vi.stubGlobal("fetch", (path: string): Promise<Response> => {
      expect(path).toBe("/api/rooms/123456/continue");
      return Promise.resolve(
        new Response(JSON.stringify({ stage: "PLAYING" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await expect(roomApi.continueBot("123456")).resolves.toMatchObject({ stage: "PLAYING" });
  });

  it("sends explicit ready state, room settings and bot seat mutations", async () => {
    const requests: { path: string; method: string | undefined; body: unknown }[] = [];
    vi.stubGlobal("fetch", (path: string, init: RequestInit | undefined): Promise<Response> => {
      requests.push({
        path,
        method: init?.method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ roomCode: "123456" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await roomApi.ready("123456", false);
    await roomApi.updateBaseScore("123456", 10);
    await roomApi.updateBotDifficulty("123456", "LOW");
    await roomApi.addBot("123456");
    await roomApi.removeBot("123456", 2);

    expect(requests).toEqual([
      { path: "/api/rooms/123456/ready", method: "POST", body: { ready: false } },
      { path: "/api/rooms/123456/settings", method: "PATCH", body: { baseScore: 10 } },
      {
        path: "/api/rooms/123456/settings",
        method: "PATCH",
        body: { botDifficulty: "LOW" },
      },
      { path: "/api/rooms/123456/bots", method: "POST", body: {} },
      { path: "/api/rooms/123456/bots/2", method: "DELETE", body: null },
    ]);
  });

  it("does not send a JSON content type with an empty DELETE body", async () => {
    vi.stubGlobal("fetch", (_path: string, init: RequestInit | undefined): Promise<Response> => {
      const headers = new Headers(init?.headers);
      expect(headers.has("Content-Type")).toBe(false);
      return Promise.resolve(
        new Response(JSON.stringify({ closed: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await expect(roomApi.leave("123456")).resolves.toEqual({ closed: true });
  });
});
