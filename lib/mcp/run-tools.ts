import { realpathSync } from "fs";
import { basename, isAbsolute, resolve } from "path";
import { runWriteVerb, type WriteVerb } from "../../commands/runs-write.ts";
import { listRuns } from "../../packages/rt-client/src/index.ts";
import { packPluginIdentity } from "../skills/provenance.ts";
import { runsRoot } from "../runs/paths.ts";
import { checkOptional, checkRequired, err, fromResponse, ok, type McpToolDef, type ToolResult } from "./shared.ts";

export interface RunToolDeps {
  write: typeof runWriteVerb;
  list: typeof listRuns;
  realpath: (p: string) => string;
  isPackRoot: (packRoot: string) => boolean;
}

export const realRunToolDeps: RunToolDeps = {
  write: runWriteVerb,
  list: listRuns,
  realpath: (p) => realpathSync(p),
  isPackRoot: (p) => packPluginIdentity(p) !== null,
};

// A quote or substitution in the compiled flag string would need a shell to
// mean anything; a whitespace split cannot honor it, so it is refused rather
// than passed through with a different meaning.
const SHELL_SYNTAX = /['"`$\\]/;

// Matches rt_verb's CONTROL_CHAR, minus tab/LF/CR (\x09,\x0a,\x0d), which
// \s already splits on rather than needing a separate refusal.
const CONTROL_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export function splitFlags(flags: string): { ok: true; args: string[] } | { ok: false; error: string } {
  if (SHELL_SYNTAX.test(flags)) return { ok: false, error: "flags must be plain flag tokens; quotes, $ and backticks are refused" };
  if (CONTROL_CHAR.test(flags)) return { ok: false, error: "flags must not contain control characters" };
  return { ok: true, args: flags.split(/\s+/).filter((a) => a !== "") };
}

// The set run-start's own CLI parses (commands/runs-write.ts) minus the ones
// this tool appends itself (--pack-dirs, --ticket, --spawned-by): a flags
// string that named one of those would let its value win over the tool's
// own append, since flagValue resolves the FIRST occurrence in argv.
const RUN_START_FLAGS = new Set(["--repo", "--work-type", "--pipeline", "--run-id", "--mattstack-sha", "--mattstack-dirty", "--pack-sha"]);

function checkRunStartFlags(args: string[]): string | undefined {
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const name = a.split("=")[0]!;
    if (!RUN_START_FLAGS.has(name)) {
      return `flags may only set ${[...RUN_START_FLAGS].sort().join(", ")}; refuses ${name}`;
    }
  }
  return undefined;
}

export function packRootFrom(skillDir: string, realpath: (p: string) => string): string {
  return realpath(resolve(skillDir, "..", ".."));
}

const RUN_DB_PROPS = {
  runDb: { type: "string", description: "The runDb run_start returned. Always pass it; omitted, cwd is required and the run is this session's run, else the newest running one whose worktree holds cwd." },
  cwd: { type: "string", description: "Absolute worktree path, used only when runDb is omitted." },
};

const NO_RUN = "pass runDb (from run_start) or cwd (the worktree); this server's own directory is not the run's";

function parseOut(out: string): unknown {
  try { return JSON.parse(out); } catch { return null; }
}

/** A caller-supplied runDb must resolve under the runs root and name the
    run store's own file, or it is a path into arbitrary state the daemon
    was never asked to write. The root is realpathed too (tolerating one
    that does not exist yet): a root behind a symlink (macOS /var and /tmp)
    would otherwise fail confinement against the runDb run_start returned. */
function checkRunDb(runDb: string, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { ok: true; real: string } | { ok: false; error: string } {
  if (!isAbsolute(runDb)) return { ok: false, error: '"runDb" must be an absolute path' };
  let real: string;
  try { real = realpath(runDb); } catch { return { ok: false, error: `runDb ${runDb} does not resolve` }; }
  const rawRoot = typeof env.RT_RUNS_ROOT === "string" && env.RT_RUNS_ROOT !== "" ? env.RT_RUNS_ROOT : runsRoot();
  if (!rawRoot) return { ok: false, error: "no runs root is configured" };
  let root = rawRoot;
  try { root = realpath(rawRoot); } catch { /* root need not exist yet; compare against it unresolved */ }
  if (real !== root && !real.startsWith(root.endsWith("/") ? root : `${root}/`)) return { ok: false, error: `runDb must be under the runs root (${root})` };
  if (basename(real) !== "state.db") return { ok: false, error: 'runDb must name a run store\'s "state.db"' };
  return { ok: true, real };
}

/** The pair every run tool but run_start and run_list resolves its DB from. */
function runTarget(input: Record<string, unknown>, env: NodeJS.ProcessEnv, realpath: (p: string) => string): { env: NodeJS.ProcessEnv; cwd: string } | { error: string } {
  const bad = checkOptional(input, [{ name: "runDb", type: "string" }, { name: "cwd", type: "string" }]);
  if (bad) return { error: bad };
  if (input.cwd !== undefined && !isAbsolute(input.cwd as string)) return { error: '"cwd" must be an absolute path' };
  if (typeof input.runDb === "string") {
    const db = checkRunDb(input.runDb, env, realpath);
    if (!db.ok) return { error: db.error };
    return { env: { ...env, RT_RUN_DB: db.real }, cwd: typeof input.cwd === "string" ? input.cwd : "/" };
  }
  if (typeof input.cwd === "string") {
    const { RT_RUN_DB: _unchecked, ...rest } = env;
    return { env: rest, cwd: input.cwd };
  }
  return { error: NO_RUN };
}

export function runToolDefs(deps: RunToolDeps = realRunToolDeps): McpToolDef[] {
  async function write(verb: WriteVerb, args: string[], input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<ToolResult> {
    const target = runTarget(input, env, deps.realpath);
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
        const skillDir = input.skillDir as string;
        if (!isAbsolute(skillDir)) return err('"skillDir" must be an absolute path');
        const split = splitFlags(input.flags as string);
        if (!split.ok) return err(split.error);
        const flagsBad = checkRunStartFlags(split.args);
        if (flagsBad) return err(flagsBad);
        let packRoot: string;
        try { packRoot = packRootFrom(skillDir, deps.realpath); } catch { return err(`skillDir ${skillDir} does not resolve`); }
        if (!deps.isPackRoot(packRoot)) return err(`skillDir ${skillDir} does not resolve to a pack (no .claude-plugin/plugin.json under ${packRoot})`);
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
        const target = runTarget(input, env, deps.realpath);
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
