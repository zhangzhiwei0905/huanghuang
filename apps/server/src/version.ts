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
