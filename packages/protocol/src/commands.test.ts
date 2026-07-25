import { describe, expect, it } from "vitest";
import {
  chatMessageInputSchema,
  createRoomSchema,
  readyRoomSchema,
  updateRoomSettingsSchema,
} from "./commands.js";

describe("room interaction schemas", () => {
  it("accepts explicit readiness and supported base scores", () => {
    expect(readyRoomSchema.parse({ ready: false })).toEqual({ ready: false });
    expect(updateRoomSettingsSchema.parse({ baseScore: 10 })).toEqual({ baseScore: 10 });
    expect(updateRoomSettingsSchema.safeParse({ baseScore: 3 }).success).toBe(false);
  });

  it("accepts only supported turn timeouts and defaults legacy create requests to 20 seconds", () => {
    expect(
      createRoomSchema.parse({
        nickname: "房主",
        baseScore: 2,
        mode: "FRIEND",
      }).turnTimeoutSeconds,
    ).toBe(20);
    for (const turnTimeoutSeconds of [20, 25, 30]) {
      expect(
        createRoomSchema.safeParse({
          nickname: "房主",
          baseScore: 2,
          mode: "FRIEND",
          turnTimeoutSeconds,
        }).success,
      ).toBe(true);
    }
    expect(
      createRoomSchema.safeParse({
        nickname: "房主",
        baseScore: 2,
        mode: "FRIEND",
        turnTimeoutSeconds: 15,
      }).success,
    ).toBe(false);
  });

  it("trims chat messages and rejects empty or oversized content", () => {
    expect(chatMessageInputSchema.parse({ roomCode: "123456", message: "  你好  " })).toEqual({
      roomCode: "123456",
      message: "你好",
    });
    expect(chatMessageInputSchema.safeParse({ roomCode: "123456", message: "   " }).success).toBe(
      false,
    );
    expect(
      chatMessageInputSchema.safeParse({ roomCode: "123456", message: "a".repeat(61) }).success,
    ).toBe(false);
  });
});
