import { readFileSync } from "node:fs";

/**
 * Reads the BUILD_TIME file written by the Docker build stage
 * (deploy/server.Dockerfile). Only present in built images — never in local
 * dev, where this must gracefully fall back instead of throwing.
 */
export function readBuildTime(buildTimePath: string): string {
  try {
    return readFileSync(buildTimePath, "utf8").trim();
  } catch {
    return "unknown";
  }
}

/** The git short sha baked into the image via the APP_REVISION build arg. */
export function readRevision(env: NodeJS.ProcessEnv = process.env): string {
  return env.APP_REVISION ?? "unknown";
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Increments the PATCH segment of a "MAJOR.MINOR.PATCH" string by 1. Only
 * this code ever writes the `app_version.version` column, so a malformed
 * value should never happen in practice — but if it somehow does (manual DB
 * edit, corruption), fall back to "1.0.0" rather than crashing server
 * startup.
 */
export function bumpPatch(version: string): string {
  if (!SEMVER_PATTERN.test(version)) return "1.0.0";
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 1;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return `${major}.${minor}.${patch + 1}`;
}

export type ResolveAppVersionInput = {
  stored: { version: string; lastRevision: string } | null;
  /** From readRevision(). */
  currentRevision: string;
  /** From process.env.APP_VERSION_OVERRIDE, or null if unset. */
  override: string | null;
};

export type ResolveAppVersionResult = {
  version: string;
  bumped: boolean;
};

/**
 * Decides the app's displayed semver for this startup.
 *
 * - `override`: a deliberate manual reset. Set APP_VERSION_OVERRIDE to a
 *   "MAJOR.MINOR.PATCH" string for exactly the one deploy where you want to
 *   force the version to a specific value (e.g. "从 1.2.0 开始"), then
 *   remove the env var again — leaving it set would force the same version
 *   on every subsequent deploy instead of letting the patch auto-increment.
 * - First-ever run (no stored row yet): starts at "1.0.0".
 * - A new deploy (current git revision differs from the last recorded one):
 *   patch bumps by exactly 1, regardless of what changed in the commit.
 * - A plain restart with no rebuild (revision unchanged, e.g. APP_REVISION
 *   stays "unknown" in local dev, or a crash-restart in production reuses
 *   the same image): the stored version is reused as-is, no bump.
 */
export function resolveAppVersion(input: ResolveAppVersionInput): ResolveAppVersionResult {
  if (input.override !== null && SEMVER_PATTERN.test(input.override)) {
    return { version: input.override, bumped: true };
  }
  if (input.stored === null) {
    return { version: "1.0.0", bumped: true };
  }
  if (input.currentRevision !== input.stored.lastRevision) {
    return { version: bumpPatch(input.stored.version), bumped: true };
  }
  return { version: input.stored.version, bumped: false };
}
