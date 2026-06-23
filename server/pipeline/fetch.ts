import type { Env } from "../env.js";
import { mapLimit } from "../util/concurrency.js";
import { collectConnection, gqlRequest } from "../gitlab/graphql.js";
import { GitLabApiError } from "../gitlab/errors.js";
import { applyMrDetail, mapEvent, mapMrListNode, mapPipeline } from "../gitlab/map.js";
import { revertTarget } from "../metrics/reverts.js";
import { GROUP_MRS_QUERY, GROUP_PROJECTS_QUERY, MR_DETAIL_QUERY, PROJECT_MRS_QUERY } from "../gitlab/queries.js";
import { encodePath, restGetAll, restGetOne } from "../gitlab/rest.js";
import type { RawEvent, RawMrConnection, RawMrDetail, RawMrListNode, RawPipeline, RawUser } from "../gitlab/raw-types.js";
import type { UserIdentity } from "../metrics/trend.js";
import type { FetchResult, NormMr } from "./model.js";
import type { LeaderboardWarning, Scope, TimeWindow } from "../../shared/types.js";

export interface FetchOptions {
  env: Env;
  scope: Scope;
  window: TimeWindow;
  users: readonly string[];
  concurrency: number;
}

export interface FetchOutcome {
  result: FetchResult;
  identities: Record<string, UserIdentity>;
  warnings: LeaderboardWarning[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dateOnly = (iso: string): string => iso.slice(0, 10);

export async function fetchAll(opts: FetchOptions): Promise<FetchOutcome> {
  const { env, scope, window, users, concurrency } = opts;
  const warnings: LeaderboardWarning[] = [];

  const identities = await resolveIdentities(env, users, concurrency, warnings);
  const resolvedUsers = users.filter((u) => identities[u]?.resolved);

  const mrs = await fetchMergeRequests(env, scope, window, resolvedUsers, concurrency, warnings);
  const projectPaths = await resolveProjectPaths(env, scope, mrs, warnings);

  const projectIds = await resolveProjectIds(env, projectPaths, concurrency, warnings);

  const pipelines = await fetchPipelines(env, projectPaths, resolvedUsers, window, concurrency, warnings);
  const pushEvents = await fetchPushEvents(env, identities, projectIds, resolvedUsers, window, concurrency, warnings);

  return {
    result: { mrs, pipelines, pushEvents, approvalsAvailable: true },
    identities,
    warnings,
  };
}

async function resolveIdentities(
  env: Env,
  users: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
): Promise<Record<string, UserIdentity>> {
  const identities: Record<string, UserIdentity> = {};
  await mapLimit(users, concurrency, async (username) => {
    try {
      const matches = await restGetOne<RawUser[]>(env, "/users", { username });
      const exact = matches.find((m) => m.username === username) ?? matches[0];
      if (exact) {
        identities[username] = { username, name: exact.name, resolved: true, userId: exact.id };
      } else {
        identities[username] = { username, name: null, resolved: false };
        warnings.push({ code: "user_unresolved", message: `Username not found: ${username}` });
      }
    } catch (err) {
      identities[username] = { username, name: null, resolved: false };
      warnings.push({
        code: "user_lookup_failed",
        message: `Lookup failed for ${username}: ${(err as Error).message}`,
      });
    }
  });
  return identities;
}

async function fetchMergeRequests(
  env: Env,
  scope: Scope,
  window: TimeWindow,
  users: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
): Promise<NormMr[]> {
  const since = new Date(window.start).getTime();

  // Phase 1: lightweight MR list (cheap fields only) covering the window.
  const light: RawMrListNode[] = [];
  if (scope.type === "group") {
    if (!scope.groupPath) throw new GitLabApiError("group scope is missing groupPath");
    light.push(...(await listMrs(env, GROUP_MRS_QUERY, scope.groupPath, "group", since)));
  } else {
    const paths = scope.projectPaths ?? [];
    if (paths.length === 0) throw new GitLabApiError("projects scope has no projectPaths configured");
    for (const path of paths) {
      try {
        light.push(...(await listMrs(env, PROJECT_MRS_QUERY, path, "project", since)));
      } catch (err) {
        warnings.push({ code: "mr_fetch_failed", message: `MRs for ${path}: ${(err as Error).message}` });
      }
    }
  }

  // Scope the expensive detail fetch to MRs authored by the configured team. This bounds
  // cost on a busy monorepo: "reviewed" therefore means engagement on teammates' MRs.
  const userSet = new Set(users);
  const teamMrs = light.filter((n) => n.author?.username != null && userSet.has(n.author.username));

  // Phase 2: per-MR detail (diffStats, notes, labels, approvedBy), fetched concurrently.
  // A single MR's diff stats resolve well within GitLab's per-field timeout; a bulk page
  // of 50 does not ... that was the source of the "Timeout on DiffStatsSummary" errors.
  let detailFailures = 0;
  let lastDetailError = "";
  const mrs = await mapLimit(teamMrs, concurrency, async (node) => {
    const base = mapMrListNode(node);
    try {
      const data = await gqlRequest<{ project: { mergeRequest: RawMrDetail | null } | null }>(
        env,
        MR_DETAIL_QUERY,
        { fullPath: base.projectPath, iid: String(base.iid) },
      );
      const detail = data.project?.mergeRequest;
      return detail ? applyMrDetail(base, detail) : base;
    } catch (err) {
      detailFailures++;
      lastDetailError = (err as Error).message;
      return base; // keep the MR with light fields only rather than failing the whole run
    }
  });

  if (detailFailures > 0) {
    warnings.push({
      code: "mr_detail_partial",
      message: `Detail fetch failed for ${detailFailures}/${teamMrs.length} MRs (e.g. ${lastDetailError}); those count with zeroed diff/notes.`,
    });
  }

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
): Promise<RawMrListNode[]> {
  type MrRoot = { mergeRequests: RawMrConnection } | null;
  type MrQueryData = { group?: MrRoot; project?: MrRoot };

  const nodes: RawMrListNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 500; page++) {
    const data: MrQueryData = await gqlRequest<MrQueryData>(env, query, { fullPath, after });
    const conn = data[rootKey]?.mergeRequests;
    if (!conn) break;
    nodes.push(...conn.nodes);

    const oldestOnPage = conn.nodes.reduce(
      (min: number, n: RawMrListNode) => Math.min(min, new Date(n.updatedAt).getTime()),
      Number.POSITIVE_INFINITY,
    );
    if (oldestOnPage < sinceMs) break; // everything past here is older than the window
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
): Promise<string[]> {
  if (scope.type === "projects") return scope.projectPaths ?? [];
  if (!scope.groupPath) return [];
  try {
    const nodes = await collectConnection<{ fullPath: string }>(async (after) => {
      const data = await gqlRequest<{ group: { projects: { nodes: Array<{ fullPath: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }>(
        env,
        GROUP_PROJECTS_QUERY,
        { fullPath: scope.groupPath, after },
      );
      const conn = data.group?.projects;
      return conn ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    });
    return nodes.map((n) => n.fullPath);
  } catch (err) {
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
) {
  const pairs = projectPaths.flatMap((projectPath) =>
    users.map((username) => ({ projectPath, username })),
  );
  const results = await mapLimit(pairs, concurrency, async ({ projectPath, username }) => {
    try {
      const raws = await restGetAll<RawPipeline>(
        env,
        `/projects/${encodePath(projectPath)}/pipelines`,
        { username, updated_after: window.start, updated_before: window.end },
      );
      return raws.map((r) => mapPipeline(r, projectPath, username));
    } catch (err) {
      warnings.push({
        code: "pipeline_fetch_failed",
        message: `Pipelines ${projectPath} / ${username}: ${(err as Error).message}`,
      });
      return [];
    }
  });
  return results.flat();
}

/** Resolve "group/project" paths to numeric project ids (for scoping push events). */
async function resolveProjectIds(
  env: Env,
  projectPaths: readonly string[],
  concurrency: number,
  warnings: LeaderboardWarning[],
): Promise<Set<number>> {
  const ids = new Set<number>();
  await mapLimit(projectPaths, concurrency, async (path) => {
    try {
      const p = await restGetOne<{ id: number }>(env, `/projects/${encodePath(path)}`);
      ids.add(p.id);
    } catch (err) {
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
) {
  // Use the efficient per-user events API (only that user's pushes), then keep only the
  // events in the configured project(s) ... so coding-days/streak don't count pushes to
  // unrelated repos (side projects, forks). Per-user events carry project_id.
  const after = dateOnly(new Date(new Date(window.start).getTime() - DAY_MS).toISOString());
  const before = dateOnly(new Date(new Date(window.end).getTime() + DAY_MS).toISOString());

  const results = await mapLimit(users, concurrency, async (username) => {
    const id = identities[username]?.userId;
    if (id === undefined) return [];
    try {
      const raws = await restGetAll<RawEvent>(env, `/users/${id}/events`, {
        action: "pushed",
        after,
        before,
      });
      return raws
        .filter((r) => r.project_id != null && projectIds.has(r.project_id))
        .map((r) => mapEvent(r, username));
    } catch (err) {
      warnings.push({
        code: "events_fetch_failed",
        message: `Events for ${username}: ${(err as Error).message}`,
      });
      return [];
    }
  });
  return results.flat();
}
