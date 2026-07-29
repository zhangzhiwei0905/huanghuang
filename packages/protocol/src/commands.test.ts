import { describe, expect, it } from "vitest";
import {
  chatMessageInputSchema,
  createRoomSchema,
  joinRoomSchema,
  readyRoomSchema,
  removeRoomBotSchema,
  roomCodeSchema,
  roomModeSchema,
  updateRoomSettingsSchema,
} from "./commands.js";

describe("room interaction schemas", () => {
  it("accepts explicit readiness and supported base scores", () => {
    expect(readyRoomSchema.parse({ ready: false })).toEqual({ ready: false });
    expect(updateRoomSettingsSchema.parse({ baseScore: 10 })).toEqual({ baseScore: 10 });
    expect(updateRoomSettingsSchema.parse({ botDifficulty: "LOW" })).toEqual({
      botDifficulty: "LOW",
    });
    expect(updateRoomSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateRoomSettingsSchema.safeParse({ baseScore: 3 }).success).toBe(false);
    expect(updateRoomSettingsSchema.safeParse({ botDifficulty: "MEDIUM" }).success).toBe(false);
    expect(removeRoomBotSchema.parse({ seat: 3 })).toEqual({ seat: 3 });
    expect(removeRoomBotSchema.safeParse({ seat: 4 }).success).toBe(false);
  });

  it("accepts only supported create settings and supplies compatibility defaults", () => {
    const parsedLegacy = createRoomSchema.parse({
      nickname: "房主",
      baseScore: 2,
      mode: "FRIEND",
    });
    expect(parsedLegacy.turnTimeoutSeconds).toBe(20);
    expect(parsedLegacy.botDifficulty).toBe("HIGH");
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
    expect(
      createRoomSchema.safeParse({
        nickname: "房主",
        baseScore: 2,
        mode: "BOT",
        botDifficulty: "LOW",
      }).success,
    ).toBe(true);
  });

  it("decodes MATCH room projections without allowing clients to create MATCH rooms", () => {
    expect(roomModeSchema.parse("MATCH")).toBe("MATCH");
    expect(roomModeSchema.parse("TEAM_MATCH")).toBe("TEAM_MATCH");
    expect(
      createRoomSchema.safeParse({ nickname: "玩家", baseScore: 2, mode: "TEAM_MATCH" }).success,
    ).toBe(true);
    expect(
      createRoomSchema.safeParse({ nickname: "玩家", baseScore: 2, mode: "MATCH" }).success,
    ).toBe(false);
  });

  it("accepts new four-digit room codes and active legacy six-digit codes", () => {
    for (const roomCode of ["1000", "9999", "123456"]) {
      expect(roomCodeSchema.safeParse(roomCode).success).toBe(true);
      expect(joinRoomSchema.safeParse({ nickname: "玩家", roomCode }).success).toBe(true);
    }
    for (const roomCode of ["0123", "123", "12345", "1234567", "abcd"]) {
      expect(roomCodeSchema.safeParse(roomCode).success).toBe(false);
    }
  });

  it("trims chat messages and rejects empty or oversized content", () => {
    expect(chatMessageInputSchema.parse({ roomCode: "1234", message: "  你好  " })).toEqual({
      roomCode: "1234",
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
