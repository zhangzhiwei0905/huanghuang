import { describe, expect, it } from "vitest";
import { chatMessageInputSchema, readyRoomSchema, updateRoomSettingsSchema } from "./commands.js";

describe("room interaction schemas", () => {
  it("accepts explicit readiness and supported base scores", () => {
    expect(readyRoomSchema.parse({ ready: false })).toEqual({ ready: false });
    expect(updateRoomSettingsSchema.parse({ baseScore: 10 })).toEqual({ baseScore: 10 });
    expect(updateRoomSettingsSchema.safeParse({ baseScore: 3 }).success).toBe(false);
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
