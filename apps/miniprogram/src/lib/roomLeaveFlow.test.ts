import { describe, expect, it } from "vitest";
import {
  shouldAcknowledgeMatchBeforeLeaving,
  shouldConfirmTrusteeHandoffBeforeLeaving,
} from "./roomLeaveFlow.js";

describe("shouldAcknowledgeMatchBeforeLeaving", () => {
  it("acknowledges when leaving a MATCH room in ROUND_RESULT (Fix D)", () => {
    // This is the exact stuck loop: leaving the settlement stage without
    // acking left the server thinking the match was still active, so the
    // home page's MATCHED state bounced the player straight back in.
    expect(shouldAcknowledgeMatchBeforeLeaving("MATCH", "ROUND_RESULT")).toBe(true);
  });

  it("does not acknowledge while a MATCH round is still playing", () => {
    expect(shouldAcknowledgeMatchBeforeLeaving("MATCH", "PLAYING")).toBe(false);
  });

  it("does not acknowledge for friend/bot rooms", () => {
    expect(shouldAcknowledgeMatchBeforeLeaving("FRIEND", "ROUND_RESULT")).toBe(false);
    expect(shouldAcknowledgeMatchBeforeLeaving("BOT", "ROUND_RESULT")).toBe(false);
  });
});

describe("shouldConfirmTrusteeHandoffBeforeLeaving", () => {
  it("confirms trustee handoff only for an in-progress competitive round", () => {
    expect(shouldConfirmTrusteeHandoffBeforeLeaving("MATCH", "PLAYING")).toBe(true);
  });

  it("does not confirm once the round has already reached settlement", () => {
    expect(shouldConfirmTrusteeHandoffBeforeLeaving("MATCH", "ROUND_RESULT")).toBe(false);
  });

  it("does not confirm for friend/bot rooms", () => {
    expect(shouldConfirmTrusteeHandoffBeforeLeaving("FRIEND", "PLAYING")).toBe(false);
  });
});
