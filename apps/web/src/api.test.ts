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
      });
      return Promise.resolve(
        new Response(JSON.stringify({ mode: "BOT" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await expect(roomApi.create("玩家", 2, "BOT")).resolves.toMatchObject({ mode: "BOT" });
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
