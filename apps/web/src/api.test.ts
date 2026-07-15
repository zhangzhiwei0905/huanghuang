import { afterEach, describe, expect, it, vi } from "vitest";
import { roomApi } from "./api.js";

describe("roomApi", () => {
  afterEach(() => vi.unstubAllGlobals());

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
