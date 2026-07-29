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
      schemaVersion: 10,
      roomId: "legacy-room",
      effectCue: null,
      competitiveMatch: null,
      teamMatchmaking: null,
    });
  });

  it("preserves a current projection that already defines v10 fields", () => {
    const projection = {
      schemaVersion: 10,
      effectCue: null,
      competitiveMatch: null,
      teamMatchmaking: null,
    } as unknown as RoomProjection;

    expect(normalizeRoomProjection(projection)).toBe(projection);
  });
});
