import type { RoomProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { normalizeRoomProjection } from "./roomProjection.js";

describe("normalizeRoomProjection", () => {
  it("upgrades a legacy projection with competitive defaults", () => {
    const legacyProjection = {
      schemaVersion: 8,
      roomId: "legacy-room",
    } as unknown as RoomProjection;

    expect(normalizeRoomProjection(legacyProjection)).toEqual({
      schemaVersion: 9,
      roomId: "legacy-room",
      effectCue: null,
      competitiveMatch: null,
    });
  });

  it("preserves a current projection that already defines v9 fields", () => {
    const projection = {
      schemaVersion: 9,
      effectCue: null,
      competitiveMatch: null,
    } as unknown as RoomProjection;

    expect(normalizeRoomProjection(projection)).toBe(projection);
  });
});
