import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bumpPatch, readBuildTime, readRevision, resolveAppVersion } from "./version.js";

describe("readRevision", () => {
  it("returns the APP_REVISION env var when set", () => {
    expect(readRevision({ APP_REVISION: "abc1234" })).toBe("abc1234");
  });

  it("falls back to unknown when APP_REVISION is unset", () => {
    expect(readRevision({})).toBe("unknown");
  });
});

describe("readBuildTime", () => {
  let dir = "";

  afterEach(() => {
    if (dir.length > 0) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the trimmed file contents when the BUILD_TIME file exists", () => {
    dir = mkdtempSync(join(tmpdir(), "huanghuang-build-time-"));
    const path = join(dir, "BUILD_TIME");
    writeFileSync(path, "2026-07-29T00:00:00Z\n");

    expect(readBuildTime(path)).toBe("2026-07-29T00:00:00Z");
  });

  it("returns unknown when the BUILD_TIME file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "huanghuang-build-time-"));
    const missingPath = join(dir, "BUILD_TIME");

    expect(readBuildTime(missingPath)).toBe("unknown");
  });
});

describe("bumpPatch", () => {
  it("increments the patch segment", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
    expect(bumpPatch("1.2.9")).toBe("1.2.10");
  });

  it("falls back to 1.0.0 for a malformed version string", () => {
    expect(bumpPatch("abc")).toBe("1.0.0");
    expect(bumpPatch("1.0")).toBe("1.0.0");
  });
});

describe("resolveAppVersion", () => {
  it("starts at 1.0.0 on the first-ever run (no stored row)", () => {
    expect(
      resolveAppVersion({ stored: null, currentRevision: "abc1234", override: null }),
    ).toEqual({ version: "1.0.0", bumped: true });
  });

  it("reuses the stored version when the revision is unchanged", () => {
    expect(
      resolveAppVersion({
        stored: { version: "1.0.3", lastRevision: "abc1234" },
        currentRevision: "abc1234",
        override: null,
      }),
    ).toEqual({ version: "1.0.3", bumped: false });
  });

  it("bumps the patch when the revision changed", () => {
    expect(
      resolveAppVersion({
        stored: { version: "1.0.3", lastRevision: "abc1234" },
        currentRevision: "def5678",
        override: null,
      }),
    ).toEqual({ version: "1.0.4", bumped: true });
  });

  it("uses a valid override regardless of stored state", () => {
    expect(
      resolveAppVersion({
        stored: { version: "1.0.3", lastRevision: "abc1234" },
        currentRevision: "abc1234",
        override: "1.2.0",
      }),
    ).toEqual({ version: "1.2.0", bumped: true });
  });

  it("ignores a malformed override and falls through to normal logic", () => {
    expect(
      resolveAppVersion({
        stored: { version: "1.0.3", lastRevision: "abc1234" },
        currentRevision: "abc1234",
        override: "abc",
      }),
    ).toEqual({ version: "1.0.3", bumped: false });

    expect(
      resolveAppVersion({
        stored: { version: "1.0.3", lastRevision: "abc1234" },
        currentRevision: "def5678",
        override: "1.0",
      }),
    ).toEqual({ version: "1.0.4", bumped: true });
  });
});
