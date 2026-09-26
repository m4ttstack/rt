/**
 * GitLab read tools: each reads the daemon's project-MRs store (the OPEN-MR
 * cache), so a merged or closed result only exists briefly, right after the
 * transition, before the store drops it.
 */
import { readDiscussions, readMrsByBranch, readProjectMRs, rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands, ProjectMRsData } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { resolveMrTarget, resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkPositiveInts, checkStringArray, err, fromResponse, MR_TARGET_PROPS, ok, REPO_NAME_RULE, REPO_TARGET_PROPS, type McpToolDef } from "./shared.ts";

export interface MrReadDeps {
  projectMrs: typeof readProjectMRs;
  discussions: typeof readDiscussions;
  byBranch: typeof readMrsByBranch;
  command: typeof rtCommand;
}

export const realMrReadDeps: MrReadDeps = { projectMrs: readProjectMRs, discussions: readDiscussions, byBranch: readMrsByBranch, command: rtCommand };

const LIVE_MAX_AGE_MS = 5_000;
const STATES = ["opened", "merged", "closed", "all"] as const;

const CACHE_NOTE = "merged and closed results cover only recently closed MRs still held in the daemon's open-MR cache, not a project's full history";

function notFound(iid: number, identity: string): string {
  return `no MR !${iid} in the daemon's open-MR cache for ${identity}`;
}

export function mrReadToolDefs(deps: MrReadDeps = realMrReadDeps): McpToolDef[] {
  async function mrs(identity: string, maxAgeMs: number | undefined): Promise<{ ok: true; data: ProjectMRsData } | { ok: false; error: string }> {
    const res = await deps.projectMrs(identity, maxAgeMs);
    if (!res.ok || !res.data) return { ok: false, error: explainError(res.error ?? "failed to read MRs") };
    return { ok: true, data: res.data };
  }

  return [
    {
      name: "mr_view",
      description: `GitLab only. One MR by iid from the daemon's open-MR cache; pass a small maxAgeMs (e.g. 5000) when the read must be live. ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if (!read.ok) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(notFound(target.iid, target.identity));
        return ok({ mr: entry.pr, fetchedAt: entry.fetchedAt });
      },
    },
    {
      name: "mr_list",
      description: `GitLab only. MRs of the target project by state (default opened, which also includes an open draft MR since GitLab reports those as state "draft"). ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, state: { type: "string", enum: [...STATES] }, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "state", type: "string" }, { name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const state = (input.state as string | undefined) ?? "opened";
        if (!STATES.includes(state as typeof STATES[number])) return err(`"state" must be one of ${STATES.join(", ")}`);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if (!read.ok) return err(read.error);
        const all = Object.values(read.data.mrs).map((e) => e.pr);
        const included = (prState: string) => state === "all" ? true : state === "opened" ? prState === "opened" || prState === "draft" : prState === state;
        return ok({ mrs: all.filter((pr) => included(pr.state)), syncedAt: read.data.syncedAt });
      },
    },
    {
      name: "mr_for_branch",
      description: `GitLab only. The MR (or null) for each named source branch. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, branches: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["branches"], additionalProperties: false },
      async handler(input) {
        const bad = checkStringArray(input, "branches");
        if (bad) return err(bad);
        if (!Array.isArray(input.branches) || input.branches.length === 0) return err('"branches" must name at least one branch');
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        return fromResponse(await deps.byBranch(target.identity, input.branches as string[], {}));
      },
    },
    {
      name: "mr_threads",
      description: `GitLab only. The MR's discussion threads; refresh: true fetches from GitLab first. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, refresh: { type: "boolean" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "refresh", type: "boolean" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        if (input.refresh === true) {
          const r = await deps.command<Commands["discussions:refresh"]["data"]>("discussions:refresh", { repoName: target.identity, iid: target.iid }, { timeoutMs: 30_000 });
          if (!r.ok) return err(explainError(r.error ?? "refresh failed"));
        }
        return fromResponse(await deps.discussions(target.identity, target.iid, {}));
      },
    },
    {
      name: "mr_pipeline",
      description: `GitLab only. The MR's head pipeline (live by default, maxAgeMs 5000) and, with jobId, that job's detail. ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" }, jobId: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]) ?? checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, (input.maxAgeMs as number | undefined) ?? LIVE_MAX_AGE_MS);
        if (!read.ok) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(notFound(target.iid, target.identity));
        const body: Record<string, unknown> = { pipeline: entry.pr.pipeline ?? null };
        if (typeof input.jobId === "number") {
          const job = await deps.command<Commands["mr:fetch-job-detail"]["data"]>("mr:fetch-job-detail", { repoName: target.identity, iid: target.iid, jobId: input.jobId }, { timeoutMs: 30_000 });
          if (!job.ok) return err(explainError(job.error ?? "job detail failed"));
          body.job = job.data;
        }
        return ok(body);
      },
    },
    {
      name: "mr_job_trace",
      description: `GitLab only. The plain-text trace of one CI job of the MR. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, jobId: { type: "number" } }, required: ["jobId"], additionalProperties: false },
      async handler(input) {
        if (input.jobId === undefined) return err('"jobId" is required');
        const bad = checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId: input.jobId as number }, { timeoutMs: 60_000 });
        if (!r.ok) return err(explainError(r.error ?? "trace failed"));
        return ok({ trace: r.data });
      },
    },
  ];
}
