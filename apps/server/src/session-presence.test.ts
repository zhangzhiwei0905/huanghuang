import { describe, expect, it } from "vitest";
import { SessionPresence } from "./session-presence.js";

describe("SessionPresence", () => {
  it("reports only the first connection and last disconnection as state transitions", () => {
    const presence = new SessionPresence();

    expect(presence.connect("player", "socket-a")).toBe("FIRST_CONNECTED");
    expect(presence.connect("player", "socket-b")).toBe("STILL_CONNECTED");
    expect(presence.count("player")).toBe(2);
    expect(presence.disconnect("player", "socket-a")).toBe("STILL_CONNECTED");
    expect(presence.isConnected("player")).toBe(true);
    expect(presence.disconnect("player", "socket-b")).toBe("LAST_DISCONNECTED");
    expect(presence.isConnected("player")).toBe(false);
  });

  it("is idempotent for repeated socket ids and unknown disconnects", () => {
    const presence = new SessionPresence();

    expect(presence.disconnect("player", "missing")).toBe("ALREADY_DISCONNECTED");
    expect(presence.connect("player", "socket-a")).toBe("FIRST_CONNECTED");
    expect(presence.connect("player", "socket-a")).toBe("STILL_CONNECTED");
    expect(presence.count("player")).toBe(1);
    expect(presence.disconnect("player", "socket-a")).toBe("LAST_DISCONNECTED");
    expect(presence.disconnect("player", "socket-a")).toBe("ALREADY_DISCONNECTED");
  });
});
