import Taro from "@tarojs/taro";

// The mini-program main package has a hard 2MB limit from WeChat. Bundling
// all 37 game sound effects locally pushed the package over that limit, so
// they live in WeChat Cloud Storage instead and are streamed at runtime.
const CLOUD_ENV_ID = "cloud1-d6g7jl5kade1bad81";
const CLOUD_BUCKET_DOMAIN = "636c-cloud1-d6g7jl5kade1bad81-1418854253";
const CLOUD_FOLDER = "mp3-version";

let cloudInitialized = false;

function ensureCloudInitialized(): void {
  if (cloudInitialized) return;
  cloudInitialized = true;
  // Taro.cloud is undefined outside a real weapp runtime (e.g. this file's
  // own vitest suite, which mocks "@tarojs/taro" with only the APIs it
  // needs) — never let a missing cloud SDK crash audio setup.
  try {
    Taro.cloud?.init({ env: CLOUD_ENV_ID });
  } catch {
    // Nothing to recover here; resolveAudioFileUrls will simply keep
    // returning an empty map and every play() call becomes a silent no-op.
  }
}

export function cloudFileId(fileName: string): string {
  return `cloud://${CLOUD_ENV_ID}.${CLOUD_BUCKET_DOMAIN}/${CLOUD_FOLDER}/${fileName}`;
}

let resolvedUrls: Promise<Map<string, string>> | null = null;

/**
 * Resolves every cloud audio file ID to a playable HTTPS URL, once per
 * "session" (cached across calls and across GameAudioPlayer instances).
 * WeChat's temp URLs for a *private* storage bucket expire after 10
 * minutes — well inside a single mahjong round — so a failed play() call
 * (stale/expired URL) drops the cache and the next play() re-resolves
 * fresh URLs instead of retrying the same dead one. Making the storage
 * bucket public-read avoids this expiry entirely; ask before relying on
 * this fallback path in production.
 */
export function resolveAudioFileUrls(fileNames: readonly string[]): Promise<Map<string, string>> {
  ensureCloudInitialized();
  if (resolvedUrls === null) {
    resolvedUrls = (async () => {
      try {
        const idToName = new Map(fileNames.map((name) => [cloudFileId(name), name] as const));
        const result = await Taro.cloud.getTempFileURL({ fileList: [...idToName.keys()] });
        const map = new Map<string, string>();
        for (const item of result.fileList) {
          const name = idToName.get(item.fileID);
          if (name !== undefined && item.tempFileURL.length > 0) map.set(name, item.tempFileURL);
        }
        return map;
      } catch {
        return new Map<string, string>();
      }
    })();
  }
  return resolvedUrls;
}

export function invalidateAudioFileUrls(): void {
  resolvedUrls = null;
}
