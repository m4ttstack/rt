import { mkdir, readFile, writeFile } from "node:fs/promises";
import { windowCacheKey } from "../util/window.js";
import type { Scope, TimeWindow } from "../../shared/types.js";

const CACHE_DIR = ".cache";

/**
 * Bump whenever the cached FetchResult shape changes, so envelopes written by older code
 * are treated as a miss and refetched rather than silently served with missing fields.
 *  v1 -> v2: added FetchResult.linearIssues (the "Issues done" delivery metric).
 *  v2 -> v3: linearIssues gained title + url (for the per-stat detail page).
 *  v3 -> v4: NormMr gained updatedAt (window slicing scopes MRs on it).
 */
const CACHE_SCHEMA_VERSION = 4;

interface CacheEnvelope<T> {
  savedAt: string;
  key: string;
  /** Absent on pre-versioning envelopes ... read as a miss. */
  version?: number;
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

/** Stable string identity for a scope, shared with the incremental MR-list cache. */
export function scopeKey(scope: Scope): string {
  return scope.type === "group" ? `g:${scope.groupPath}` : `p:${(scope.projectPaths ?? []).join(",")}`;
}

/** Cache key for a (scope, window) pair. */
export function cacheKey(scope: Scope, window: TimeWindow): string {
  return `${hash(scopeKey(scope))}-${sanitize(windowCacheKey(window))}`;
}

function pathFor(key: string): string {
  return `${CACHE_DIR}/${key}.json`;
}

export async function readCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await readFile(pathFor(key), "utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    // Schema drift: an envelope from older code is a miss, so callers refetch and
    // overwrite it in place rather than computing metrics over missing fields.
    if (envelope.version !== CACHE_SCHEMA_VERSION) return null;
    return envelope;
  } catch {
    return null; // missing or unreadable ... treat as cache miss
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const envelope: CacheEnvelope<T> = {
    savedAt: new Date().toISOString(),
    key,
    version: CACHE_SCHEMA_VERSION,
    data,
  };
  await writeFile(pathFor(key), JSON.stringify(envelope), "utf8");
}
