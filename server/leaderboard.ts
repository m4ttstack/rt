import { config } from "../config.js";
import { cacheKey, readCache, writeCache } from "./cache/store.js";
import { getEnv, type Env } from "./env.js";
import { computeSnapshot, type Snapshot } from "./metrics/snapshot.js";
import { buildResponse, type BuildContext } from "./metrics/trend.js";
import { fetchAll, type FetchOutcome } from "./pipeline/fetch.js";
import { priorWindow } from "./util/window.js";
import type { LeaderboardResponse, Scope, TimeWindow } from "../shared/types.js";

export interface LeaderboardOptions {
  window: TimeWindow;
  refresh: boolean;
  /** When false, the prior window is not fetched (faster) and no deltas are produced. */
  trend: boolean;
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
): Promise<{ outcome: FetchOutcome; fromCache: boolean }> {
  const key = cacheKey(scope, window);
  if (!refresh) {
    const cached = await readCache<FetchOutcome>(key);
    if (cached) return { outcome: cached.data, fromCache: true };
  }
  const outcome = await fetchAll({
    env,
    scope,
    window,
    users: config.users,
    concurrency: config.concurrency,
  });
  await writeCache(key, outcome);
  return { outcome, fromCache: false };
}

const snapshotFor = (outcome: FetchOutcome, window: TimeWindow): Snapshot =>
  computeSnapshot(outcome.result, { window, users: config.users, sizeBand: config.sizeBand });

/** Orchestrator: fetch (cached) -> compute current + prior snapshots -> build response with trend. */
export async function getLeaderboard(opts: LeaderboardOptions): Promise<LeaderboardResponse> {
  const env = getEnv();
  const scope = resolveScope();
  const pw = priorWindow(opts.window);

  const current = await loadOrFetch(env, scope, opts.window, opts.refresh);
  const warnings = [...current.outcome.warnings];

  // Prior window drives the self-vs-self trend. Only fetched when requested (it doubles
  // the work). Compute once, then it's cached. A failure must not break the current view.
  let priorSnapshot: Snapshot | null = null;
  if (opts.trend) {
    try {
      const prior = await loadOrFetch(env, scope, pw, false);
      priorSnapshot = snapshotFor(prior.outcome, pw);
    } catch (err) {
      warnings.push({
        code: "trend_unavailable",
        message: `Prior-window data unavailable, deltas hidden: ${(err as Error).message}`,
      });
    }
  }

  const ctx: BuildContext = {
    scope,
    window: opts.window,
    priorWindow: priorSnapshot ? pw : null,
    baseUrl: env.baseUrl,
    currentUser: config.currentUser,
    generatedAt: new Date().toISOString(),
    fromCache: current.fromCache,
    identities: current.outcome.identities,
    warnings,
  };

  return buildResponse(snapshotFor(current.outcome, opts.window), priorSnapshot, ctx);
}
