/**
 * The shepherd-side herd tools: start a herd, spawn and manage worker
 * panes, and (worker side) herd_milestone. No import of commands/herd.ts
 * or commands/chat.ts (both pull in TUI-adjacent modules lib/mcp stays
 * clear of).
 */
import {
  herdAttend, herdClose, herdList, herdMilestone, herdResume, herdSpawn, herdStart, herdStatus, herdWrapUp,
} from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { runRtVerb } from "./rt-verb.ts";
import { checkOptional, checkRequired, checkStringArray, err, fromResponse, ok, requireWorkerEnv, resolveSoleHerd, type McpToolDef } from "./shared.ts";

export interface HerdToolDeps {
  start: typeof herdStart; spawn: typeof herdSpawn; close: typeof herdClose; status: typeof herdStatus; list: typeof herdList;
  attend: typeof herdAttend; wrapUp: typeof herdWrapUp; resume: typeof herdResume; milestone: typeof herdMilestone;
  verb: typeof runRtVerb;
}

export const realHerdToolDeps: HerdToolDeps = {
  start: herdStart, spawn: herdSpawn, close: herdClose, status: herdStatus, list: herdList,
  attend: herdAttend, wrapUp: herdWrapUp, resume: herdResume, milestone: herdMilestone, verb: runRtVerb,
};

/** herd:spawn provisions a worktree and launches an agent; the default 60s budget is too tight. */
const SPAWN_TIMEOUT_MS = 300_000;
const HERD_PROP = { herd: { type: "string", description: "Herd id; defaults to HERD_ID, else the sole active herd." } };
const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; this tool runs inside a Claude Code session";

async function herdFor(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ herd: string } | { error: string }> {
  if (typeof input.herd === "string") return { herd: input.herd };
  if (env.HERD_ID) return { herd: env.HERD_ID };
  return resolveSoleHerd();
}

export function herdToolDefs(deps: HerdToolDeps = realHerdToolDeps): McpToolDef[] {
  return [
    {
      name: "herd_start",
      description: "Start a herd (room, workspace, gate subscription) for this shepherd session. repo is the repo's identity, checkout path or label.",
      inputSchema: { type: "object", properties: { name: { type: "string" }, repo: { type: "string" }, hidden: { type: "boolean" } }, required: ["name", "repo"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "name", type: "string" }, { name: "repo", type: "string" }]) ?? checkOptional(input, [{ name: "hidden", type: "boolean" }]);
        if (bad) return err(bad);
        if (!env.CLAUDE_CODE_SESSION_ID) return err(NO_SESSION);
        const target = await resolveRepoTarget({ repoName: input.repo });
        if (!target.ok) return err(target.error);
        const payload: Commands["herd:start"]["payload"] = { name: input.name as string, repo: target.identity, session: env.CLAUDE_CODE_SESSION_ID };
        if (typeof input.hidden === "boolean") payload.hidden = input.hidden;
        if (env.HERDR_PANE_ID) payload.callerPane = env.HERDR_PANE_ID;
        return fromResponse(await deps.start(payload));
      },
    },
    {
      name: "herd_spawn",
      description: "Spawn a worker pane for a job (provisions its worktree, launches claude with the brief). Runs with no check: the shepherd owns its herd. Takes minutes.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" }, brief: { type: "string" }, dir: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, account: { type: "string" }, disposable: { type: "boolean" } }, required: ["job"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "job", type: "string" }]) ?? checkOptional(input, [{ name: "brief", type: "string" }, { name: "dir", type: "string" }, { name: "model", type: "string" }, { name: "effort", type: "string" }, { name: "account", type: "string" }, { name: "disposable", type: "boolean" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const payload: Commands["herd:spawn"]["payload"] = { herd: h.herd, job: input.job as string };
        for (const k of ["brief", "dir", "model", "effort", "account"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (typeof input.disposable === "boolean") payload.disposable = input.disposable;
        return fromResponse(await deps.spawn(payload, { timeoutMs: SPAWN_TIMEOUT_MS }));
      },
    },
    {
      name: "herd_brief",
      description: "Assemble a job brief from the shepherd skill's job template plus a strategy body or method file; fill repeats per template slot as \"slot=value\". Writes to out when given, else returns the brief.",
      inputSchema: { type: "object", properties: { job: { type: "string" }, template: { type: "string" }, strategy: { type: "string" }, strategies: { type: "string" }, methodFile: { type: "string" }, fill: { type: "array", items: { type: "string" } }, out: { type: "string" } }, required: ["job", "template"], additionalProperties: false },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "job", type: "string" }, { name: "template", type: "string" }]) ?? checkOptional(input, [{ name: "strategy", type: "string" }, { name: "strategies", type: "string" }, { name: "methodFile", type: "string" }, { name: "out", type: "string" }]) ?? checkStringArray(input, "fill");
        if (bad) return err(bad);
        const args = ["herd", "brief", "--job", input.job as string, "--template", input.template as string];
        if (typeof input.strategy === "string") args.push("--strategy", input.strategy);
        if (typeof input.strategies === "string") args.push("--strategies", input.strategies);
        if (typeof input.methodFile === "string") args.push("--method-file", input.methodFile);
        for (const f of (input.fill as string[] | undefined) ?? []) args.push("--fill", f);
        if (typeof input.out === "string") args.push("--out", input.out);
        const r = await deps.verb({ args });
        return r.ok ? ok(r.body) : err(r.error);
      },
    },
    {
      name: "herd_close",
      description: "Close one job's pane.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        return fromResponse(await deps.close({ herd: h.herd, job: input.job as string }));
      },
    },
    {
      name: "herd_status",
      description: "One herd: jobs, panes, gates, subscription, unread.",
      inputSchema: { type: "object", properties: { ...HERD_PROP }, additionalProperties: false },
      async handler(input, env) {
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        return fromResponse(await deps.status({ herd: h.herd }));
      },
    },
    {
      name: "herd_list",
      description: "Active herds (all: true includes finished ones).",
      inputSchema: { type: "object", properties: { all: { type: "boolean" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "all", type: "boolean" }]);
        if (bad) return err(bad);
        return fromResponse(await deps.list(input.all === true ? { all: true } : {}));
      },
    },
    {
      name: "herd_attend",
      description: "Open a job's pane in a tab of this shepherd's workspace.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, job: { type: "string" } }, required: ["job"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "job", type: "string" }]);
        if (bad) return err(bad);
        if (!env.HERDR_WORKSPACE_ID) return err("HERDR_WORKSPACE_ID is not set; this tool runs from a herdr pane");
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        return fromResponse(await deps.attend({ herd: h.herd, job: input.job as string, callerWorkspace: env.HERDR_WORKSPACE_ID }));
      },
    },
    {
      name: "herd_wrap_up",
      description: "Close panes, dispose the named worktrees, delete job dirs and archive the room in one pass, driven by the wrap-up form's answers.",
      inputSchema: { type: "object", properties: { ...HERD_PROP, closePanes: { type: "boolean" }, dispose: { type: "array", items: { type: "string" } }, deleteJobDirs: { type: "boolean" }, archiveRoom: { type: "boolean" } }, additionalProperties: false },
      async handler(input, env) {
        const bad = checkOptional(input, [{ name: "closePanes", type: "boolean" }, { name: "deleteJobDirs", type: "boolean" }, { name: "archiveRoom", type: "boolean" }]) ?? checkStringArray(input, "dispose");
        if (bad) return err(bad);
        const h = await herdFor(input, env);
        if ("error" in h) return err(h.error);
        const payload: Commands["herd:wrap-up"]["payload"] = { herd: h.herd };
        for (const k of ["closePanes", "deleteJobDirs", "archiveRoom"] as const) if (typeof input[k] === "boolean") payload[k] = input[k] as boolean;
        if (Array.isArray(input.dispose)) payload.dispose = input.dispose as string[];
        return fromResponse(await deps.wrapUp(payload));
      },
    },
    {
      name: "herd_resume",
      description: "Re-attach this session to a herd: re-subscribes to its gates and returns the open ones plus status.",
      inputSchema: { type: "object", properties: { herd: { type: "string" } }, required: ["herd"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "herd", type: "string" }]);
        if (bad) return err(bad);
        if (!env.CLAUDE_CODE_SESSION_ID) return err(NO_SESSION);
        const payload: Commands["herd:resume"]["payload"] = { herd: input.herd as string, session: env.CLAUDE_CODE_SESSION_ID };
        if (env.HERDR_PANE_ID) payload.callerPane = env.HERDR_PANE_ID;
        return fromResponse(await deps.resume(payload));
      },
    },
    {
      name: "herd_milestone",
      description: "Worker side: announce an artifact (a spec, a plan, a PR) to the shepherd and open the milestone gate, using HERD_ID, HERD_JOB and this pane's session.",
      inputSchema: { type: "object", properties: { artifact: { type: "string" }, summary: { type: "string" } }, required: ["artifact"], additionalProperties: false },
      async handler(input, env) {
        const w = requireWorkerEnv(env);
        if ("error" in w) return err(w.error);
        const bad = checkRequired(input, [{ name: "artifact", type: "string" }]) ?? checkOptional(input, [{ name: "summary", type: "string" }]);
        if (bad) return err(bad);
        const payload: Commands["herd:milestone"]["payload"] = { ...w, artifact: input.artifact as string };
        if (typeof input.summary === "string") payload.summary = input.summary;
        return fromResponse(await deps.milestone(payload));
      },
    },
  ];
}
