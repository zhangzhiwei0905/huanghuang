import { describe, expect, it } from "vitest";
import { rankProtectionCountdownText } from "./backpack.js";

describe("rankProtectionCountdownText", () => {
  const now = Date.parse("2026-08-03T10:00:00.000Z");

  it("formats the remaining time as HH:MM:SS", () => {
    // 2h stack => 01:59:59 left one second into the window.
    const until = new Date(now + 2 * 3_600_000).toISOString();
    expect(rankProtectionCountdownText(until, now + 1_000)).toBe("01:59:59");
  });

  it("rounds up so the final second stays visible", () => {
    const until = new Date(now + 1_000).toISOString();
    expect(rankProtectionCountdownText(until, now + 1)).toBe("00:00:01");
  });

  it("keeps hours beyond a day unpadded past two digits", () => {
    // 4h stack: the second card extends the window to +4h total.
    const until = new Date(now + 4 * 3_600_000).toISOString();
    expect(rankProtectionCountdownText(until, now)).toBe("04:00:00");
  });

  it("returns null once the target time has passed", () => {
    const until = new Date(now).toISOString();
    expect(rankProtectionCountdownText(until, now)).toBeNull();
    expect(rankProtectionCountdownText(until, now + 1_000)).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(rankProtectionCountdownText("not-a-date", now)).toBeNull();
  });
});
