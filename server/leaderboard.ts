import { config } from "../config.js";
import { cacheKey, readCache, writeCache } from "./cache/store.js";
import { getEnv, type Env } from "./env.js";
import { getSettings } from "./settings.js";
import { buildUserEvidence } from "./metrics/evidence.js";
import { computeSnapshot, type Snapshot } from "./metrics/snapshot.js";
import { buildResponse, type BuildContext } from "./metrics/trend.js";
import { fetchAll, type FetchOutcome } from "./pipeline/fetch.js";
import { priorWindow } from "./util/window.js";
import type { LeaderboardResponse, RefreshProgress, Scope, TimeWindow, UserDetailResponse } from "../shared/types.js";

/** Thrown by loadOrFetch when cacheOnly is set and the window has no cached envelope. */
export class ColdCacheError extends Error {
  override readonly name = "ColdCacheError";
}

export interface LeaderboardOptions {
  window: TimeWindow;
  refresh: boolean;
  /** When false, the prior window is not fetched (faster) and no deltas are produced. */
  trend: boolean;
  signal?: AbortSignal;
  onProgress?: (p: RefreshProgress) => void;
  /** When true, never fetch: a cache miss throws ColdCacheError instead of hitting the network. */
  cacheOnly?: boolean;
}

/** Wrap a window-agnostic reporter to stamp the window. Exported for testing. */
export function withWindow(
  window: "current" | "prior",
  onProgress?: (p: RefreshProgress) => void,
): ((p: Omit<RefreshProgress, "window">) => void) | undefined {
  if (!onProgress) return undefined;
  return (p) => onProgress({ ...p, window });
}

export interface DetailOptions extends LeaderboardOptions {
  /** GitLab username to drill into. */
  user: string;
}

export class UnknownUserError extends Error {
  override readonly name = "UnknownUserError";
}

function resolveScope(): Scope {
  if (config.groupPath && config.groupPath.length > 0) {
    return { type: "group", groupPath: config.groupPath };
  }
  return { type: "projects", projectPaths: config.projectPaths ?? [] };
}

/** Fetch a window's data, using the .cache/ envelope unless refresh was requested. */
async function loadOrFetch(
  env: Env,
  scope: Scope,
  window: TimeWindow,
  refresh: boolean,
  cacheOnly: boolean,
  signal?: AbortSignal,
  onProgress?: (p: Omit<RefreshProgress, "window">) => void,
): Promise<{ outcome: FetchOutcome; fromCache: boolean }> {
  const key = cacheKey(scope, window);
  if (!refresh) {
    const cached = await readCache<FetchOutcome>(key);
    if (cached) return { outcome: cached.data, fromCache: true };
    if (cacheOnly) throw new ColdCacheError(`no cache for ${key}`);
  }
  const outcome = await fetchAll({
    env,
    scope,
    window,
    users: getSettings().users,
    concurrency: config.concurrency,
    signal,
    onProgress,
  });
  await writeCache(key, outcome);
  return { outcome, fromCache: false };
}

/** The settings-derived options shared by snapshot and evidence computation. */
function metricOptionsFromSettings() {
  const s = getSettings();
  return {
    users: s.users,
    sizeBand: s.sizeBand,
    linearTeam: s.linearTeam || undefined,
    doneStates: s.doneStates,
    extraBotPatterns: s.bots.extraPatterns,
    excludeFilePatterns: s.excludeFilePatterns,
    ignoredMrs: s.ignoredMrs,
  };
}

const snapshotFor = (outcome: FetchOutcome, window: TimeWindow): Snapshot =>
  computeSnapshot(outcome.result, { window, ...metricOptionsFromSettings() });

/**
 * Shared core: fetch (cached) -> compute current + prior snapshots -> ranked response.
 * Returns the current FetchOutcome too, so the detail endpoint can build evidence from the
 * same raw data without a second cache read.
 */
async function buildLeaderboard(
  opts: LeaderboardOptions,
): Promise<{ response: LeaderboardResponse; current: FetchOutcome; env: Env }> {
  const env = getEnv();
  const scope = resolveScope();
  const pw = priorWindow(opts.window);

  const current = await loadOrFetch(env, scope, opts.window, opts.refresh, opts.cacheOnly ?? false, opts.signal, withWindow("current", opts.onProgress));
  const warnings = [...current.outcome.warnings];

  // Prior window drives the self-vs-self trend. Only fetched when requested (it doubles
  // the work). Compute once, then it's cached. A failure must not break the current view.
  let priorSnapshot: Snapshot | null = null;
  if (opts.trend) {
    try {
      const prior = await loadOrFetch(env, scope, pw, false, opts.cacheOnly ?? false, opts.signal, withWindow("prior", opts.onProgress));
      priorSnapshot = snapshotFor(prior.outcome, pw);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      warnings.push({
        code: "trend_unavailable",
        message: `Prior-window data unavailable, deltas hidden: ${(err as Error).message}`,
      });
    }
  }

  opts.onProgress?.({ phase: "compute", label: "Computing metrics", done: 0, total: 0, window: "current" });

  const ctx: BuildContext = {
    scope,
    window: opts.window,
    priorWindow: priorSnapshot ? pw : null,
    baseUrl: env.baseUrl,
    currentUser: getSettings().currentUser,
    generatedAt: new Date().toISOString(),
    fromCache: current.fromCache,
    identities: current.outcome.identities,
    warnings,
  };

  return {
    response: buildResponse(snapshotFor(current.outcome, opts.window), priorSnapshot, ctx),
    current: current.outcome,
    env,
  };
}

/** Orchestrator: fetch (cached) -> compute current + prior snapshots -> build response with trend. */
export async function getLeaderboard(opts: LeaderboardOptions): Promise<LeaderboardResponse> {
  return (await buildLeaderboard(opts)).response;
}

/**
 * Per-person drill-down: the same ranked row the leaderboard shows (value + rank + delta for
 * the rail) plus per-metric evidence built from the same cached raw data.
 */
export async function getUserDetail(opts: DetailOptions): Promise<UserDetailResponse> {
  const { response, current, env } = await buildLeaderboard(opts);
  const userRow = response.users.find((u) => u.username === opts.user);
  if (!userRow) {
    throw new UnknownUserError(`Unknown user "${opts.user}" (not in the configured set).`);
  }

  const { users: _users, ...evidenceOpts } = metricOptionsFromSettings();
  const evidence = buildUserEvidence(current.result, opts.user, {
    window: opts.window,
    baseUrl: env.baseUrl,
    ...evidenceOpts,
  });

  return {
    window: response.window,
    priorWindow: response.priorWindow,
    hasTrend: response.hasTrend,
    baseUrl: response.baseUrl,
    currentUser: response.currentUser,
    generatedAt: response.generatedAt,
    fromCache: response.fromCache,
    user: userRow,
    evidence,
    warnings: response.warnings,
  };
}
