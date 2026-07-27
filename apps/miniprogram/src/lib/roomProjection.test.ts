import type { RoomProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { normalizeRoomProjection } from "./roomProjection.js";

describe("normalizeRoomProjection", () => {
  it("defaults a schema 5 projection without effectCue to null", () => {
    const legacyProjection = {
      schemaVersion: 5,
      roomId: "legacy-room",
    } as unknown as RoomProjection;

    expect(normalizeRoomProjection(legacyProjection)).toEqual({
      schemaVersion: 5,
      roomId: "legacy-room",
      effectCue: null,
    });
  });

  it("preserves a current projection that already defines effectCue", () => {
    const projection = {
      schemaVersion: 7,
      effectCue: null,
    } as RoomProjection;

    expect(normalizeRoomProjection(projection)).toBe(projection);
  });
});
