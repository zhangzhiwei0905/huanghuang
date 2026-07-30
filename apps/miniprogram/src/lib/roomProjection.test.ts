import type { RoomProjection } from "@huanghuang/protocol";
import { describe, expect, it } from "vitest";
import { normalizeRoomProjection, shouldAcceptRoomProjection } from "./roomProjection.js";

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

describe("shouldAcceptRoomProjection", () => {
  it("accepts anything when there is no current room", () => {
    const next = { roomId: "room-a", version: 0 } as unknown as RoomProjection;
    expect(shouldAcceptRoomProjection(null, next)).toBe(true);
  });

  it("rejects a stale (lower-version) update for the same room", () => {
    const current = { roomId: "room-a", version: 5 } as unknown as RoomProjection;
    const next = { roomId: "room-a", version: 4 } as unknown as RoomProjection;
    expect(shouldAcceptRoomProjection(current, next)).toBe(false);
  });

  it("accepts an equal-or-newer version for the same room", () => {
    const current = { roomId: "room-a", version: 5 } as unknown as RoomProjection;
    const next = { roomId: "room-a", version: 5 } as unknown as RoomProjection;
    expect(shouldAcceptRoomProjection(current, next)).toBe(true);
  });

  it("accepts a different room's projection even at a lower version", () => {
    // Regression: team-ranked matchmaking hands off from a long-lived party
    // lobby room (which has accumulated a high version from invites/ready
    // toggles) to a freshly created match room that always starts at
    // version 0. The old version-only guard rejected this switch and left
    // players stuck on the lobby screen forever after the match was found.
    const current = { roomId: "lobby-room", version: 7 } as unknown as RoomProjection;
    const next = { roomId: "match-room", version: 0 } as unknown as RoomProjection;
    expect(shouldAcceptRoomProjection(current, next)).toBe(true);
  });
});
