import { eligibleForLinearDiscovery } from "../linear/fetch.js";
import { mrKey, type IndexRow, type Store, type StoredMetrics } from "./index.js";
import type { FetchResult, NormMr, UserIdentity } from "./model.js";
import type { TimeWindow } from "../../shared/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function toNormMr(row: IndexRow, metrics: StoredMetrics | undefined): NormMr {
  return {
    iid: row.iid,
    projectPath: row.projectPath,
    authorUsername: row.authorUsername,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // No query has ever fetched this; cohorts.ts's `?? createdAt` fallback depends on it
    // staying null (spec section 9). Do not source it here.
    preparedAt: null,
    mergedAt: row.mergedAt,
    title: row.title,
    sourceBranch: row.sourceBranch,
    description: metrics?.description ?? null,
    labels: metrics?.labels ?? [],
    additions: metrics?.diffStats?.additions ?? 0,
    deletions: metrics?.diffStats?.deletions ?? 0,
    fileCount: metrics?.diffStats?.filesChanged ?? 0,
    approvedByUsernames: metrics?.approvedByUsernames ?? [],
    notes: metrics?.notes ?? [],
    diffStats: metrics?.fileStats ?? [],
  };
}

/**
 * Build the metrics layer's FetchResult for one window directly from store rows: a window
 * is a query, not a slice of a wider cached fetch. Performs no network work.
 *
 * `updatedAt` is bounded on both sides (inclusive), matching sliceOutcome's departure from
 * a live fetch's open-ended lower bound: without an upper bound this query would surface
 * MRs updated during a later window, which then leaks into revert detection for this one.
 */
export function buildFetchResult(store: Store, window: TimeWindow, roster: readonly string[]): FetchResult {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const rosterSet = new Set(roster);

  const indexRows = store.indexRowsUpdatedWithin(window.start, window.end);
  const keys = indexRows.map((r) => mrKey(r.projectPath, r.iid));
  const metricsByKey = new Map(store.metricsByKeys(keys).map((m) => [mrKey(m.projectPath, m.iid), m]));
  const mrs = indexRows.map((row) => toNormMr(row, metricsByKey.get(mrKey(row.projectPath, row.iid))));

  const pipelines = store
    .pipelinesBetween(window.start, window.end)
    .filter((p) => rosterSet.has(p.username ?? ""))
    .map((p) => ({ projectPath: p.projectPath, username: p.username, status: p.status, createdAt: p.createdAt }));

  // Widened by a day on each side, mirroring slice.ts:31-34's mirror of the live fetch's
  // push-event bound.
  const padStart = new Date(start - DAY_MS).toISOString();
  const padEnd = new Date(end + DAY_MS).toISOString();
  const pushEvents = store
    .pushEventsBetween(padStart, padEnd)
    .filter((e) => rosterSet.has(e.username))
    .map((e) => ({ username: e.username, createdAt: e.createdAt }));

  // Tickets are discovered only from in-window MRs eligible for discovery, the only
  // thing that has ever scoped them to a window (mirrors slice.ts:36-43).
  const eligibleKeys = mrs.filter(eligibleForLinearDiscovery).map((m) => mrKey(m.projectPath, m.iid));
  const linearIssues = store.linearIssuesForMrKeys(eligibleKeys);

  // A tier-capability flag (does this GitLab tier expose approvals at all), not a
  // per-window content check. Parity with fetch.ts:68, which also hardcodes true:
  // no code path in this repo ever sets it false.
  const approvalsAvailable = true;

  return { mrs, pipelines, pushEvents, linearIssues, approvalsAvailable };
}

/** Identities for a roster, keyed by username. Usernames never stored are simply absent. */
export function storedIdentities(store: Store, roster: readonly string[]): Record<string, UserIdentity> {
  const out: Record<string, UserIdentity> = {};
  for (const r of store.identities(roster)) {
    out[r.username] =
      r.userId == null
        ? { username: r.username, name: r.name, resolved: r.resolved }
        : { username: r.username, name: r.name, resolved: r.resolved, userId: r.userId };
  }
  return out;
}

/**
 * The cold-store probe behind ColdCacheError: every configured project must have a scan
 * floor at or before the window's start, or the window reads rows nothing ever fetched.
 */
export function hasDataFor(store: Store, projects: readonly string[], window: TimeWindow): boolean {
  const start = Date.parse(window.start);
  return projects.every((p) => {
    const floor = store.scanFloor(p);
    return floor !== null && Date.parse(floor) <= start;
  });
}
