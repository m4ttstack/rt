import { mkdir, readFile, writeFile } from "node:fs/promises";
import { windowCacheKey } from "../util/window.js";
import type { Scope, TimeWindow } from "../../shared/types.js";

const CACHE_DIR = ".cache";

interface CacheEnvelope<T> {
  savedAt: string;
  key: string;
  data: T;
}

/** Stable, dependency-free string hash (djb2) for the scope component of the key. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9.\-]/gi, "_");
}

/** Cache key for a (scope, window) pair. */
export function cacheKey(scope: Scope, window: TimeWindow): string {
  const scopeStr =
    scope.type === "group" ? `g:${scope.groupPath}` : `p:${(scope.projectPaths ?? []).join(",")}`;
  return `${hash(scopeStr)}-${sanitize(windowCacheKey(window))}`;
}

function pathFor(key: string): string {
  return `${CACHE_DIR}/${key}.json`;
}

export async function readCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await readFile(pathFor(key), "utf8");
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null; // missing or unreadable ... treat as cache miss
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const envelope: CacheEnvelope<T> = {
    savedAt: new Date().toISOString(),
    key,
    data,
  };
  await writeFile(pathFor(key), JSON.stringify(envelope), "utf8");
}
