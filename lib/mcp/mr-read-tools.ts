/**
 * GitLab read tools. mr_view, mr_list and mr_pipeline read the daemon's
 * project-MRs store (the OPEN-MR cache), so a merged or closed MR is there
 * only between its transition and the store dropping it.
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

const CACHE_NOTE = "merged and closed results cover only recently closed MRs still held in the daemon's open-MR cache, not a project's full history. That cache may be limited to certain authors and a recent time window, so an MR outside it reads as not found";

const JOB_ID_NOTE = "jobId is the numeric part of a job id like gitlab:job:123. Take it from this MR's pipeline: the daemon does not check that the job belongs to this MR, so jobId may name any job in the MR's project";

const TRACE_TAIL_LINES = 200;
const TRACE_MAX_BYTES = 64 * 1024;
const ANSI_ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

type Pr = ProjectMRsData["mrs"][string]["pr"];

export function tailTrace(raw: string, tailLines: number): { trace: string; truncated: boolean; totalLines: number } {
  const lines = raw.replace(ANSI_ESCAPES, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const kept = lines.slice(-tailLines);
  let trace = kept.join("\n");
  let truncated = kept.length < lines.length;
  const bytes = Buffer.from(trace, "utf8");
  if (bytes.length > TRACE_MAX_BYTES) {
    let start = bytes.length - TRACE_MAX_BYTES;
    // A cut inside a multi-byte character would decode as a replacement character.
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
    trace = bytes.subarray(start).toString("utf8");
    truncated = true;
  }
  return { trace, truncated, totalLines: lines.length };
}

function pipelineNumber(pr: Pr): number | undefined {
  const m = /:(\d+)$/.exec(pr.pipeline?.id ?? "");
  return m ? Number(m[1]) : undefined;
}

function summarize(pr: Pr) {
  return {
    iid: pr.iid,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    author: pr.author?.username ?? null,
    webUrl: pr.webUrl ?? null,
    pipelineStatus: pr.pipeline?.status ?? null,
    detailedMergeStatus: pr.detailedMergeStatus ?? null,
  };
}

function notFound(iid: number, identity: string, syncedAt: number): string {
  const head = `no MR !${iid} in the daemon's open-MR cache for ${identity}`;
  if (syncedAt === 0) return `${head}; the cache has never synced for this repo, so retry with a small maxAgeMs (e.g. 5000)`;
  return `${head}; the cache may be limited to certain authors and a time window`;
}

function checkMaxAge(input: Record<string, unknown>): string | undefined {
  const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]);
  if (bad) return bad;
  if (typeof input.maxAgeMs === "number" && !(input.maxAgeMs >= 0)) return '"maxAgeMs" must be a non-negative number';
  return undefined;
}

function cacheMeta(data: ProjectMRsData): Pick<ProjectMRsData, "scope" | "syncError"> {
  const meta: Pick<ProjectMRsData, "scope" | "syncError"> = {};
  if (data.scope !== undefined) meta.scope = data.scope;
  if (data.syncError !== undefined) meta.syncError = data.syncError;
  return meta;
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
      description: `GitLab only. One MR by iid from the daemon's open-MR cache; pass a small maxAgeMs (e.g. 5000) when the read must be live. The body carries scope and syncError when the daemon reports them. ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkMaxAge(input);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if (!read.ok) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(notFound(target.iid, target.identity, read.data.syncedAt));
        return ok({ mr: entry.pr, fetchedAt: entry.fetchedAt, ...cacheMeta(read.data) });
      },
    },
    {
      name: "mr_list",
      description: `GitLab only. A summary of each MR of the target project (iid, title, state, draft, sourceBranch, targetBranch, author username, webUrl, pipelineStatus, detailedMergeStatus), filtered exactly on GitLab's state (default opened, which includes draft MRs; draft: true marks them). Use mr_view for one MR in full. The body carries syncedAt (0 when the cache has never synced for this repo; retry with a small maxAgeMs) and, when the daemon reports them, scope and syncError. ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, state: { type: "string", enum: [...STATES] }, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "state", type: "string" }]) ?? checkMaxAge(input);
        if (bad) return err(bad);
        const state = (input.state as string | undefined) ?? "opened";
        if (!STATES.includes(state as typeof STATES[number])) return err(`"state" must be one of ${STATES.join(", ")}`);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if (!read.ok) return err(read.error);
        const all = Object.values(read.data.mrs).map((e) => e.pr);
        const listed = state === "all" ? all : all.filter((pr) => pr.state === state);
        return ok({ mrs: listed.map(summarize), syncedAt: read.data.syncedAt, ...cacheMeta(read.data) });
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
      description: `GitLab only. The MR's head pipeline (live by default, maxAgeMs 5000) and, with jobId, that job's detail: a bridge job's downstream pipeline, or for any other job {type: "trace", traceVia: "mr_job_trace"}, since its log is read with mr_job_trace. pipeline.jobs may be empty for a cache entry written at list weight; pass jobId for one job's detail. ${JOB_ID_NOTE}. ${CACHE_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" }, jobId: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkMaxAge(input) ?? checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, (input.maxAgeMs as number | undefined) ?? LIVE_MAX_AGE_MS);
        if (!read.ok) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(notFound(target.iid, target.identity, read.data.syncedAt));
        const body: Record<string, unknown> = { pipeline: entry.pr.pipeline ?? null };
        if (typeof input.jobId === "number") {
          const payload: Commands["mr:fetch-job-detail"]["payload"] = { repoName: target.identity, iid: target.iid, jobId: input.jobId };
          const pipelineId = pipelineNumber(entry.pr);
          if (pipelineId !== undefined) payload.pipelineId = pipelineId;
          const job = await deps.command<Commands["mr:fetch-job-detail"]["data"]>("mr:fetch-job-detail", payload, { timeoutMs: 30_000 });
          if (!job.ok) return err(explainError(job.error ?? "job detail failed"));
          body.job = job.data?.type === "trace" ? { type: "trace", traceVia: "mr_job_trace" } : job.data;
        }
        return ok(body);
      },
    },
    {
      name: "mr_job_trace",
      description: `GitLab only. The tail of one CI job's plain-text trace: the last tailLines lines (default ${TRACE_TAIL_LINES}) with ANSI escape sequences stripped, then capped at 64 KiB from the end. Returns trace, truncated (true when either cap cut anything) and totalLines. ${JOB_ID_NOTE}. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, jobId: { type: "number" }, tailLines: { type: "number" } }, required: ["jobId"], additionalProperties: false },
      async handler(input) {
        if (input.jobId === undefined) return err('"jobId" is required');
        const bad = checkPositiveInts(input, ["jobId", "tailLines"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const r = await deps.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId: input.jobId as number }, { timeoutMs: 60_000 });
        if (!r.ok) return err(explainError(r.error ?? "trace failed"));
        return ok(tailTrace(r.data ?? "", (input.tailLines as number | undefined) ?? TRACE_TAIL_LINES));
      },
    },
  ];
}
