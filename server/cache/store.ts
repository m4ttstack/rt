import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { windowCacheKey } from "../util/window.js";
import type { Scope, TimeWindow } from "../../shared/types.js";

/**
 * Where envelopes live. Overridable so tests get their own directory: the test scope is
 * derived from the same config the server uses, so a test warming "the current base
 * window" computes the byte-identical key the running server just wrote, and its cleanup
 * would delete the live cache out from under the app.
 */
export const CACHE_DIR = process.env.BOXSCORE_CACHE_DIR ?? ".cache";

/**
 * Bump whenever the cached FetchResult shape changes, so envelopes written by older code
 * are treated as a miss and refetched rather than silently served with missing fields.
 *  v1 -> v2: added FetchResult.linearIssues (the "Issues done" delivery metric).
 *  v2 -> v3: linearIssues gained title + url (for the per-stat detail page).
 *  v3 -> v4: NormMr gained updatedAt (window slicing scopes MRs on it).
 *  v4 -> v5: v4 envelopes could hold store-hydrated MRs missing updatedAt (the store predates
 *            the field), which sliceOutcome silently dropped along with their Linear tickets.
 */
const CACHE_SCHEMA_VERSION = 5;

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

/**
 * How stale a superset envelope may be and still stand in for a different key.
 *
 * 24h is the staleness an exact-key hit already tolerates: the base window's key only
 * changes when the UTC day rolls, so a hit served just before the roll is a full day
 * old. Reuse widens WHICH envelope can answer a request, not how stale an answer gets.
 */
const MAX_REUSE_AGE_MS = 24 * 60 * 60 * 1000;

/** The filename shape writeCache produces: <scopeHash>-<windowKey>_<start>..<end>.json */
const ENVELOPE_FILE = /^([0-9a-z]+)-(.+)_(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Find a cached envelope that already contains `window`, under some other key.
 *
 * The base window is 90 days ending "now", so its key rolls every UTC midnight and an
 * envelope fetched hours earlier becomes unreachable by exact key while still holding a
 * superset of what the next request wants. Slicing that superset beats refetching 90
 * days to gain the few hours at its edge.
 */
export async function readCoveringCache<T>(
  scope: Scope,
  window: TimeWindow,
  now: Date = new Date(),
): Promise<CacheEnvelope<T> | null> {
  let files: string[];
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return null; // no cache dir yet
  }

  const prefix = hash(scopeKey(scope));
  const targetStart = Date.parse(window.start.slice(0, 10));
  const cutoff = now.getTime() - MAX_REUSE_AGE_MS;

  const candidates: { key: string; mtime: number }[] = [];
  for (const name of files) {
    const m = ENVELOPE_FILE.exec(name);
    if (!m) continue;
    const [, scopeHash, , startDay] = m;
    if (scopeHash !== prefix || !startDay) continue;
    // Only the start is compared. Envelopes are fetched with no upper bound on updatedAt
    // (fetch.ts:153), so contents run from the start day to whenever the file was written
    // ... the end day in the key is metadata. An earlier start is therefore a superset
    // sliceOutcome can trim, and how far the data actually reaches is the savedAt check.
    if (Date.parse(startDay) > targetStart) continue;
    let mtime: number;
    try {
      mtime = (await stat(`${CACHE_DIR}/${name}`)).mtimeMs;
    } catch {
      continue; // vanished between readdir and stat
    }
    // mtime is never earlier than savedAt (the file is written at savedAt), so an mtime
    // past the cutoff proves savedAt is too. Filtering here avoids reading a multi-MB file.
    if (mtime < cutoff) continue;
    candidates.push({ key: name.slice(0, -".json".length), mtime });
  }

  // Freshest first: any superset slices correctly, so the only thing to choose on is age.
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    const envelope = await readCache<T>(c.key);
    if (!envelope) continue; // schema drift or unreadable
    if (Date.parse(envelope.savedAt) < cutoff) continue;
    return envelope;
  }
  return null;
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
