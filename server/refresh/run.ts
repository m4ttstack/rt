import { isRevertTitle } from "../../shared/reverts.js";
import type { LeaderboardWarning, RefreshProgress, TimeWindow } from "../../shared/types.js";
import type { BoxscoreSettings, Env } from "../config/index.js";
import { CONCURRENCY } from "../config/index.js";
import { eligibleForLinearDiscovery, resolveLinearTickets } from "../linear/fetch.js";
import {
  fetchMetrics,
  fetchPipelinesFor,
  fetchProjectRef,
  fetchPushesFor,
  resolveIdentity,
  scanProject,
} from "../source/index.js";
import type { GitProvider, SourceProvider } from "../source/index.js";
import { mrKey } from "../store/index.js";
import type { Store, StoredIdentity, StoredMetrics } from "../store/index.js";
import { buildFetchResult, storedIdentities } from "../store/query.js";
import { mapLimit } from "../util/concurrency.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many fetched MR metrics to buffer before writing them to the store. */
const PERSIST_BATCH = 25;

export interface RefreshRunOptions {
  store: Store;
  provider: GitProvider;
  settings: BoxscoreSettings;
  env: Env;
  window: TimeWindow;
  signal?: AbortSignal;
  onProgress?: (p: Omit<RefreshProgress, "window">) => void;
}

const isAbort = (err: unknown): boolean => (err as Error).name === "AbortError";

/**
 * Where a project's index scan starts: incrementally from its watermark, unless the
 * window reaches back past everything scanned so far, in which case from the window's
 * start so the older range is backfilled rather than skipped. Upserts are keyed by
 * project:iid, so re-scanning the overlap is idempotent.
 */
function scanFrom(store: Store, projectPath: string, windowStart: string): string {
  const watermark = store.lastScan(projectPath);
  const floor = store.scanFloor(projectPath);
  if (watermark === null || floor === null) return windowStart;
  return Date.parse(windowStart) < Date.parse(floor) ? windowStart : watermark;
}

/**
 * Spec 7.3's six-step refresh, run directly against the store. Per-item failures are
 * recorded as warnings and do not stop the run; only an abort or a total failure throws.
 */
export async function runRefresh(opts: RefreshRunOptions): Promise<LeaderboardWarning[]> {
  const { store, provider, settings, env, window, signal, onProgress } = opts;
  const report = onProgress ?? (() => {});
  const warnings: LeaderboardWarning[] = [];
  // GitProvider declares these methods optional (GitHub doesn't implement all of them);
  // a real GitLabProvider satisfies SourceProvider's required surface structurally.
  const source = provider as unknown as SourceProvider;

  // The full roster (visible + hidden): hiding a user must not stop their data refreshing (spec 7.3).
  const rosterUsernames = settings.roster.map((r) => r.username);

  // Step 1: resolve identities missing from the store or older than a day.
  signal?.throwIfAborted();
  const now = Date.now();
  const existingIdentities = new Map(store.identities(rosterUsernames).map((i) => [i.username, i]));
  const staleUsers = rosterUsernames.filter((u) => {
    const existing = existingIdentities.get(u);
    return !existing || now - Date.parse(existing.fetchedAt) > DAY_MS;
  });
  report({ phase: "users", label: "Resolving users", done: 0, total: staleUsers.length });
  const resolved: StoredIdentity[] = [];
  await mapLimit(
    staleUsers,
    CONCURRENCY,
    async (username) => {
      signal?.throwIfAborted();
      try {
        const identity = await resolveIdentity(source, username, { signal });
        resolved.push(identity);
        if (!identity.resolved) {
          warnings.push({ code: "user_unresolved", message: `Username not found: ${username}` });
        }
      } catch (err) {
        if (isAbort(err)) throw err;
        resolved.push({ username, name: null, resolved: false, userId: null, fetchedAt: new Date().toISOString() });
        warnings.push({
          code: "user_lookup_failed",
          message: `Lookup failed for ${username}: ${(err as Error).message}`,
        });
      }
    },
    (done, total) => report({ phase: "users", label: "Resolving users", done, total }),
  );
  if (resolved.length > 0) store.upsertIdentities(resolved);

  // Step 2: per-project MR index scan. A failed project leaves its watermark untouched
  // and does not block the others (the headline defect fix).
  signal?.throwIfAborted();
  const scanStart = new Date().toISOString();
  report({ phase: "mrs-list", label: "Scanning projects", done: 0, total: settings.projects.length });
  await mapLimit(
    settings.projects,
    CONCURRENCY,
    async (projectPath) => {
      signal?.throwIfAborted();
      const updatedAfter = scanFrom(store, projectPath, window.start);
      try {
        const rows = await scanProject(source, projectPath, updatedAfter, { signal });
        store.upsertIndexRows(rows);
        store.recordScan(projectPath, { from: updatedAfter, at: scanStart });
      } catch (err) {
        if (isAbort(err)) throw err;
        warnings.push({ code: "mr_fetch_failed", message: `MRs for ${projectPath}: ${(err as Error).message}` });
      }
    },
    (done, total) => report({ phase: "mrs-list", label: "Scanning projects", done, total }),
  );

  // Step 3: metrics for the eligible set (roster-authored in window, or a revert by anyone),
  // skipping rows already merged with stored metrics.
  signal?.throwIfAborted();
  const rosterSet = new Set(rosterUsernames);
  const indexRows = store.indexRowsUpdatedWithin(window.start, window.end);
  const eligibleRows = indexRows.filter(
    (r) => (r.authorUsername != null && rosterSet.has(r.authorUsername)) || isRevertTitle(r.title),
  );
  const eligibleKeys = eligibleRows.map((r) => mrKey(r.projectPath, r.iid));
  const doneKeys = store.mergedMetricsKeys(eligibleKeys);
  const toFetch = eligibleRows.filter((r) => !doneKeys.has(mrKey(r.projectPath, r.iid)));

  report({ phase: "mrs-detail", label: "Fetching MR details", done: 0, total: toFetch.length });
  let detailFailures = 0;
  let lastDetailError = "";
  const pending: StoredMetrics[] = [];
  const flush = () => {
    if (pending.length > 0) store.upsertMrMetrics(pending.splice(0));
  };
  try {
    await mapLimit(
      toFetch,
      CONCURRENCY,
      async (row) => {
        signal?.throwIfAborted();
        try {
          const detail = await fetchMetrics(source, row.projectPath, row.iid, { signal });
          if (detail) {
            pending.push(detail);
            if (pending.length >= PERSIST_BATCH) flush();
          }
        } catch (err) {
          if (isAbort(err)) throw err;
          detailFailures++;
          lastDetailError = (err as Error).message;
        }
      },
      (done, total) => report({ phase: "mrs-detail", label: "Fetching MR details", done, total }),
    );
  } finally {
    // Runs on cancellation too: a stalled request must not discard metrics already fetched.
    flush();
  }
  if (detailFailures > 0) {
    warnings.push({
      code: "mr_detail_partial",
      message: `Detail fetch failed for ${detailFailures}/${toFetch.length} MRs (e.g. ${lastDetailError}); those count with zeroed diff/notes.`,
    });
  }

  // Step 4: pipelines per (project, roster user), pushes per roster user.
  signal?.throwIfAborted();
  const pairs = settings.projects.flatMap((projectPath) =>
    rosterUsernames.map((username) => ({ projectPath, username })),
  );
  report({ phase: "pipelines", label: "Fetching pipelines", done: 0, total: pairs.length });
  await mapLimit(
    pairs,
    CONCURRENCY,
    async ({ projectPath, username }) => {
      signal?.throwIfAborted();
      try {
        const rows = await fetchPipelinesFor(source, projectPath, username, window, { signal });
        if (rows.length > 0) store.upsertPipelines(rows);
      } catch (err) {
        if (isAbort(err)) throw err;
        warnings.push({
          code: "pipeline_fetch_failed",
          message: `Pipelines ${projectPath} / ${username}: ${(err as Error).message}`,
        });
      }
    },
    (done, total) => report({ phase: "pipelines", label: "Fetching pipelines", done, total }),
  );

  // Resolve the configured projects to their scoped ids so a push event to a repo outside
  // this roster's projects (a side project, a fork) never enters the store: coding-days and
  // streak metrics must only count activity here, not everywhere a roster member pushes.
  signal?.throwIfAborted();
  const scopedProjectIds = new Set<string>();
  await mapLimit(settings.projects, CONCURRENCY, async (projectPath) => {
    signal?.throwIfAborted();
    try {
      const ref = await fetchProjectRef(source, projectPath, { signal });
      if (ref) {
        scopedProjectIds.add(ref.id);
      } else {
        warnings.push({ code: "project_id_failed", message: `Project id for ${projectPath}: not found` });
      }
    } catch (err) {
      if (isAbort(err)) throw err;
      warnings.push({
        code: "project_id_failed",
        message: `Project id for ${projectPath}: ${(err as Error).message}`,
      });
    }
  });

  signal?.throwIfAborted();
  const currentIdentities = storedIdentities(store, rosterUsernames);
  report({ phase: "pushes", label: "Fetching push events", done: 0, total: rosterUsernames.length });
  await mapLimit(
    rosterUsernames,
    CONCURRENCY,
    async (username) => {
      signal?.throwIfAborted();
      const identity = currentIdentities[username];
      if (!identity?.resolved || identity.userId == null) return;
      try {
        // fetchUserEvents requires glance's scoped id form; resolveIdentity only carries
        // the raw GitLab numeric id, so the scope prefix is built here.
        const rows = await fetchPushesFor(source, `gitlab:user:${identity.userId}`, username, window, { signal });
        const scoped = rows.filter((r) => r.repositoryId != null && scopedProjectIds.has(r.repositoryId));
        if (scoped.length > 0) store.upsertPushEvents(scoped);
      } catch (err) {
        if (isAbort(err)) throw err;
        warnings.push({
          code: "events_fetch_failed",
          message: `Events for ${username}: ${(err as Error).message}`,
        });
      }
    },
    (done, total) => report({ phase: "pushes", label: "Fetching push events", done, total }),
  );

  // Step 5: Linear discovery over the same eligible set used for metrics.
  signal?.throwIfAborted();
  report({ phase: "linear", label: "Verifying Linear tickets", done: 0, total: 0 });
  const eligibleKeySet = new Set(eligibleKeys);
  const ticketSources = buildFetchResult(store, window, rosterUsernames).mrs.filter(
    (m) => eligibleKeySet.has(mrKey(m.projectPath, m.iid)) && eligibleForLinearDiscovery(m),
  );
  const linearIssues = await resolveLinearTickets(env.linearApiKey, ticketSources, warnings, signal, report);
  // resolveLinearTickets returns [] when Linear is unconfigured or there are no source MRs;
  // upsertLinearIssues([]) is a no-op transaction, so this never clobbers previously stored issues.
  store.upsertLinearIssues(linearIssues);

  return warnings;
}
