import type { Env } from "../env.js";
import { mapLimit } from "../util/concurrency.js";
import { collectConnection, gqlRequest } from "../gitlab/graphql.js";
import { GitLabApiError } from "../gitlab/errors.js";
import { applyMrDetail, mapEvent, mapMrListNode, mapPipeline } from "../gitlab/map.js";
import { getCachedMrKeys, getMrByKey, putMrDetails, getCachedMrList, putMrListNodes, getLastListScan, setLastListScan } from "../cache/mr-store.js";
import { revertTarget } from "../metrics/reverts.js";
import { resolveLinearTickets } from "../linear/fetch.js";
import { GROUP_MRS_QUERY, GROUP_PROJECTS_QUERY, MR_DETAIL_QUERY, PROJECT_MRS_QUERY } from "../gitlab/queries.js";
import { encodePath, restGetAll, restGetOne } from "../gitlab/rest.js";
import type { RawEvent, RawMrConnection, RawMrDetail, RawMrListNode, RawPipeline, RawUser } from "../gitlab/raw-types.js";
import type { UserIdentity } from "../metrics/trend.js";
import type { FetchResult, NormMr } from "./model.js";
import type { RefreshProgress, LeaderboardWarning, Scope, TimeWindow } from "../../shared/types.js";

export interface FetchOptions {
  env: Env;
  scope: Scope;
  window: TimeWindow;
  users: readonly string[];
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (p: Omit<RefreshProgress, "window">) => void;
}

export interface FetchOutcome {
  result: FetchResult;
  identities: Record<string, UserIdentity>;
  warnings: LeaderboardWarning[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dateOnly = (iso: string): string => iso.slice(0, 10);

export async function fetchAll(opts: FetchOptions): Promise<FetchOutcome> {
  const { env, scope, window, users, concurrency, signal, onProgress } = opts;
  const warnings: LeaderboardWarning[] = [];
  const report = onProgress ?? (() => {});

  signal?.throwIfAborted();
  const identities = await resolveIdentities(env, users, concurrency, warnings, signal, report);
  const resolvedUsers = users.filter((u) => identities[u]?.resolved);

  signal?.throwIfAborted();
  const mrs = await fetchMergeRequests(env, scope, window, resolvedUsers, concurrency, warnings, signal, report);
  const projectPaths = await resolveProjectPaths(env, scope, mrs, warnings, signal);

  signal?.throwIfAborted();
  const projectIds = await resolveProjectIds(env, projectPaths, concurrency, warnings, signal);

  signal?.throwIfAborted();
  const pipelines = await fetchPipelines(env, projectPaths, resolvedUsers, window, concurrency, warnings, signal, report);

  signal?.throwIfAborted();
  const pushEvents = await fetchPushEvents(env, identities, projectIds, resolvedUsers, window, concurrency, warnings, signal, report);

  signal?.throwIfAborted();
  report({ phase: "linear", label: "Verifying Linear tickets", done: 0, total: 0 });
  const allMerged = mrs.filter((m) => m.state === "merged");
  const linearIssues = await resolveLinearTickets(env.linearApiKey, allMerged, warnings, signal, report);

  return {
    result: { mrs, pipelines, pushEvents, linearIssues, approvalsAvailable: true },
    identities,
    warnings,
  };
}

async function resolveIdentities(
  env: Env,
  users: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  report: (p: Omit<RefreshProgress, "window">) => void = () => {},
): Promise<Record<string, UserIdentity>> {
  const identities: Record<string, UserIdentity> = {};
  const total = users.length;
  report({ phase: "users", label: "Resolving users", done: 0, total });
  await mapLimit(users, concurrency, async (username) => {
    signal?.throwIfAborted();
    try {
      const matches = await restGetOne<RawUser[]>(env, "/users", { username }, signal);
      const exact = matches.find((m) => m.username === username) ?? matches[0];
      if (exact) {
        identities[username] = { username, name: exact.name, resolved: true, userId: exact.id };
      } else {
        identities[username] = { username, name: null, resolved: false };
        warnings.push({ code: "user_unresolved", message: `Username not found: ${username}` });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      identities[username] = { username, name: null, resolved: false };
      warnings.push({
        code: "user_lookup_failed",
        message: `Lookup failed for ${username}: ${(err as Error).message}`,
      });
    }
  }, (done) => report({ phase: "users", label: "Resolving users", done, total }));
  return identities;
}

async function fetchMergeRequests(
  env: Env,
  scope: Scope,
  window: TimeWindow,
  users: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  report: (p: Omit<RefreshProgress, "window">) => void = () => {},
): Promise<NormMr[]> {
  const since = new Date(window.start).getTime();

  // Phase 1: lightweight MR list. On first run we paginate everything. On subsequent
  // runs we fetch only MRs updated since the last scan and merge into the cache.
  const scopeKey = scope.type === "group" ? `g:${scope.groupPath}` : `p:${(scope.projectPaths ?? []).join(",")}`;
  const lastScan = getLastListScan(scopeKey);
  const scanStart = new Date().toISOString();

  const onListPage = (found: number) => {
    const mode = lastScan ? "incremental" : "full scan";
    report({ phase: "mrs-list", label: `Listing merge requests (${found} found, ${mode})`, done: 0, total: 0 });
  };
  report({ phase: "mrs-list", label: lastScan ? "Listing merge requests (incremental)" : "Listing merge requests (full scan)", done: 0, total: 0 });

  const fresh: RawMrListNode[] = [];
  if (scope.type === "group") {
    if (!scope.groupPath) throw new GitLabApiError("group scope is missing groupPath");
    fresh.push(...(await listMrs(env, GROUP_MRS_QUERY, scope.groupPath, "group", since, signal, onListPage, lastScan)));
  } else {
    const paths = scope.projectPaths ?? [];
    if (paths.length === 0) throw new GitLabApiError("projects scope has no projectPaths configured");
    for (const path of paths) {
      try {
        fresh.push(...(await listMrs(env, PROJECT_MRS_QUERY, path, "project", since, signal, onListPage, lastScan)));
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        warnings.push({ code: "mr_fetch_failed", message: `MRs for ${path}: ${(err as Error).message}` });
      }
    }
  }

  // Merge fresh results into the cached list and build the full set.
  if (fresh.length > 0) putMrListNodes(scopeKey, fresh);
  setLastListScan(scopeKey, scanStart);

  // Build the full list from cache, applying the window filter client-side.
  const allCached = getCachedMrList(scopeKey);
  const light = allCached.filter((n) => new Date(n.updatedAt).getTime() >= since);

  // Scope the expensive detail fetch to MRs authored by the configured team. This bounds
  // cost on a busy monorepo: "reviewed" therefore means engagement on teammates' MRs.
  const userSet = new Set(users);
  const teamMrs = light.filter((n) => n.author?.username != null && userSet.has(n.author.username));

  // Phase 2: per-MR detail (diffStats, notes, labels, approvedBy).
  // Merged MRs are immutable, so we check the permanent MR store first and only fetch
  // details for MRs we haven't seen before. This makes re-refreshes near-instant.
  const teamBases = teamMrs.map(mapMrListNode);
  const cachedKeys = await getCachedMrKeys(teamBases);

  const uncached = teamBases.filter((m) => !cachedKeys.has(`${m.projectPath}:${m.iid}`));
  const fromStore: NormMr[] = [];
  for (const key of cachedKeys) {
    const mr = await getMrByKey(key);
    if (mr) fromStore.push(mr);
  }

  let detailFailures = 0;
  let lastDetailError = "";
  const total = uncached.length;
  report({
    phase: "mrs-detail",
    label: `Fetching MR details (${cachedKeys.size} cached, ${total} new)`,
    done: 0,
    total,
  });

  const freshlyFetched = await mapLimit(uncached, concurrency, async (base) => {
    signal?.throwIfAborted();
    try {
      const data = await gqlRequest<{ project: { mergeRequest: RawMrDetail | null } | null }>(
        env,
        MR_DETAIL_QUERY,
        { fullPath: base.projectPath, iid: String(base.iid) },
        signal,
      );
      const detail = data.project?.mergeRequest;
      return detail ? applyMrDetail(base, detail) : base;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      detailFailures++;
      lastDetailError = (err as Error).message;
      return base;
    }
  }, (done) => report({
    phase: "mrs-detail",
    label: `Fetching MR details (${cachedKeys.size} cached, ${total} new)`,
    done,
    total,
  }));

  if (freshlyFetched.length > 0) {
    await putMrDetails(freshlyFetched);
  }

  if (detailFailures > 0) {
    warnings.push({
      code: "mr_detail_partial",
      message: `Detail fetch failed for ${detailFailures}/${total} MRs (e.g. ${lastDetailError}); those count with zeroed diff/notes.`,
    });
  }

  const mrs = [...fromStore, ...freshlyFetched];

  // Include revert MRs authored by ANYONE (light-only ... titles are enough for detection),
  // so reverts of the team's work are caught even when a non-team member did the revert.
  const extraReverts = light
    .filter((n) => !(n.author?.username != null && userSet.has(n.author.username)))
    .map(mapMrListNode)
    .filter((m) => revertTarget(m) !== null);

  return [...mrs, ...extraReverts];
}

/**
 * Phase 1 pagination: walk a group/project mergeRequests connection (UPDATED_DESC),
 * stopping once an entire page is older than the window start. Light fields only.
 */
async function listMrs(
  env: Env,
  query: string,
  fullPath: string,
  rootKey: "group" | "project",
  sinceMs: number,
  signal?: AbortSignal,
  onPage?: (totalFound: number) => void,
  updatedAfter?: string | null,
): Promise<RawMrListNode[]> {
  type MrRoot = { mergeRequests: RawMrConnection } | null;
  type MrQueryData = { group?: MrRoot; project?: MrRoot };

  const nodes: RawMrListNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 500; page++) {
    signal?.throwIfAborted();
    const vars: Record<string, unknown> = { fullPath, after };
    if (updatedAfter) vars.updatedAfter = updatedAfter;
    const data: MrQueryData = await gqlRequest<MrQueryData>(env, query, vars, signal);
    const conn = data[rootKey]?.mergeRequests;
    if (!conn) break;
    nodes.push(...conn.nodes);
    onPage?.(nodes.length);

    const oldestOnPage = conn.nodes.reduce(
      (min: number, n: RawMrListNode) => Math.min(min, new Date(n.updatedAt).getTime()),
      Number.POSITIVE_INFINITY,
    );
    if (oldestOnPage < sinceMs) break;
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes;
}

async function resolveProjectPaths(
  env: Env,
  scope: Scope,
  mrs: readonly NormMr[],
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (scope.type === "projects") return scope.projectPaths ?? [];
  if (!scope.groupPath) return [];
  try {
    const nodes = await collectConnection<{ fullPath: string }>(async (after) => {
      const data = await gqlRequest<{ group: { projects: { nodes: Array<{ fullPath: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }>(
        env,
        GROUP_PROJECTS_QUERY,
        { fullPath: scope.groupPath, after },
        signal,
      );
      const conn = data.group?.projects;
      return conn ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    });
    return nodes.map((n) => n.fullPath);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // Fall back to the projects we already saw on the MRs.
    warnings.push({ code: "projects_fetch_failed", message: `Group projects: ${(err as Error).message}` });
    return [...new Set(mrs.map((m) => m.projectPath).filter(Boolean))];
  }
}

async function fetchPipelines(
  env: Env,
  projectPaths: readonly string[],
  users: readonly string[],
  window: TimeWindow,
  concurrency: number,
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  report: (p: Omit<RefreshProgress, "window">) => void = () => {},
) {
  const pairs = projectPaths.flatMap((projectPath) => users.map((username) => ({ projectPath, username })));
  const total = pairs.length;
  report({ phase: "pipelines", label: "Fetching pipelines", done: 0, total });
  const results = await mapLimit(pairs, concurrency, async ({ projectPath, username }) => {
    signal?.throwIfAborted();
    try {
      const raws = await restGetAll<RawPipeline>(
        env,
        `/projects/${encodePath(projectPath)}/pipelines`,
        { username, updated_after: window.start, updated_before: window.end },
        50,
        signal,
      );
      return raws.map((r) => mapPipeline(r, projectPath, username));
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      warnings.push({
        code: "pipeline_fetch_failed",
        message: `Pipelines ${projectPath} / ${username}: ${(err as Error).message}`,
      });
      return [];
    }
  }, (done) => report({ phase: "pipelines", label: "Fetching pipelines", done, total }));
  return results.flat();
}

/** Resolve "group/project" paths to numeric project ids (for scoping push events). */
async function resolveProjectIds(
  env: Env,
  projectPaths: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
): Promise<Set<number>> {
  const ids = new Set<number>();
  await mapLimit(projectPaths, concurrency, async (path) => {
    signal?.throwIfAborted();
    try {
      const p = await restGetOne<{ id: number }>(env, `/projects/${encodePath(path)}`, {}, signal);
      ids.add(p.id);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      warnings.push({ code: "project_id_failed", message: `Project id for ${path}: ${(err as Error).message}` });
    }
  });
  return ids;
}

async function fetchPushEvents(
  env: Env,
  identities: Record<string, UserIdentity>,
  projectIds: Set<number>,
  users: readonly string[],
  window: TimeWindow,
  concurrency: number,
  warnings: LeaderboardWarning[],
  signal?: AbortSignal,
  report: (p: Omit<RefreshProgress, "window">) => void = () => {},
) {
  // Use the efficient per-user events API (only that user's pushes), then keep only the
  // events in the configured project(s) ... so coding-days/streak don't count pushes to
  // unrelated repos (side projects, forks). Per-user events carry project_id.
  const after = dateOnly(new Date(new Date(window.start).getTime() - DAY_MS).toISOString());
  const before = dateOnly(new Date(new Date(window.end).getTime() + DAY_MS).toISOString());
  const total = users.length;
  report({ phase: "pushes", label: "Fetching push events", done: 0, total });
  const results = await mapLimit(users, concurrency, async (username) => {
    signal?.throwIfAborted();
    const id = identities[username]?.userId;
    if (id === undefined) return [];
    try {
      const raws = await restGetAll<RawEvent>(env, `/users/${id}/events`, { action: "pushed", after, before }, 50, signal);
      return raws.filter((r) => r.project_id != null && projectIds.has(r.project_id)).map((r) => mapEvent(r, username));
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      warnings.push({
        code: "events_fetch_failed",
        message: `Events for ${username}: ${(err as Error).message}`,
      });
      return [];
    }
  }, (done) => report({ phase: "pushes", label: "Fetching push events", done, total }));
  return results.flat();
}
