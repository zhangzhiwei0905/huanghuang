import { describe, expect, it } from "vitest";
import { CHECKIN_MILESTONES as PROTOCOL_MILESTONES } from "@huanghuang/protocol";
import {
  CHECKIN_ITEM_NAMES,
  CHECKIN_MILESTONES,
  checkinCellStates,
  milestoneDateLabel,
} from "./checkinRewards.js";

describe("checkinCellStates", () => {
  it("marks nothing achieved and day 1 claimable on a fresh week", () => {
    expect(checkinCellStates(0, false)).toEqual([
      "NEXT",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
    ]);
  });

  it("marks reached milestones achieved and the next unsigned day claimable", () => {
    expect(checkinCellStates(3, false)).toEqual([
      "ACHIEVED",
      "ACHIEVED",
      "ACHIEVED",
      "NEXT",
      "LOCKED",
      "LOCKED",
      "LOCKED",
    ]);
  });

  it("leaves no claimable cell once today is already signed", () => {
    expect(checkinCellStates(3, true)).toEqual([
      "ACHIEVED",
      "ACHIEVED",
      "ACHIEVED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
      "LOCKED",
    ]);
  });

  it("marks all seven achieved at the end of a full week", () => {
    expect(checkinCellStates(7, true)).toEqual(Array(7).fill("ACHIEVED"));
  });

  it("mirrors the protocol's authoritative milestone table", () => {
    // The client cannot bundle protocol runtime exports, so the page renders a
    // local mirror; fail loudly if the server-side table ever drifts.
    expect([...CHECKIN_MILESTONES]).toEqual([...PROTOCOL_MILESTONES]);
    expect(CHECKIN_MILESTONES.map((milestone) => milestone.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(CHECKIN_MILESTONES.map((milestone) => `${milestone.item}:${milestone.amount}`)).toEqual(
      [
        "PROTECTION_CARD:1",
        "PROTECTION_CARD:3",
        "PROTECTION_CARD:8",
        "WIN_DOUBLE_CARD:1",
        "WIN_DOUBLE_CARD:2",
        "WIN_DOUBLE_CARD:3",
        "RANK_PROTECTION_CARD:1",
      ],
    );
    for (const milestone of CHECKIN_MILESTONES) {
      expect(CHECKIN_ITEM_NAMES[milestone.item]).toBeTypeOf("string");
    }
  });
});

describe("milestoneDateLabel", () => {
  it("offsets from the Monday week start", () => {
    // 2026-08-03 is a Monday.
    expect(milestoneDateLabel("2026-08-03", 1)).toEqual({ dateText: "8/3", weekday: "周一" });
    expect(milestoneDateLabel("2026-08-03", 7)).toEqual({ dateText: "8/9", weekday: "周日" });
  });

  it("rolls across month boundaries", () => {
    // Monday 2026-08-31: day 1..7 crosses into September.
    expect(milestoneDateLabel("2026-08-31", 1)).toEqual({ dateText: "8/31", weekday: "周一" });
    expect(milestoneDateLabel("2026-08-31", 2)).toEqual({ dateText: "9/1", weekday: "周二" });
    expect(milestoneDateLabel("2026-08-31", 7)).toEqual({ dateText: "9/6", weekday: "周日" });
  });
});
