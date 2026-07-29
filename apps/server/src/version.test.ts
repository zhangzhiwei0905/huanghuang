import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBuildTime, readRevision } from "./version.js";

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
