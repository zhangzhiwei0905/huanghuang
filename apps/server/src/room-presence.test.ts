import { describe, expect, it } from "vitest";
import { RoomPresence } from "./room-presence.js";

describe("RoomPresence", () => {
  it("tracks the first and last socket subscription per room member", () => {
    const presence = new RoomPresence();

    expect(presence.subscribe("room", "player", "socket-a")).toBe(true);
    expect(presence.subscribe("room", "player", "socket-b")).toBe(false);
    expect(presence.unsubscribe("room", "player", "socket-a")).toBe(false);
    expect(presence.unsubscribe("room", "player", "socket-b")).toBe(true);
  });

  it("disconnects one socket from every subscribed room without affecting peers", () => {
    const presence = new RoomPresence();
    presence.subscribe("room-a", "player", "socket-a");
    presence.subscribe("room-a", "player", "socket-b");
    presence.subscribe("room-b", "player", "socket-a");

    expect(presence.disconnect("socket-a")).toEqual([
      { roomId: "room-a", sessionId: "player", lastSubscription: false },
      { roomId: "room-b", sessionId: "player", lastSubscription: true },
    ]);
    expect(presence.isSubscribed("room-a", "player", "socket-b")).toBe(true);
    expect(presence.isSubscribed("room-b", "player", "socket-a")).toBe(false);
  });

  it("is idempotent for repeated subscriptions and unknown removals", () => {
    const presence = new RoomPresence();
    expect(presence.subscribe("room", "player", "socket")).toBe(true);
    expect(presence.subscribe("room", "player", "socket")).toBe(false);
    expect(presence.unsubscribe("room", "player", "missing")).toBe(false);
    expect(presence.unsubscribe("room", "player", "socket")).toBe(true);
    expect(presence.disconnect("socket")).toEqual([]);
  });
});
