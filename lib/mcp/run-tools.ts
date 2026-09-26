import { realpathSync } from "fs";
import { resolve } from "path";
import { runWriteVerb, type WriteVerb } from "../../commands/runs-write.ts";
import { listRuns } from "../../packages/rt-client/src/index.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, type McpToolDef, type ToolResult } from "./shared.ts";

export interface RunToolDeps {
  write: typeof runWriteVerb;
  list: typeof listRuns;
  realpath: (p: string) => string;
}

export const realRunToolDeps: RunToolDeps = { write: runWriteVerb, list: listRuns, realpath: (p) => realpathSync(p) };

// A quote or substitution in the compiled flag string would need a shell to
// mean anything; a whitespace split cannot honor it, so it is refused rather
// than passed through with a different meaning.
const SHELL_SYNTAX = /['"`$\\]/;

export function splitFlags(flags: string): { ok: true; args: string[] } | { ok: false; error: string } {
  if (SHELL_SYNTAX.test(flags)) return { ok: false, error: "flags must be plain flag tokens; quotes, $ and backticks are refused" };
  return { ok: true, args: flags.split(/\s+/).filter((a) => a !== "") };
}

export function packRootFrom(skillDir: string, realpath: (p: string) => string): string {
  return realpath(resolve(skillDir, "..", ".."));
}

const RUN_DB_PROPS = {
  runDb: { type: "string", description: "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is the newest running one whose worktree holds it." },
  cwd: { type: "string", description: "Absolute worktree path, used only when runDb is omitted." },
};

const NO_RUN = "pass runDb (from run_start) or cwd (the worktree); this server's own directory is not the run's";

function parseOut(out: string): unknown {
  try { return JSON.parse(out); } catch { return null; }
}

/** The pair every run tool but run_start and run_list resolves its DB from. */
function runTarget(input: Record<string, unknown>, env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; cwd: string } | { error: string } {
  const bad = checkOptional(input, [{ name: "runDb", type: "string" }, { name: "cwd", type: "string" }]);
  if (bad) return { error: bad };
  if (typeof input.runDb === "string") return { env: { ...env, RT_RUN_DB: input.runDb }, cwd: typeof input.cwd === "string" ? input.cwd : "/" };
  if (typeof input.cwd === "string") return { env, cwd: input.cwd };
  return { error: NO_RUN };
}

export function runToolDefs(deps: RunToolDeps = realRunToolDeps): McpToolDef[] {
  async function write(verb: WriteVerb, args: string[], input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<ToolResult> {
    const target = runTarget(input, env);
    if ("error" in target) return err(target.error);
    const r = await deps.write(verb, args, target.env, target.cwd);
    const body = parseOut(r.out);
    if (r.code === 0) return ok(body ?? { ok: true });
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `rt runs ${verb} failed (exit ${r.code})`;
    return err(message);
  }

  return [
    {
      name: "run_start",
      description: "Start a pipeline run and get back its runDb. flags is the compiled run-start flag string verbatim (the {{run-start.flags}} text: --repo, --work-type, --pipeline and friends); skillDir is the loaded skill's own directory (its pack root is derived from it). Pass the returned runDb to every other run_* tool.",
      inputSchema: {
        type: "object",
        properties: {
          flags: { type: "string" },
          skillDir: { type: "string", description: "Absolute path of the loaded skill's directory (CLAUDE_SKILL_DIR)." },
          ticket: { type: "string" },
          spawnedBy: { type: "string" },
        },
        required: ["flags", "skillDir"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "flags", type: "string" }, { name: "skillDir", type: "string" }]) ?? checkOptional(input, [{ name: "ticket", type: "string" }, { name: "spawnedBy", type: "string" }]);
        if (bad) return err(bad);
        const split = splitFlags(input.flags as string);
        if (!split.ok) return err(split.error);
        let packRoot: string;
        try { packRoot = packRootFrom(input.skillDir as string, deps.realpath); } catch { return err(`skillDir ${String(input.skillDir)} does not resolve`); }
        const args = [...split.args, "--pack-dirs", packRoot];
        if (typeof input.ticket === "string") args.push("--ticket", input.ticket);
        if (typeof input.spawnedBy === "string") args.push("--spawned-by", input.spawnedBy);
        // run-start never resolves a DB, so the pack root stands in for cwd.
        const r = await deps.write("run-start", args, env, packRoot);
        const body = parseOut(r.out) as { ok?: boolean; error?: string } | null;
        if (r.code !== 0 || !body?.ok) return err(body?.error ?? `rt runs run-start failed (exit ${r.code})`);
        return ok(body);
      },
    },
    {
      name: "run_stage",
      description: "Record a stage transition on a run: start, done, fail (with reason and detailPath) or redirect (with to and reason).",
      inputSchema: {
        type: "object",
        properties: {
          ...RUN_DB_PROPS,
          action: { type: "string", enum: ["start", "done", "fail", "redirect"] },
          stage: { type: "string" },
          reason: { type: "string" },
          detailPath: { type: "string" },
          to: { type: "string" },
        },
        required: ["action", "stage"],
        additionalProperties: false,
      },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "action", type: "string" }, { name: "stage", type: "string" }]) ?? checkOptional(input, [{ name: "reason", type: "string" }, { name: "detailPath", type: "string" }, { name: "to", type: "string" }]);
        if (bad) return err(bad);
        const stage = input.stage as string;
        switch (input.action) {
          case "start": return write("stage-start", ["--stage", stage], input, env);
          case "done": return write("stage-done", ["--stage", stage], input, env);
          case "fail": {
            const args = ["--stage", stage];
            if (typeof input.reason === "string") args.push("--reason", input.reason);
            if (typeof input.detailPath === "string") args.push("--detail-path", input.detailPath);
            return write("stage-fail", args, input, env);
          }
          case "redirect": {
            if (typeof input.to !== "string") return err('"to" is required for a redirect');
            const args = ["--stage", stage, "--to", input.to];
            if (typeof input.reason === "string") args.push("--reason", input.reason);
            return write("stage-redirect", args, input, env);
          }
          default: return err('"action" must be start, done, fail or redirect');
        }
      },
    },
    {
      name: "run_field_set",
      description: "Write one run field (key, value) as produced by a stage.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, key: { type: "string" }, value: { type: "string" }, stage: { type: "string" } }, required: ["key", "value", "stage"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "key", type: "string" }, { name: "value", type: "string" }, { name: "stage", type: "string" }]);
        if (bad) return err(bad);
        return write("field", ["set", input.key as string, input.value as string, "--stage", input.stage as string], input, env);
      },
    },
    {
      name: "run_field_get",
      description: "Read one run field; errors when the key is not set.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, key: { type: "string" } }, required: ["key"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "key", type: "string" }]);
        if (bad) return err(bad);
        const target = runTarget(input, env);
        if ("error" in target) return err(target.error);
        const r = await deps.write("field", ["get", input.key as string], target.env, target.cwd);
        if (r.code === 3) return err(`field "${String(input.key)}" is not set on this run`);
        if (r.code !== 0) return err((parseOut(r.out) as { error?: string } | null)?.error ?? `rt runs field get failed (exit ${r.code})`);
        return ok({ value: r.out });
      },
    },
    {
      name: "run_decision",
      description: "Record a decision on the run; selection is a JSON object and is serialized by the tool.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, contract: { type: "string" }, scope: { type: "string" }, selection: { type: "object" }, decidedBy: { type: "string" } }, required: ["contract", "scope", "selection", "decidedBy"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "contract", type: "string" }, { name: "scope", type: "string" }, { name: "selection", type: "object" }, { name: "decidedBy", type: "string" }]);
        if (bad) return err(bad);
        return write("decision", ["record", "--contract", input.contract as string, "--scope", input.scope as string, "--selection", JSON.stringify(input.selection), "--decided-by", input.decidedBy as string], input, env);
      },
    },
    {
      name: "run_status",
      description: "Set the run's terminal status: done, failed or abandoned.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS, status: { type: "string", enum: ["done", "failed", "abandoned"] } }, required: ["status"], additionalProperties: false },
      async handler(input, env) {
        const bad = checkRequired(input, [{ name: "status", type: "string" }]);
        if (bad) return err(bad);
        return write("run-status", ["--status", input.status as string], input, env);
      },
    },
    {
      name: "run_snapshot",
      description: "The run's stages, fields and decisions.",
      inputSchema: { type: "object", properties: { ...RUN_DB_PROPS }, additionalProperties: false },
      async handler(input, env) { return write("snapshot", [], input, env); },
    },
    {
      name: "run_list",
      description: "List runs the daemon knows, newest first, optionally narrowed to one repo directory name.",
      inputSchema: { type: "object", properties: { repo: { type: "string" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "repo", type: "string" }]);
        if (bad) return err(bad);
        return fromResponse(await deps.list(typeof input.repo === "string" ? input.repo : undefined, {}));
      },
    },
  ];
}
