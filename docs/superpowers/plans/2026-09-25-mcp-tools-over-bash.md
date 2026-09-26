# Skills Run on MCP Tools, Not Bash (RT-326) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every routine rt, forge or classifier-blocked git-write call a mattstack skill makes becomes a tool on the mattstack MCP server, and entering or leaving an rt worktree in a herdr pane asks nothing.

**Architecture:** 32 new tools join the roster in `lib/mcp/tools.ts`, each a thin wrapper over an existing daemon command (`rtCommand`), an in-process library call (`runWriteVerb`, git), or the `rt_verb` runner. The daemon gains one command (`pane:announce-relocation`) fed by a `PreToolUse` hook so it can drive the relocation dialog on attended panes, scoped to registered trees. Then the three skill sources (mattstack-skills engines and hand-authored skills, the compiled shepherdr, the claimview pack) move their shell calls onto the tools.

**Tech Stack:** Bun, TypeScript, `bun:test`, the `@modelcontextprotocol/sdk` low-level Server (already wired in `commands/mcp.ts`), sh hooks, Markdown skills.

**Spec:** `docs/superpowers/specs/2026-09-25-mcp-tools-over-bash-design.md` (read it first; every task below argues from it).

## Global Constraints

- Tests run from the rt repo root (`bun test` reads `bunfig.toml` only from cwd; `test-setup.ts` isolates HOME). A test that spawns `cli.ts` or reads source as text must be named `no-*.test.ts`.
- Before any PR: `bun run test`, `bunx tsc --noEmit`, and the e2e file covering the surface (`bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts` needs `RT_BINARY` pointing at a compiled `dist/rt`: `bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv ./cli.ts --outfile dist/rt`).
- A new hidden verb (`worktree announce-relocation`) needs a `lib/command-tree-def.ts` node, a `lib/module-registry.ts` thunk for its module (already present for `./commands/worktree-hook.ts`; verify), and an `omitBehavior` (`{ exempt: "..." }`), and must pass `bun run picker:check`.
- `lib/mcp/*` must not import `commands/herd.ts` or `commands/chat.ts` (header of `lib/mcp/tools.ts`). `commands/runs-write.ts` is the one `commands/` import the spec allows.
- Every new `agentSafe` leaf declares `--json`, is not `hidden`, and is added to the pinned list in `lib/__tests__/agent-safe.test.ts`.
- The trust-dialog work starts with captured screens: the ExitWorktree dialog and an attended EnterWorktree dialog are captured from a stalled pane and added as fixtures BEFORE `lib/daemon/trust-dialog.ts` changes. Every fixture claiming to be the real dialog is a paste of a real capture. The Bash-spoof, MCP-spoof and painted-dialog tests keep passing.
- No em dashes or en dashes anywhere (code, comments, commits, skills). Use "..." or rephrase.
- Comments state only constraints the code cannot show. No narration, no task ids, no decision history in source.
- Sessions in rt worktrees run under a Bash guard: no heredocs, no `&&`, no `-C`, no `git` inside python or awk program text. Give single plain commands. Where a task below shows two commands, run them as two Bash calls.
- `BASE_PERMISSIONS` (`lib/setup/base-permissions.ts`) edits are refused by the classifier for agents: Part D hands Matt the exact lines.
- The claimview pack is employer-visible: no mattstack ticket ids (`RT-*`, `SKILLS-*`) anywhere in it, including commit messages on its repo. Its team repo auto-commits and pushes dirty files on `main`, so Part C works on a branch in a worktree of that repo.
- Skill edits (Parts B and C) follow `superpowers:writing-skills`: RED baseline on the current skill, edit, GREEN retest with a fresh agent that loads the edited skill and is observed calling the tools, `sh tests/certify.sh <skill-dir>` in mattstack-skills, version bump in the same commit, `rt skills sync --pack <pack>` after merge to main.
- Run tools, git tools and `branch_sync` take their directory or `runDb` as an argument and refuse a call that gives neither; no tool handler reads `process.cwd()` (the MCP server's cwd is fixed at session start, so it would name the wrong tree).

## Review Focus

1. A `tree` argument that is a symlink to a registered worktree (macOS `/tmp` vs `/private/tmp`, a user symlink): the guard must compare realpaths, or a legitimate tree is refused and an alias of an unregistered one is accepted. Pinned in Task 7.
2. `git_push` on a branch whose upstream is a different remote branch name or remote (`branch.<name>.merge` or `.remote` differs), and a user whose `push.default` is `matching`: the push must go to exactly the tracked upstream ref by explicit refspec, never a bare `git push` that could sweep in main. Pinned in Task 8 (the renamed-upstream and other-remote tests, and every push call carrying `HEAD:refs/heads/<name>`).
3. A `run_start` `flags` string carrying a shell quote or a `$(`: the tool must refuse it, never split it into args that reach `runStart`. Pinned in Task 2.
4. An announced relocation whose dialog names a registered tree that is NOT the announced path (two EnterWorktree calls in quick succession, or a stale announcement): the daemon must leave it for the human. Pinned in Task 16.
5. `mr_merge` with `whenPipelineSucceeds: true` on an MR whose pipeline already succeeded: `setAutoMerge` alone may be a no-op on GitLab; the tool must return what it did (`autoMerge: true`) rather than `merged: true`, so the skill reports honestly. Pinned in Task 5.

## File Structure

rt (new):
- `lib/mcp/shared.ts`: the helpers `tools.ts` keeps private today, exported so tool files can split (`McpToolDef`, `ToolResult`, `ok`, `err`, `fromResponse`, `checkRequired`, `checkOptional`, `checkStringArray`, `MR_TARGET_PROPS`, `REPO_TARGET_PROPS`, `REPO_NAME_RULE`, `MR_WRITE_TIMEOUT_MS`, `resolveSoleHerd`, `requireWorkerEnv`, `requireJobEnv`).
- `lib/mcp/run-tools.ts`: the eight `run_*` tools over `runWriteVerb`.
- `lib/mcp/mr-read-tools.ts`: `mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`, `mr_job_trace`.
- `lib/mcp/tree-guard.ts`: `checkRegisteredTree`.
- `lib/mcp/git-tools.ts`: `git_push`, `git_pull`, `git_rebase`, `branch_sync`.
- `lib/mcp/worktree-tools.ts`: `worktree_provision`, `worktree_dispose`, `worktree_stop_holders`.
- `lib/mcp/herd-tools.ts`: the nine shepherd tools and `herd_milestone`.
- `lib/daemon/relocation-announce.ts`: `createRelocationWatcher`.
- Tests beside each in `lib/mcp/__tests__/` and `lib/daemon/__tests__/`.

rt (modified): `lib/mcp/tools.ts` (roster spread), `commands/runs-write.ts` (`cwd` parameter), `lib/command-tree.ts` (`agentTimeoutMs`), `lib/command-tree-def.ts` (agentSafe flags, `announce-relocation` node), `lib/mcp/rt-verb.ts` (per-node cap), `lib/daemon/trust-dialog.ts` (ExitWorktree anchors), `lib/daemon/handlers/pane.ts` and `lib/daemon/command-router.ts` and `lib/daemon.ts` (the announce command), `packages/rt-client/src/commands.ts` (the command entry), `commands/worktree-hook.ts` (the hidden verb), `e2e/tests/mcp-serve.test.ts`, `AGENTS.md`.

mattstack-skills: `hooks/hooks.json`, new `hooks/relocation-announce.sh`, `attachments/**/SKILL.md`, `skills/**`, `plugin/skills/**`, `.claude-plugin/plugin.json`.

claimview pack: `attachments/**/SKILL.md`, `skills/**`, `PACK.md`, `.claude-plugin/plugin.json`.

---

# Part A: rt

Each PR ends the same way (repeated in its close-out task): open the PR on `m4ttstack/rt`, wait for CI green and the CodeRabbit pass (or an Opus review if rate-limited), merge, deploy to the dev daemon (`git branch --show-current` on the shared checkout must read `main`, pull, `rt daemon restart`), then start a FRESH Claude Code session for the smoke (the mattstack MCP server is spawned once at session start, so a session opened before the deploy never lists the new tools; confirm with the tool list before calling anything), and smoke every new tool once against the glance harness project (`/Users/matt/Documents/GitHub/glance/harness_credentials.json` names the repo and users).

## PR (a): run tools

### Task 1: `runWriteVerb` takes `cwd`

**Files:**
- Modify: `commands/runs-write.ts:70-80` (`runWriteVerb`), `:187-200` (`withRunDbAsync`)
- Test: `lib/runs/__tests__/runs-write-cwd.test.ts`

**Interfaces:**
- Produces: `runWriteVerb(verb: WriteVerb, args: string[], env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Promise<CliResult>` where `CliResult = { out: string; code: number }`. Task 2 calls it with an explicit `cwd`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/runs/__tests__/runs-write-cwd.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runWriteVerb } from "../../../commands/runs-write.ts";

function scratch(): { root: string; tree: string; elsewhere: string } {
  const base = mkdtempSync(join(tmpdir(), "runs-cwd-"));
  const tree = join(base, "tree");
  const elsewhere = join(base, "elsewhere");
  mkdirSync(tree);
  mkdirSync(elsewhere);
  return { root: join(base, "runs"), tree, elsewhere };
}

describe("runWriteVerb cwd", () => {
  test("resolves the run by the cwd argument, not process.cwd()", async () => {
    const { root, tree, elsewhere } = scratch();
    const env = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const started = await runWriteVerb("run-start", ["--repo", "r", "--work-type", "w", "--pipeline", "p"], env);
    const runDb = JSON.parse(started.out).runDb as string;
    const set = await runWriteVerb("field", ["set", "worktree", tree, "--stage", "provision"], { ...env, RT_RUN_DB: runDb });
    expect(set.code).toBe(0);

    const inTree = await runWriteVerb("snapshot", [], env, tree);
    expect(inTree.code).toBe(0);
    expect(JSON.parse(inTree.out).runDbResolved).toBe("worktree");

    const outside = await runWriteVerb("snapshot", [], env, elsewhere);
    expect(outside.code).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/runs/__tests__/runs-write-cwd.test.ts`
Expected: FAIL. The 4th argument is ignored today, so both snapshots resolve the same way (the second call's `code` is not 2 or the first is not "worktree", depending on the test process cwd).

- [ ] **Step 3: Thread `cwd` through**

In `commands/runs-write.ts`:

```ts
export async function runWriteVerb(verb: WriteVerb, args: string[], env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Promise<CliResult> {
  try {
    return await dispatch(verb, args, env, cwd);
  } catch (err) {
    if (err instanceof Usage) return { out: json({ ok: false, error: err.message }), code: 2 };
    return { out: json({ ok: false, error: `sqlite write failed: ${String(err)}` }), code: 1 };
  }
}

async function dispatch(verb: WriteVerb, args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CliResult> {
```

Every `withRunDbAsync(env, ...)` call inside `dispatch` becomes `withRunDbAsync(env, cwd, ...)`, and:

```ts
async function withRunDbAsync(env: NodeJS.ProcessEnv, cwd: string, body: (run: RunDbHandle) => Promise<CliResult>): Promise<CliResult> {
  const found = resolveRunDb(env, cwd);
```

The `runsRunStart` ... `runsSnapshot` CLI exports stay as they are (default `cwd`).

- [ ] **Step 4: Run the test and the existing runs suites**

Run: `bun test lib/runs commands/__tests__/runs*`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add commands/runs-write.ts lib/runs/__tests__/runs-write-cwd.test.ts` then `git commit -m "runs-write: runWriteVerb takes cwd for run resolution"`.

### Task 2: `lib/mcp/shared.ts` and the eight `run_*` tools

**Files:**
- Create: `lib/mcp/shared.ts`, `lib/mcp/run-tools.ts`
- Modify: `lib/mcp/tools.ts` (import the helpers from `shared.ts` instead of defining them; spread `runToolDefs()` into the roster)
- Test: `lib/mcp/__tests__/run-tools.test.ts`; update `lib/mcp/__tests__/tools.test.ts` (`NAMES` gains the eight names, count 25 becomes 33)

**Interfaces:**
- Consumes: `runWriteVerb` from Task 1; `listRuns(payload, opts)` from `packages/rt-client/src/client.ts`.
- Produces: `runToolDefs(deps: RunToolDeps = realRunToolDeps): McpToolDef[]` with `RunToolDeps = { write: typeof runWriteVerb; list: typeof listRuns; realpath: (p: string) => string }`; `splitFlags(flags: string): { ok: true; args: string[] } | { ok: false; error: string }`; `packRootFrom(skillDir: string, realpath): string`.
- Tool inputs (all `additionalProperties: false`):
  - `run_start {flags: string, skillDir: string, ticket?: string, spawnedBy?: string}` returns `{ ok, runId, runDb }`.
  - `run_stage {runDb?: string, cwd?: string, action: "start"|"done"|"fail"|"redirect", stage: string, reason?: string, detailPath?: string, to?: string}`.
  - `run_field_set {runDb?, cwd?, key, value, stage}`; `run_field_get {runDb?, cwd?, key}` returns `{ value }`.
  - `run_decision {runDb?, cwd?, contract, scope, selection: object, decidedBy}`.
  - `run_status {runDb?, cwd?, status: "done"|"failed"|"abandoned"}`; `run_snapshot {runDb?, cwd?}`; `run_list {repo?: string}`.

- [ ] **Step 1: Extract the helpers into `lib/mcp/shared.ts`**

Move these from `tools.ts` verbatim, adding `export`: `McpToolDef`, `ToolResult`, `ok`, `err`, `fromResponse`, `FieldType`, `checkRequired`, `checkOptional`, `checkPositiveInts`, `checkStringArray`, `HERD_ENV_ERROR`, `MR_WRITE_TIMEOUT_MS`, `REPO_NAME_RULE`, `MR_TARGET_PROPS`, `REPO_TARGET_PROPS`, `withLandingHint`, `requireJobEnv`, `requireWorkerEnv`, `resolveSoleHerd`. `tools.ts` imports them (`import { ... } from "./shared.ts"`) and re-exports `McpToolDef` (`export type { McpToolDef } from "./shared.ts"`) so `commands/mcp.ts` and the tests keep their import. Run `bun test lib/mcp` and `bunx tsc --noEmit`: both green before anything new is added.

- [ ] **Step 2: Write the failing tests**

```ts
// lib/mcp/__tests__/run-tools.test.ts
import { describe, expect, test } from "bun:test";
import { packRootFrom, runToolDefs, splitFlags, type RunToolDeps } from "../run-tools.ts";

type Call = { verb: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };

function fakeDeps(out = '{"ok":true}', code = 0): { deps: RunToolDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      write: async (verb, args, env, cwd) => { calls.push({ verb, args, env: env ?? {}, cwd: cwd ?? "" }); return { out, code }; },
      list: async () => ({ ok: true, data: { runs: [] } }) as any,
      realpath: (p) => p.replace("/link/", "/real/"),
    },
  };
}

const tool = (deps: RunToolDeps, name: string) => runToolDefs(deps).find((t) => t.name === name)!;

describe("splitFlags", () => {
  test("splits on whitespace", () => {
    expect(splitFlags(" --repo r  --work-type w --pipeline p ")).toEqual({ ok: true, args: ["--repo", "r", "--work-type", "w", "--pipeline", "p"] });
  });
  test("refuses quotes and command substitution", () => {
    for (const bad of ["--repo 'r'", '--repo "r"', "--repo $(id)", "--repo `id`"]) {
      expect(splitFlags(bad).ok, bad).toBe(false);
    }
  });
});

describe("packRootFrom", () => {
  test("is the realpath two levels above the skill dir", () => {
    expect(packRootFrom("/link/pack/skills/work", (p) => p.replace("/link/", "/real/"))).toBe("/real/pack");
  });
});

describe("run_start", () => {
  test("builds the run-start argv from flags, skillDir, ticket and spawnedBy", async () => {
    const { deps, calls } = fakeDeps('{"ok":true,"runId":"x","runDb":"/db"}');
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "/link/pack/skills/work", ticket: "T-1", spawnedBy: "board" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ ok: true, runId: "x", runDb: "/db" });
    expect(calls[0]!.verb).toBe("run-start");
    expect(calls[0]!.args).toEqual(["--repo", "r", "--work-type", "w", "--pipeline", "p", "--pack-dirs", "/real/pack", "--ticket", "T-1", "--spawned-by", "board"]);
  });
  test("refuses a quoted flag string without calling write", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_start").handler({ flags: "--repo $(x)", skillDir: "/p/s/w" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("run tools pass runDb as RT_RUN_DB and cwd through", () => {
  test("run_stage start", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "start", stage: "plan" }, { HOME: "/h" } as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-start", args: ["--stage", "plan"] });
    expect(calls[0]!.env.RT_RUN_DB).toBe("/db");
    expect(calls[0]!.env.HOME).toBe("/h");
  });
  test("run_stage fail carries reason and detailPath; redirect carries to", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "fail", stage: "ci", reason: "red", detailPath: "/d" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_stage").handler({ runDb: "/db", action: "redirect", stage: "ci", to: "implement", reason: "back" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-fail", args: ["--stage", "ci", "--reason", "red", "--detail-path", "/d"] });
    expect(calls[1]).toMatchObject({ verb: "stage-redirect", args: ["--stage", "ci", "--to", "implement", "--reason", "back"] });
  });
  test("run_stage redirect without to is a field error", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_stage").handler({ runDb: "/db", action: "redirect", stage: "ci" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("to");
    expect(calls).toEqual([]);
  });
  test("run_field_set and run_field_get", async () => {
    const { deps, calls } = fakeDeps("main", 0);
    await tool(deps, "run_field_set").handler({ runDb: "/db", key: "branch", value: "feat", stage: "provision" }, {} as NodeJS.ProcessEnv);
    const got = await tool(deps, "run_field_get").handler({ runDb: "/db", key: "branch" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "field", args: ["set", "branch", "feat", "--stage", "provision"] });
    expect(calls[1]).toMatchObject({ verb: "field", args: ["get", "branch"] });
    expect(got).toEqual({ ok: true, body: { value: "main" } });
  });
  test("run_field_get on a missing key (exit 3) is an error naming the key", async () => {
    const { deps } = fakeDeps("", 3);
    const res = await tool(deps, "run_field_get").handler({ runDb: "/db", key: "mr" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("mr");
  });
  test("run_decision serializes selection itself", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_decision").handler({ runDb: "/db", contract: "gate@1", scope: "close", selection: { next: "done" }, decidedBy: "pane" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "decision", args: ["record", "--contract", "gate@1", "--scope", "close", "--selection", '{"next":"done"}', "--decided-by", "pane"] });
  });
  test("run_status and run_snapshot; cwd stands in when runDb is omitted", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_status").handler({ cwd: "/tree", status: "done" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_snapshot").handler({ cwd: "/tree" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "run-status", args: ["--status", "done"], cwd: "/tree" });
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
    expect(calls[1]).toMatchObject({ verb: "snapshot", args: [], cwd: "/tree" });
  });
  test("neither runDb nor cwd is refused without touching the run store", async () => {
    const { deps, calls } = fakeDeps();
    for (const name of ["run_stage", "run_field_set", "run_field_get", "run_decision", "run_status", "run_snapshot"]) {
      const res = await tool(deps, name).handler({ action: "start", stage: "s", key: "k", value: "v", contract: "c", scope: "s", selection: {}, decidedBy: "d", status: "done" }, {} as NodeJS.ProcessEnv);
      expect(res.ok, name).toBe(false);
      expect(res.error, name).toContain("runDb");
    }
    expect(calls).toEqual([]);
  });
  test("run_list passes the repo positionally to listRuns", async () => {
    const seen: unknown[] = [];
    const { deps } = fakeDeps();
    deps.list = (async (repo: unknown) => { seen.push(repo); return { ok: true, data: { runs: [] } }; }) as any;
    await tool(deps, "run_list").handler({ repo: "acme" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_list").handler({}, {} as NodeJS.ProcessEnv);
    expect(seen).toEqual(["acme", undefined]);
  });
  test("a non-zero write result surfaces the envelope's error", async () => {
    const { deps } = fakeDeps('{"ok":false,"error":"stage not running"}', 2);
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/db" }, {} as NodeJS.ProcessEnv);
    expect(res).toEqual({ ok: false, body: undefined, error: "stage not running" });
  });
});
```

Also in `lib/mcp/__tests__/tools.test.ts`: add `"run_start","run_stage","run_field_set","run_field_get","run_decision","run_status","run_snapshot","run_list"` to `NAMES` and change the count assertion to 33.

- [ ] **Step 3: Run to verify failure**

Run: `bun test lib/mcp/__tests__/run-tools.test.ts lib/mcp/__tests__/tools.test.ts`
Expected: FAIL, `../run-tools.ts` does not exist; the roster count reads 25.

- [ ] **Step 4: Implement `lib/mcp/run-tools.ts`**

```ts
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
```

`listRuns` is `listRuns(repo?: string, opts: RtClientOptions = {})` (`packages/rt-client/src/client.ts:110`): the repo goes positionally, never as `{ repo }`. In `lib/mcp/tools.ts`, `import { runToolDefs } from "./run-tools.ts";` and end `mcpTools()`'s array with `...runToolDefs(),`.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS, roster 33.

- [ ] **Step 6: Guard the import boundary**

Run: `bun test lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-ui-in-cli.test.ts`
Expected: PASS (run-tools imports only `commands/runs-write.ts`, which has no UI).

- [ ] **Step 7: Commit**

`git add lib/mcp/shared.ts lib/mcp/run-tools.ts lib/mcp/tools.ts lib/mcp/__tests__/run-tools.test.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: run_* tools over runWriteVerb; split shared helpers out of tools.ts"`.

### Task 3: PR (a) close-out

**Files:**
- Modify: `e2e/tests/mcp-serve.test.ts` (the `tools/list` assertion in the first test names the eight run tools)

- [ ] **Step 1: Extend the e2e list assertion**

In the test at `e2e/tests/mcp-serve.test.ts:208` ("initialize -> tools/list -> tools/call ..."), after the existing names check, add:

```ts
for (const name of ["run_start", "run_stage", "run_field_set", "run_field_get", "run_decision", "run_status", "run_snapshot", "run_list"]) {
  expect(toolNames, name).toContain(name);
}
```

(`toolNames` is whatever the test already binds the listed names to; read the test and use its variable.)

- [ ] **Step 2: Build and run the gate**

Run: `bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv ./cli.ts --outfile dist/rt`
Run: `RT_BINARY=$PWD/dist/rt bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
Expected: PASS.

- [ ] **Step 3: Full checks**

Run: `bun run test` then `bunx tsc --noEmit`. Expected: green.

- [ ] **Step 4: Commit, open the PR, merge, deploy, smoke**

Commit `e2e/tests/mcp-serve.test.ts` as `mcp: e2e lists the run tools`. Open the PR titled `mcp: run_* tools (RT-326 a)`. After merge: on the shared checkout confirm `git branch --show-current` prints `main`, pull, `rt daemon restart`. Smoke: start a fresh Claude Code session in a glance harness worktree (an existing session keeps the old MCP server), confirm `run_start` is in the tool list, then call `run_start` with the `work` engine's compiled flags, then `run_stage`, `run_field_set`, `run_field_get`, `run_decision`, `run_snapshot`, `run_list`, `run_status` once each; every call returns `ok`, and `rt runs show <runId>` shows the rows.

## PR (b): GitLab reads and `mr_merge`

### Task 4: `lib/mcp/mr-read-tools.ts`

**Files:**
- Create: `lib/mcp/mr-read-tools.ts`
- Modify: `lib/mcp/tools.ts` (spread `mrReadToolDefs()`)
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`; `tools.test.ts` `NAMES` gains six names, count 39

**Interfaces:**
- Consumes: `resolveMrTarget`, `resolveRepoTarget` (`lib/mcp/mr-target.ts`); `readProjectMRs(repoName, maxAgeMs?, demand?, opts?)`, `readDiscussions(repoName, iid, opts)`, `readMrsByBranch(repoName, branches, opts)`, `rtCommand` from rt-client.
- Produces: `mrReadToolDefs(deps: MrReadDeps = realMrReadDeps): McpToolDef[]` with `MrReadDeps = { projectMrs: typeof readProjectMRs; discussions: typeof readDiscussions; byBranch: typeof readMrsByBranch; command: typeof rtCommand }`.
- Tools: `mr_view {repoName|mrUrl, iid, maxAgeMs?}` returns `{ mr: PullRequest, fetchedAt }`; `mr_list {repoName|mrUrl, state?: "opened"|"merged"|"closed"|"all" (default opened), maxAgeMs?}` returns `{ mrs: PullRequest[], syncedAt }`; `mr_for_branch {repoName|mrUrl, branches: string[]}` returns `MrByBranchData`; `mr_threads {repoName|mrUrl, iid, refresh?: boolean}` returns `DiscussionsData`; `mr_pipeline {repoName|mrUrl, iid, maxAgeMs? (default 5000), jobId?}` returns `{ pipeline: Pipeline|null, job?: MrJobDetail }`; `mr_job_trace {repoName|mrUrl, iid, jobId}` returns `{ trace: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/mcp/__tests__/mr-read-tools.test.ts
import { describe, expect, test } from "bun:test";
import { mrReadToolDefs, type MrReadDeps } from "../mr-read-tools.ts";

const pr = (iid: number, state: string, branch = `b${iid}`) => ({ iid, state, sourceBranch: branch, title: `t${iid}`, pipeline: { status: "success", id: "gitlab:pipeline:9" } });

function fake(overrides: Partial<MrReadDeps> = {}): { deps: MrReadDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: MrReadDeps = {
    projectMrs: async (repo, maxAgeMs) => { calls.push(`mrs:${repo}:${maxAgeMs ?? ""}`); return { ok: true, data: { mrs: { a: { pr: pr(1, "opened"), fetchedAt: 1 }, b: { pr: pr(2, "merged"), fetchedAt: 2 } }, listSyncedAt: 3, source: "poll", syncedAt: 3 } } as any; },
    discussions: async (repo, iid) => { calls.push(`disc:${repo}:${iid}`); return { ok: true, data: { discussions: [], fetchedAt: 1 } } as any; },
    byBranch: async (repo, branches) => { calls.push(`branch:${repo}:${branches.join(",")}`); return { ok: true, data: { byBranch: {}, syncedAt: 1 } } as any; },
    command: (async (name: string) => { calls.push(`cmd:${name}`); return { ok: true, data: name === "mr:fetch-job-trace" ? "log text" : { id: 7 } }; }) as any,
    ...overrides,
  };
  return { deps, calls };
}
const tool = (deps: MrReadDeps, name: string) => mrReadToolDefs(deps).find((t) => t.name === name)!;
// Targeting is exercised in mr-target.test.ts; here every call passes an identity so resolveMrTarget succeeds without a registry.
const ID = "remote:gitlab.com%2Facme%2Facme-dev";

describe("mr read tools", () => {
  test("mr_view returns the one MR whose iid matches", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 2, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect((res.body as any).mr.iid).toBe(2);
    expect(calls).toEqual([`mrs:${ID}:5000`]);
  });
  test("mr_view on an unknown iid errors naming it", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("9");
  });
  test("mr_list defaults to opened and honors state all", async () => {
    const { deps } = fake();
    const opened = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    const all = await tool(deps, "mr_list").handler({ repoName: ID, state: "all" }, {} as NodeJS.ProcessEnv);
    expect((opened.body as any).mrs.map((m: any) => m.iid)).toEqual([1]);
    expect((all.body as any).mrs.map((m: any) => m.iid)).toEqual([1, 2]);
  });
  test("mr_for_branch passes the branches through", async () => {
    const { deps, calls } = fake();
    await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["x", "y"] }, {} as NodeJS.ProcessEnv);
    expect(calls).toEqual([`branch:${ID}:x,y`]);
  });
  test("mr_threads refreshes first only when asked", async () => {
    const { deps, calls } = fake();
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1, refresh: true }, {} as NodeJS.ProcessEnv);
    expect(calls).toEqual([`disc:${ID}:1`, "cmd:discussions:refresh", `disc:${ID}:1`]);
  });
  test("mr_pipeline reads live by default and adds job detail for a jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline.status).toBe("success");
    expect((res.body as any).job).toEqual({ id: 7 });
    expect(calls).toEqual([`mrs:${ID}:5000`, "cmd:mr:fetch-job-detail"]);
  });
  test("mr_job_trace returns the trace text", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ trace: "log text" });
  });
  test("mr_job_trace refuses a non-positive jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 0 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/mr-read-tools.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// lib/mcp/mr-read-tools.ts
import { readDiscussions, readMrsByBranch, readProjectMRs, rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
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

export function mrReadToolDefs(deps: MrReadDeps = realMrReadDeps): McpToolDef[] {
  async function mrs(identity: string, maxAgeMs: number | undefined) {
    const res = await deps.projectMrs(identity, maxAgeMs);
    if (!res.ok || !res.data) return { error: explainError(res.error ?? "failed to read MRs") };
    return { data: res.data };
  }

  return [
    {
      name: "mr_view",
      description: `GitLab only. One MR by iid from the daemon's project cache; pass a small maxAgeMs (e.g. 5000) when the read must be live. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if ("error" in read) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(`no MR !${target.iid} in ${target.identity}`);
        return ok({ mr: entry.pr, fetchedAt: entry.fetchedAt });
      },
    },
    {
      name: "mr_list",
      description: `GitLab only. MRs of the target project by state (default opened). ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_TARGET_PROPS, state: { type: "string", enum: [...STATES] }, maxAgeMs: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "state", type: "string" }, { name: "maxAgeMs", type: "number" }]);
        if (bad) return err(bad);
        const state = (input.state as string | undefined) ?? "opened";
        if (!STATES.includes(state as typeof STATES[number])) return err(`"state" must be one of ${STATES.join(", ")}`);
        const target = await resolveRepoTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, input.maxAgeMs as number | undefined);
        if ("error" in read) return err(read.error);
        const all = Object.values(read.data.mrs).map((e) => e.pr);
        return ok({ mrs: state === "all" ? all : all.filter((pr) => pr.state === state), syncedAt: read.data.syncedAt });
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
      description: `GitLab only. The MR's head pipeline (live by default, maxAgeMs 5000) and, with jobId, that job's detail. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...MR_TARGET_PROPS, maxAgeMs: { type: "number" }, jobId: { type: "number" } }, additionalProperties: false },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "maxAgeMs", type: "number" }]) ?? checkPositiveInts(input, ["jobId"]);
        if (bad) return err(bad);
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const read = await mrs(target.identity, (input.maxAgeMs as number | undefined) ?? LIVE_MAX_AGE_MS);
        if ("error" in read) return err(read.error);
        const entry = Object.values(read.data.mrs).find((e) => e.pr.iid === target.iid);
        if (!entry) return err(`no MR !${target.iid} in ${target.identity}`);
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
```

Export `checkPositiveInts` from `shared.ts` if Task 2 left it in `tools.ts`. Spread `...mrReadToolDefs()` into `mcpTools()`.

- [ ] **Step 4: Run tests**

Run: `bun test lib/mcp`. Expected: PASS with roster 39 (update `NAMES` and the count).

- [ ] **Step 5: Commit**

`git add lib/mcp/mr-read-tools.ts lib/mcp/tools.ts lib/mcp/shared.ts lib/mcp/__tests__/mr-read-tools.test.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: GitLab read tools (mr_view, mr_list, mr_for_branch, mr_threads, mr_pipeline, mr_job_trace)"`.

### Task 5: `mr_merge`

**Files:**
- Modify: `lib/mcp/tools.ts` (add after `mr_rebase`)
- Test: `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Consumes: `runMrAction(target, action, args, body)` in `tools.ts`; daemon `mr:action` with `merge` (args[0] is glance's `MergePullRequestInput`: `squash?`, `shouldRemoveSourceBranch?`) and `setAutoMerge`.
- Produces: `mr_merge {repoName|mrUrl, iid, squash?: boolean, removeSourceBranch?: boolean, whenPipelineSucceeds?: boolean}` returning `{ merged: true }` or `{ autoMerge: true }`.

- [ ] **Step 1: Write the failing tests**

Add to `tools.test.ts` (inside a new `describe("mr_merge")` that mocks `rtCommand` at `../../../packages/rt-client/src/transport.ts` the same way the `gate_ask` describe does, restoring in `afterEach`):

```ts
test("mr_merge merges now with squash and removeSourceBranch mapped to glance's input", async () => {
  const calls: Array<{ name: string; payload: any }> = [];
  mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: async (name: string, payload: unknown) => { calls.push({ name, payload }); return { ok: true, data: {} }; } }));
  const tool = mcpTools().find((t) => t.name === "mr_merge")!;
  const res = await tool.handler({ repoName: ID, iid: 4, squash: true, removeSourceBranch: true }, {} as NodeJS.ProcessEnv);
  expect(res).toEqual({ ok: true, body: { merged: true } });
  expect(calls[0]!.payload).toMatchObject({ action: "merge", iid: 4, args: [{ squash: true, shouldRemoveSourceBranch: true }] });
});

test("mr_merge with whenPipelineSucceeds routes to setAutoMerge and says so", async () => {
  const calls: Array<{ name: string; payload: any }> = [];
  mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: async (name: string, payload: unknown) => { calls.push({ name, payload }); return { ok: true, data: {} }; } }));
  const tool = mcpTools().find((t) => t.name === "mr_merge")!;
  const res = await tool.handler({ repoName: ID, iid: 4, whenPipelineSucceeds: true }, {} as NodeJS.ProcessEnv);
  expect(res).toEqual({ ok: true, body: { autoMerge: true } });
  expect(calls[0]!.payload).toMatchObject({ action: "setAutoMerge", args: [] });
});

test("mr_merge refuses a non-boolean squash", async () => {
  const tool = mcpTools().find((t) => t.name === "mr_merge")!;
  const res = await tool.handler({ repoName: ID, iid: 4, squash: "yes" }, {} as NodeJS.ProcessEnv);
  expect(res.ok).toBe(false);
});
```

`ID` is the serialized identity constant the file already uses for mr tools (search for `remote:gitlab.com` in the file; define `const ID = ...` if absent). Add `"mr_merge"` to `NAMES`, count 40.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`. Expected: FAIL, no `mr_merge`.

- [ ] **Step 3: Implement**

```ts
{
  name: "mr_merge",
  description: `GitLab only. Merge the MR now (GitLab still enforces approvals and pipeline rules), optionally squashing and deleting the source branch; whenPipelineSucceeds: true instead enables auto-merge and returns autoMerge: true. ${REPO_NAME_RULE}`,
  inputSchema: {
    type: "object",
    properties: { ...MR_TARGET_PROPS, squash: { type: "boolean" }, removeSourceBranch: { type: "boolean" }, whenPipelineSucceeds: { type: "boolean" } },
    additionalProperties: false,
  },
  async handler(input) {
    const bad = checkOptional(input, [{ name: "squash", type: "boolean" }, { name: "removeSourceBranch", type: "boolean" }, { name: "whenPipelineSucceeds", type: "boolean" }]);
    if (bad) return err(bad);
    const target = await resolveMrTarget(input);
    if (!target.ok) return err(target.error);
    if (input.whenPipelineSucceeds === true) return runMrAction(target, "setAutoMerge", [], { autoMerge: true });
    const merge: { squash?: boolean; shouldRemoveSourceBranch?: boolean } = {};
    if (typeof input.squash === "boolean") merge.squash = input.squash;
    if (typeof input.removeSourceBranch === "boolean") merge.shouldRemoveSourceBranch = input.removeSourceBranch;
    return withLandingHint(await runMrAction(target, "merge", [merge], { merged: true }), "the MR's state");
  },
},
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/mcp`. Expected: PASS.

- [ ] **Step 5: Commit**

`git add lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: mr_merge over mr:action merge and setAutoMerge"`.

### Task 6: PR (b) close-out

- [ ] **Step 1: e2e list assertion** gains `mr_view`, `mr_list`, `mr_for_branch`, `mr_threads`, `mr_pipeline`, `mr_job_trace`, `mr_merge` (same loop as Task 3).
- [ ] **Step 2:** Build `dist/rt`, run `e2e/tests/mcp-serve.test.ts`, `bun run test`, `bunx tsc --noEmit`. Expected: green.
- [ ] **Step 3:** Commit `mcp: e2e lists the GitLab read tools and mr_merge`; PR `mcp: GitLab reads and mr_merge (RT-326 b)`; merge; deploy (branch check, pull, `rt daemon restart`).
- [ ] **Step 4: Smoke** from a fresh Claude Code session (the deployed server is only picked up at session start) on the glance harness project: `mr_list`, `mr_view`, `mr_for_branch`, `mr_threads {refresh: true}`, `mr_pipeline`, `mr_job_trace` on a harness MR; `mr_merge` on a throwaway harness MR created for the purpose (open it with `mr_create`, merge it, confirm merged on GitLab).

## PR (c): git tools

### Task 7: `lib/mcp/tree-guard.ts`

**Files:**
- Create: `lib/mcp/tree-guard.ts`
- Test: `lib/mcp/__tests__/tree-guard.test.ts`

**Interfaces:**
- Consumes: `loadRepoIndex(): Record<string, string>` (`lib/repo-index.ts`), `findTreeByPath(path): { repoName; tree } | null` (`lib/worktree/registry.ts`).
- Produces: `checkRegisteredTree(tree: unknown, deps: TreeGuardDeps = realTreeGuardDeps): { ok: true; path: string; repoName: string } | { ok: false; error: string }` with `TreeGuardDeps = { repoIndex: () => Record<string, string>; treeByPath: (p: string) => { repoName: string; tree: string } | null; realpath: (p: string) => string }`.

- [ ] **Step 1: Failing test**

```ts
// lib/mcp/__tests__/tree-guard.test.ts
import { describe, expect, test } from "bun:test";
import { checkRegisteredTree, type TreeGuardDeps } from "../tree-guard.ts";

const deps: TreeGuardDeps = {
  repoIndex: () => ({ "remote:gitlab.com%2Facme%2Fapp": "/real/app" }),
  treeByPath: (p) => (p === "/real/pool/app-1" ? { repoName: "remote:gitlab.com%2Facme%2Fapp", tree: "app-1" } : null),
  realpath: (p) => { if (p.startsWith("/nope")) throw new Error("ENOENT"); return p.replace("/link/", "/real/"); },
};

describe("checkRegisteredTree", () => {
  test("accepts a registered checkout and a registered worktree, by realpath", () => {
    expect(checkRegisteredTree("/link/app", deps)).toEqual({ ok: true, path: "/real/app", repoName: "remote:gitlab.com%2Facme%2Fapp" });
    expect(checkRegisteredTree("/link/pool/app-1", deps)).toEqual({ ok: true, path: "/real/pool/app-1", repoName: "remote:gitlab.com%2Facme%2Fapp" });
  });
  test("refuses an unregistered directory, a relative path, a non-string and a missing path", () => {
    for (const bad of ["/real/other", "app", 3, undefined, "/nope/x"]) {
      const r = checkRegisteredTree(bad, deps);
      expect(r.ok, String(bad)).toBe(false);
    }
    expect((checkRegisteredTree("/real/other", deps) as { error: string }).error).toContain("registered");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test lib/mcp/__tests__/tree-guard.test.ts`: FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// lib/mcp/tree-guard.ts
import { realpathSync } from "fs";
import { isAbsolute } from "path";
import { loadRepoIndex } from "../repo-index.ts";
import { findTreeByPath } from "../worktree/registry.ts";

export interface TreeGuardDeps {
  repoIndex: () => Record<string, string>;
  treeByPath: (p: string) => { repoName: string; tree: string } | null;
  realpath: (p: string) => string;
}

export const realTreeGuardDeps: TreeGuardDeps = { repoIndex: loadRepoIndex, treeByPath: findTreeByPath, realpath: (p) => realpathSync(p) };

export const UNREGISTERED_TREE = "tree must be an absolute path to a checkout or worktree of a repo registered with rt (rt repos register in its checkout first)";

export function checkRegisteredTree(tree: unknown, deps: TreeGuardDeps = realTreeGuardDeps): { ok: true; path: string; repoName: string } | { ok: false; error: string } {
  if (typeof tree !== "string" || !isAbsolute(tree)) return { ok: false, error: UNREGISTERED_TREE };
  let path: string;
  try { path = deps.realpath(tree); } catch { return { ok: false, error: `tree ${tree} does not exist` }; }
  for (const [repoName, checkout] of Object.entries(deps.repoIndex())) {
    let real: string;
    try { real = deps.realpath(checkout); } catch { continue; }
    if (real === path) return { ok: true, path, repoName };
  }
  const hit = deps.treeByPath(path);
  if (hit) return { ok: true, path, repoName: hit.repoName };
  return { ok: false, error: UNREGISTERED_TREE };
}
```

- [ ] **Step 4: Run.** `bun test lib/mcp/__tests__/tree-guard.test.ts`: PASS.
- [ ] **Step 5: Commit.** `git add lib/mcp/tree-guard.ts lib/mcp/__tests__/tree-guard.test.ts` then `git commit -m "mcp: registered-tree guard for the git tools"`.

### Task 8: `git_push`, `git_pull`, `git_rebase`

**Files:**
- Create: `lib/mcp/git-tools.ts`
- Test: `lib/mcp/__tests__/git-tools.test.ts`

**Interfaces:**
- Consumes: `checkRegisteredTree` (Task 7); `runCapture(argv, opts)` from `lib/subprocess.ts` returning `{ stdout, stderr, exitCode }`.
- Produces: `type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>`; `realGitRunner`; `gitPush(cwd, opts: { forceWithLease?: boolean; setUpstream?: boolean }, git): Promise<ToolResult>`; `gitPull(cwd, git)`; `gitRebase(cwd, opts: { onto?: string; abort?: boolean }, git)`; `gitToolDefs(deps: GitToolDeps = realGitToolDeps): McpToolDef[]` with `GitToolDeps = { git: GitRunner; guard: TreeGuardDeps }`. Task 9 adds `branch_sync` to the same file and deps.

- [ ] **Step 1: Failing tests**

```ts
// lib/mcp/__tests__/git-tools.test.ts
import { describe, expect, test } from "bun:test";
import { gitPull, gitPush, gitRebase, gitToolDefs, type GitRunner } from "../git-tools.ts";
import type { TreeGuardDeps } from "../tree-guard.ts";

type Script = Record<string, { code?: number; stdout?: string; stderr?: string }>;
// `git remote` answers "origin\nfork" unless the script overrides it, so the
// fetch-before-rebase branch has remotes to recognize.
function fakeGit(script: Script, calls: string[] = []): GitRunner {
  return async (args) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = script[key] ?? (key === "remote" ? { stdout: "origin\nfork\n" } : { code: 1, stderr: `unscripted: ${key}` });
    return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
}
const onFeature: Script = {
  "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
  "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/x\n" },
};

describe("gitPush", () => {
  test("pushes HEAD to the upstream by explicit refspec, force only as --force-with-lease", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "push --force-with-lease origin HEAD:refs/heads/feat/x": {} }, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push --force-with-lease origin HEAD:refs/heads/feat/x");
  });
  test("an upstream with a different branch name is pushed to THAT name, never to origin/<local>", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/feat/renamed\n" }, "push origin HEAD:refs/heads/feat/renamed": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push origin HEAD:refs/heads/feat/renamed");
    expect((r.body as { upstream: string }).upstream).toBe("origin/feat/renamed");
  });
  test("an upstream on another remote goes to that remote", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork/feat/x\n" }, "symbolic-ref --quiet --short refs/remotes/fork/HEAD": { code: 128 }, "push fork HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push fork HEAD:refs/heads/feat/x");
  });
  test("a feature branch whose upstream is origin/main (checkout -b feat/x origin/main) is refused", async () => {
    for (const up of ["origin/main", "origin/master", "origin/develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: `${up}\n` } }, calls));
      expect(r.ok, up).toBe(false);
      expect(r.error, up).toContain(up);
      expect(calls.some((c) => c.startsWith("push")), up).toBe(false);
    }
  });
  test("an upstream on another remote is checked against THAT remote's default", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "fork/trunk\n" }, "symbolic-ref --quiet --short refs/remotes/fork/HEAD": { stdout: "fork/trunk\n" } };
    const r = await gitPush("/t", {}, fakeGit(script, calls));
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("setUpstream pushes -u origin HEAD:refs/heads/<branch>", async () => {
    const calls: string[] = [];
    const script = { ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 }, "push -u origin HEAD:refs/heads/feat/x": {} };
    const r = await gitPush("/t", { setUpstream: true }, fakeGit(script, calls));
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toBe("push -u origin HEAD:refs/heads/feat/x");
  });
  test("no upstream and no setUpstream is an error naming setUpstream", async () => {
    const r = await gitPush("/t", {}, fakeGit({ ...onFeature, "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128 } }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("setUpstream");
  });
  test("refuses a detached HEAD", async () => {
    const calls: string[] = [];
    const r = await gitPush("/t", {}, fakeGit({ "symbolic-ref --quiet --short HEAD": { code: 1 } }, calls));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("detached");
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
  });
  test("refuses main, master and the remote default branch", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await gitPush("/t", { forceWithLease: true }, fakeGit({ ...onFeature, "symbolic-ref --quiet --short HEAD": { stdout: `${branch}\n` } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls.some((c) => c.startsWith("push")), branch).toBe(false);
    }
  });
});

describe("gitPull", () => {
  test("is --ff-only and reports a diverged branch as an error", async () => {
    const calls: string[] = [];
    const ok = await gitPull("/t", fakeGit({ "pull --ff-only": { stdout: "Fast-forward" } }, calls));
    expect(ok.ok).toBe(true);
    expect(calls).toEqual(["pull --ff-only"]);
    const diverged = await gitPull("/t", fakeGit({ "pull --ff-only": { code: 128, stderr: "fatal: Not possible to fast-forward, aborting." } }));
    expect(diverged.ok).toBe(false);
    expect(diverged.error).toContain("fast-forward");
  });
});

describe("gitRebase", () => {
  test("rebases onto a remote-tracking ref after fetching its remote", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase origin/develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "origin/develop", fetched: "origin" } });
    expect(calls).toEqual(["remote", "fetch origin", "rebase origin/develop"]);
  });
  test("a local ref is not fetched", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "develop" }, fakeGit({ "rebase develop": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "ok", onto: "develop", fetched: null } });
    expect(calls).toEqual(["remote", "rebase develop"]);
  });
  test("an onto that starts with a dash is refused before git runs", async () => {
    for (const onto of ["--exec=touch /tmp/x", "-i", "--onto=x"]) {
      const calls: string[] = [];
      const r = await gitRebase("/t", { onto }, fakeGit({}, calls));
      expect(r.ok, onto).toBe(false);
      expect(calls.filter((c) => c.startsWith("rebase")), onto).toEqual([]);
    }
  });
  test("a conflict returns the conflicted files and leaves the tree mid-rebase", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { onto: "origin/develop" }, fakeGit({ "fetch origin": {}, "rebase origin/develop": { code: 1, stderr: "CONFLICT" }, "diff --name-only --diff-filter=U": { stdout: "a.ts\nb.ts\n" } }, calls));
    expect(r).toEqual({ ok: true, body: { status: "conflict", onto: "origin/develop", files: ["a.ts", "b.ts"] } });
    expect(calls).not.toContain("rebase --abort");
  });
  test("abort runs rebase --abort; onto and abort together are refused", async () => {
    const calls: string[] = [];
    const r = await gitRebase("/t", { abort: true }, fakeGit({ "rebase --abort": {} }, calls));
    expect(r).toEqual({ ok: true, body: { status: "aborted" } });
    const both = await gitRebase("/t", { abort: true, onto: "x" }, fakeGit({}));
    expect(both.ok).toBe(false);
    const neither = await gitRebase("/t", {}, fakeGit({}));
    expect(neither.ok).toBe(false);
  });
});

describe("gitToolDefs guard", () => {
  test("every git tool refuses an unregistered tree before running git", async () => {
    const calls: string[] = [];
    const guard: TreeGuardDeps = { repoIndex: () => ({}), treeByPath: () => null, realpath: (p) => p };
    for (const [name, input] of [["git_push", {}], ["git_pull", {}], ["git_rebase", { onto: "x" }]] as const) {
      const tool = gitToolDefs({ git: fakeGit({}, calls), guard, sync: async () => ({ code: 0, stdout: "{}", stderr: "" }) }).find((t) => t.name === name)!;
      const r = await tool.handler({ tree: "/elsewhere", ...input }, {} as NodeJS.ProcessEnv);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("registered");
    }
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test lib/mcp/__tests__/git-tools.test.ts`: FAIL, module missing.

- [ ] **Step 3: Implement the three verbs and the defs (leave a `sync` dep slot for Task 9)**

```ts
// lib/mcp/git-tools.ts
import { runCapture } from "../subprocess.ts";
import { checkOptional, err, ok, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realGitRunner: GitRunner = async (args, cwd) => {
  const r = await runCapture(["git", ...args], { cwd, stderr: "pipe", timeoutMs: 120_000 });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
};

const PROTECTED = new Set(["main", "master"]);

async function currentBranch(cwd: string, git: GitRunner): Promise<string | null> {
  const r = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

async function remoteDefault(cwd: string, git: GitRunner, remote = "origin"): Promise<string | null> {
  const r = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd);
  if (r.code !== 0) return null;
  return r.stdout.trim().replace(new RegExp(`^${remote}/`), "");
}

function detail(r: { stderr: string; stdout: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-3).join(" ");
}

/** The branch a tool may push from: never detached, never main/master or the remote default. */
export async function pushableBranch(cwd: string, git: GitRunner): Promise<{ branch: string } | { error: string }> {
  const branch = await currentBranch(cwd, git);
  if (branch === null) return { error: "refusing to push a detached HEAD" };
  const def = await remoteDefault(cwd, git);
  if (PROTECTED.has(branch) || branch === def) return { error: `refusing to push ${branch}: the default branch and main/master are never pushed by a tool` };
  return { branch };
}

// A bare `git push` obeys push.default, which under `matching` pushes every
// matching branch (main included) and under `simple` fails on a renamed
// upstream; an explicit refspec pushes exactly one ref either way.
export async function gitPush(cwd: string, opts: { forceWithLease?: boolean; setUpstream?: boolean }, git: GitRunner): Promise<ToolResult> {
  const b = await pushableBranch(cwd, git);
  if ("error" in b) return err(b.error);
  const branch = b.branch;
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  const args = ["push"];
  if (opts.forceWithLease) args.push("--force-with-lease");
  let remote: string;
  let remoteBranch: string;
  if (upstream.code === 0) {
    const full = upstream.stdout.trim();
    const slash = full.indexOf("/");
    if (slash <= 0) return err(`cannot read the upstream of ${branch}: ${full}`);
    remote = full.slice(0, slash);
    remoteBranch = full.slice(slash + 1);
    // `git checkout -b feat/x origin/main` tracks main, so the local name
    // passing says nothing about where the refspec lands.
    const remoteDef = await remoteDefault(cwd, git, remote);
    if (PROTECTED.has(remoteBranch) || remoteBranch === remoteDef) return err(`refusing to push ${branch}: its upstream is ${full}, the default branch or main/master; retarget the upstream (git branch -u) or pass setUpstream after unsetting it`);
  } else {
    if (!opts.setUpstream) return err(`${branch} has no upstream; pass setUpstream: true to push it as origin/${branch}`);
    remote = "origin";
    remoteBranch = branch;
    args.push("-u");
  }
  args.push(remote, `HEAD:refs/heads/${remoteBranch}`);
  const r = await git(args, cwd);
  if (r.code !== 0) return err(`git push failed: ${detail(r)}`);
  return ok({ pushed: true, branch, forceWithLease: opts.forceWithLease === true, upstream: `${remote}/${remoteBranch}` });
}

export async function gitPull(cwd: string, git: GitRunner): Promise<ToolResult> {
  const r = await git(["pull", "--ff-only"], cwd);
  if (r.code !== 0) return err(`git pull --ff-only failed (a diverged branch is never merged or rebased here): ${detail(r)}`);
  return ok({ pulled: true, output: r.stdout.trim() });
}

async function remoteOf(ref: string, cwd: string, git: GitRunner): Promise<string | null> {
  const slash = ref.indexOf("/");
  if (slash <= 0) return null;
  const remotes = await git(["remote"], cwd);
  const names = remotes.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const head = ref.slice(0, slash);
  return names.includes(head) ? head : null;
}

// `git rebase` does not take `--` before its ref, so a dash-leading onto is
// refused outright: passed through, `--exec=<cmd>` would run that command.
export async function gitRebase(cwd: string, opts: { onto?: string; abort?: boolean }, git: GitRunner): Promise<ToolResult> {
  if (opts.abort && opts.onto !== undefined) return err("pass onto or abort, not both");
  if (opts.abort) {
    const r = await git(["rebase", "--abort"], cwd);
    return r.code === 0 ? ok({ status: "aborted" }) : err(`git rebase --abort failed: ${detail(r)}`);
  }
  if (typeof opts.onto !== "string" || opts.onto === "") return err('"onto" (a branch or ref) is required unless abort: true');
  if (opts.onto.startsWith("-") || /\s/.test(opts.onto)) return err('"onto" must be a branch or ref name, not an option');
  const fetched = await remoteOf(opts.onto, cwd, git);
  if (fetched !== null) {
    const f = await git(["fetch", fetched], cwd);
    if (f.code !== 0) return err(`git fetch ${fetched} failed: ${detail(f)}`);
  }
  const r = await git(["rebase", opts.onto], cwd);
  if (r.code === 0) return ok({ status: "ok", onto: opts.onto, fetched });
  const conflicted = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
  const files = conflicted.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (files.length > 0) return ok({ status: "conflict", onto: opts.onto, files });
  return err(`git rebase ${opts.onto} failed: ${detail(r)}`);
}

export interface GitToolDeps {
  git: GitRunner;
  guard: TreeGuardDeps;
  /** Runs `rt sync --json --no-agent` in a tree; Task 9 supplies the real one. */
  sync: (cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

const TREE_PROP = { tree: { type: "string", description: "Absolute path of a checkout or worktree of a repo registered with rt." } };

export function gitToolDefs(deps: GitToolDeps): McpToolDef[] {
  const guarded = (fn: (path: string, input: Record<string, unknown>) => Promise<ToolResult>) => async (input: Record<string, unknown>): Promise<ToolResult> => {
    const tree = checkRegisteredTree(input.tree, deps.guard);
    if (!tree.ok) return err(tree.error);
    return fn(tree.path, input);
  };
  return [
    {
      name: "git_push",
      description: "Push the tree's current branch to its upstream (or as origin/<branch> with setUpstream). Force is only ever --force-with-lease. Refuses a detached HEAD, the repo's default branch, main and master.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, forceWithLease: { type: "boolean" }, setUpstream: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path, input) => {
        const bad = checkOptional(input, [{ name: "forceWithLease", type: "boolean" }, { name: "setUpstream", type: "boolean" }]);
        if (bad) return err(bad);
        return gitPush(path, { forceWithLease: input.forceWithLease === true, setUpstream: input.setUpstream === true }, deps.git);
      }),
    },
    {
      name: "git_pull",
      description: "Fast-forward the tree's current branch from its upstream (--ff-only). A diverged branch is an error, never a merge or rebase.",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path) => gitPull(path, deps.git)),
    },
    {
      name: "git_rebase",
      description: "Rebase the tree's current branch onto a named branch or ref; a remote-tracking ref (origin/<branch>) is fetched first. On a conflict it returns status conflict with the conflicted files and leaves the tree mid-rebase for you to resolve (then finish with git rebase --continue in Bash), or pass abort: true to abort one in progress.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, onto: { type: "string" }, abort: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      handler: guarded(async (path, input) => {
        const bad = checkOptional(input, [{ name: "onto", type: "string" }, { name: "abort", type: "boolean" }]);
        if (bad) return err(bad);
        return gitRebase(path, { onto: input.onto as string | undefined, abort: input.abort === true }, deps.git);
      }),
    },
  ];
}
```

- [ ] **Step 4: Run.** `bun test lib/mcp/__tests__/git-tools.test.ts`: PASS.
- [ ] **Step 5: Commit.** `git add lib/mcp/git-tools.ts lib/mcp/__tests__/git-tools.test.ts` then `git commit -m "mcp: git_push, git_pull, git_rebase with every refusal pinned"`.

### Task 9: `branch_sync`

**Files:**
- Modify: `lib/mcp/git-tools.ts` (add `branchSyncPreflight`, `realSyncRunner`, `realGitToolDeps`, the `branch_sync` def), `lib/mcp/tools.ts` (spread `gitToolDefs(realGitToolDeps)`)
- Test: `lib/mcp/__tests__/git-tools.test.ts`; `tools.test.ts` `NAMES` gains `git_push`, `git_pull`, `git_rebase`, `branch_sync`, count 44

**Interfaces:**
- Consumes: `execWithTimeout(argv, { cwd, env, timeoutMs })` (`lib/setup/probes.ts`), `rtSelfArgv()` (`lib/rt-self.ts`), `rt sync --json --no-agent` (exit 0 synced, 3 conflict bundle on stdout, 4 stack refusal).
- Produces: `branchSyncPreflight(cwd, git): Promise<{ ok: true; diverged: boolean } | { ok: false; error: string }>`; `branch_sync {tree}` returning `{ status: "synced", ...summary }` or `{ status: "conflict", ...bundle }`.

- [ ] **Step 1: Failing tests** (append to `git-tools.test.ts`)

```ts
import { branchSyncPreflight } from "../git-tools.ts";

describe("branchSyncPreflight", () => {
  const base: Script = {
    "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" },
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
    "fetch origin": {},
    "rev-parse --verify --quiet origin/feat/x": {},
  };
  test("not diverged passes", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t2\n" } }));
    expect(r).toEqual({ ok: true, diverged: false });
  });
  test("diverged with every local commit patch-equivalent on origin passes (the GitLab-rebased case)", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "cherry origin/feat/x HEAD": { stdout: "- abc\n- def\n" } }));
    expect(r).toEqual({ ok: true, diverged: true });
  });
  test("diverged with an unpushed local commit refuses and names it", async () => {
    const r = await branchSyncPreflight("/t", fakeGit({ ...base, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "3\t2\n" }, "cherry origin/feat/x HEAD": { stdout: "- abc\n+ 0123456\n" } }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("0123456");
  });
  test("no remote branch yet passes; a detached HEAD refuses", async () => {
    expect(await branchSyncPreflight("/t", fakeGit({ ...base, "rev-parse --verify --quiet origin/feat/x": { code: 1 } }))).toEqual({ ok: true, diverged: false });
    expect((await branchSyncPreflight("/t", fakeGit({ "symbolic-ref --quiet --short HEAD": { code: 1 } }))).ok).toBe(false);
  });
  test("main, master and the remote default branch refuse before any fetch (rt sync would force-push them)", async () => {
    for (const branch of ["main", "master", "develop"]) {
      const calls: string[] = [];
      const r = await branchSyncPreflight("/t", fakeGit({ ...base, "symbolic-ref --quiet --short HEAD": { stdout: `${branch}\n` }, "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" } }, calls));
      expect(r.ok, branch).toBe(false);
      expect(calls, branch).not.toContain("fetch origin");
    }
  });
});

describe("branch_sync tool", () => {
  const guard: TreeGuardDeps = { repoIndex: () => ({ r: "/t" }), treeByPath: () => null, realpath: (p) => p };
  const clean: Script = {
    "symbolic-ref --quiet --short HEAD": { stdout: "feat/x\n" }, "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/develop\n" },
    "fetch origin": {}, "rev-parse --verify --quiet origin/feat/x": {},
    "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "0\t1\n" },
  };
  test("exit 0 is synced, exit 3 is a conflict bundle, exit 4 is a refusal", async () => {
    for (const [code, stdout, expectOk, status] of [[0, '{"pushed":true}', true, "synced"], [3, '{"conflicts":["a.ts"]}', true, "conflict"], [4, '{"error":"stack member"}', false, ""]] as const) {
      const tool = gitToolDefs({ git: fakeGit(clean), guard, sync: async () => ({ code, stdout, stderr: "" }) }).find((t) => t.name === "branch_sync")!;
      const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
      expect(r.ok, String(code)).toBe(expectOk);
      if (expectOk) expect((r.body as { status: string }).status).toBe(status);
    }
  });
  test("a failed preflight never runs rt sync", async () => {
    let ran = false;
    const tool = gitToolDefs({ git: fakeGit({ ...clean, "rev-list --left-right --count origin/feat/x...HEAD": { stdout: "1\t1\n" }, "cherry origin/feat/x HEAD": { stdout: "+ 9999\n" } }), guard, sync: async () => { ran = true; return { code: 0, stdout: "{}", stderr: "" }; } }).find((t) => t.name === "branch_sync")!;
    const r = await tool.handler({ tree: "/t" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.** FAIL: `branchSyncPreflight` not exported, no `branch_sync`.

- [ ] **Step 3: Implement**

```ts
import { execWithTimeout } from "../setup/probes.ts";
import { rtSelfArgv } from "../rt-self.ts";

// rt sync pushes `origin <local branch>` by name (commands/sync.ts:301), never
// the tracked upstream, so the local-name refusal is the whole protection here.
export async function branchSyncPreflight(cwd: string, git: GitRunner): Promise<{ ok: true; diverged: boolean } | { ok: false; error: string }> {
  const b = await pushableBranch(cwd, git);
  if ("error" in b) return { ok: false, error: b.error.replace("push", "sync") };
  const branch = b.branch;
  const fetched = await git(["fetch", "origin"], cwd);
  if (fetched.code !== 0) return { ok: false, error: `git fetch origin failed: ${detail(fetched)}` };
  const remote = await git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], cwd);
  if (remote.code !== 0) return { ok: true, diverged: false };
  const counts = await git(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], cwd);
  const [behind, ahead] = counts.stdout.trim().split(/\s+/).map((n) => Number(n));
  if (!behind || !ahead) return { ok: true, diverged: false };
  const cherry = await git(["cherry", `origin/${branch}`, "HEAD"], cwd);
  const unpushed = cherry.stdout.split("\n").filter((l) => l.startsWith("+ ")).map((l) => l.slice(2).trim());
  if (unpushed.length > 0) return { ok: false, error: `refusing to reset ${branch} to origin: local commits with no equivalent on origin would be lost: ${unpushed.join(", ")}` };
  return { ok: true, diverged: true };
}

const SYNC_TIMEOUT_MS = 300_000;

export const realSyncRunner = (cwd: string) => execWithTimeout([...rtSelfArgv(), "sync", "--json", "--no-agent"], { cwd, env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" }, timeoutMs: SYNC_TIMEOUT_MS });

export const realGitToolDeps: GitToolDeps = { git: realGitRunner, guard: realTreeGuardDeps, sync: realSyncRunner };
```

Add to the `gitToolDefs` array:

```ts
{
  name: "branch_sync",
  description: "Bring the tree's branch current in one call, the rt sync flow: fetch; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease. Refuses when a local commit has no equivalent on origin (unpushed work), naming the commits. A rebase conflict returns status conflict with rt sync's bundle and leaves the rebase paused.",
  inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
  handler: guarded(async (path) => {
    const pre = await branchSyncPreflight(path, deps.git);
    if (!pre.ok) return err(pre.error);
    const r = await deps.sync(path);
    let body: unknown = null;
    try { body = JSON.parse(r.stdout); } catch { body = null; }
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (r.code === 0) return ok({ status: "synced", resetToOrigin: pre.diverged, ...obj });
    if (r.code === 3) return ok({ status: "conflict", ...obj });
    if (r.code === 124) return err(`rt sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`);
    const message = typeof obj.error === "string" ? obj.error : detail(r);
    return err(`rt sync refused (exit ${r.code}): ${message}`);
  }),
},
```

Check `execWithTimeout`'s return shape at `lib/setup/probes.ts:15` (`ExecResult`) and adapt the `sync` dep type to it if its field names differ from `{ code, stdout, stderr }`. In `tools.ts`: `import { gitToolDefs, realGitToolDeps } from "./git-tools.ts";` and spread `...gitToolDefs(realGitToolDeps)`.

- [ ] **Step 4: Run.** `bun test lib/mcp`: PASS, roster 44.
- [ ] **Step 5: Commit.** `git add lib/mcp/git-tools.ts lib/mcp/tools.ts lib/mcp/__tests__/git-tools.test.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: branch_sync with the cherry-gated reset preflight"`.

### Task 10: PR (c) close-out

- [ ] **Step 1:** e2e list assertion gains `git_push`, `git_pull`, `git_rebase`, `branch_sync`.
- [ ] **Step 2:** `bun test lib/__tests__/no-spawn-without-env.test.ts` (runCapture passes `childEnv()`; execWithTimeout passes an env: both satisfy the guard). Build `dist/rt`; run `e2e/tests/mcp-serve.test.ts`; `bun run test`; `bunx tsc --noEmit`.
- [ ] **Step 3:** Commit `mcp: e2e lists the git tools`; PR `mcp: git tools (RT-326 c)`; merge; deploy.
- [ ] **Step 4: Smoke** from a fresh Claude Code session in a glance harness worktree on a feature branch: `git_push {setUpstream: true}`, a second `git_push {forceWithLease: true}` after an amend, `git_pull`, `git_rebase {onto: "origin/main"}`, `git_rebase {abort: true}` after a staged conflict, `branch_sync`. Also `git_push` on `main` and on an unregistered directory: both refused.

## PR (d): worktree and herd tools, wider `rt_verb`

### Task 11: `lib/mcp/worktree-tools.ts`

**Files:**
- Create: `lib/mcp/worktree-tools.ts`
- Modify: `lib/mcp/tools.ts` (spread)
- Test: `lib/mcp/__tests__/worktree-tools.test.ts`; `tools.test.ts` `NAMES` gains three, count 47

**Interfaces:**
- Consumes: `resolveRepoTarget({ repoName })`; daemon `worktree:provision {repoName, branch?, ticket?, ticketTitle?, disposal?, owner?}`, `worktree:dispose {repoName, tree}`, `worktree:stop-holders {repoName, tree}`.
- Produces: `worktreeToolDefs(deps: { command: typeof rtCommand } = { command: rtCommand }): McpToolDef[]`; tools `worktree_provision {repoName, ticket?, ticketTitle?, branch?, disposal?: "merge"|"job", owner?}` (ticket or branch required) returning `WorktreeProvisionData`; `worktree_dispose {repoName, tree}` returning `WorktreeDisposeData`; `worktree_stop_holders {repoName, tree}` returning `{ terminated }`.

- [ ] **Step 1: Failing tests**

```ts
// lib/mcp/__tests__/worktree-tools.test.ts
import { describe, expect, test } from "bun:test";
import { worktreeToolDefs } from "../worktree-tools.ts";

const ID = "remote:gitlab.com%2Facme%2Facme-dev";
function fake() {
  const calls: Array<{ name: string; payload: any; opts: any }> = [];
  const command = (async (name: string, payload: unknown, opts: unknown) => { calls.push({ name, payload, opts }); return { ok: true, data: { done: name } }; }) as any;
  return { calls, tool: (n: string) => worktreeToolDefs({ command }).find((t) => t.name === n)! };
}

describe("worktree tools", () => {
  test("provision needs a ticket or a branch", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ticket");
    expect(calls).toEqual([]);
  });
  test("provision passes ticket, title, disposal and owner and waits minutes", async () => {
    const { tool, calls } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ name: "worktree:provision", payload: { repoName: ID, ticket: "T-9", ticketTitle: "Do it", disposal: "job", owner: "shepherd" } });
    expect(calls[0]!.opts.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
  test("provision refuses an unknown disposal", async () => {
    const { tool } = fake();
    const r = await tool("worktree_provision").handler({ repoName: ID, branch: "b", disposal: "later" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("dispose and stop_holders name the tree", async () => {
    const { tool, calls } = fake();
    await tool("worktree_dispose").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    await tool("worktree_stop_holders").handler({ repoName: ID, tree: "acme-dev-3" }, {} as NodeJS.ProcessEnv);
    expect(calls.map((c) => c.name)).toEqual(["worktree:dispose", "worktree:stop-holders"]);
    expect(calls[0]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
    expect(calls[1]!.payload).toEqual({ repoName: ID, tree: "acme-dev-3" });
  });
});
```

- [ ] **Step 2: Run to verify failure.** FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// lib/mcp/worktree-tools.ts
import { rtCommand } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, checkRequired, err, fromResponse, REPO_NAME_RULE, type McpToolDef } from "./shared.ts";

const PROVISION_TIMEOUT_MS = 300_000;
const DISPOSE_TIMEOUT_MS = 120_000;
const REPO_PROP = { repoName: { type: "string", description: "Serialized identity, absolute checkout or worktree path, or a label matching exactly one registered repo." } };

export function worktreeToolDefs(deps: { command: typeof rtCommand } = { command: rtCommand }): McpToolDef[] {
  async function repo(input: Record<string, unknown>): Promise<{ identity: string } | { error: string }> {
    const bad = checkRequired(input, [{ name: "repoName", type: "string" }]);
    if (bad) return { error: bad };
    const t = await resolveRepoTarget({ repoName: input.repoName });
    return t.ok ? { identity: t.identity } : { error: t.error };
  }
  return [
    {
      name: "worktree_provision",
      description: `Claim a worktree for a ticket or branch (from the on-deck pool, or freshly created) and get back its path; then enter it with EnterWorktree in path mode. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: { ...REPO_PROP, ticket: { type: "string" }, ticketTitle: { type: "string" }, branch: { type: "string" }, disposal: { type: "string", enum: ["merge", "job"] }, owner: { type: "string" } },
        required: ["repoName"],
        additionalProperties: false,
      },
      async handler(input) {
        const bad = checkOptional(input, [{ name: "ticket", type: "string" }, { name: "ticketTitle", type: "string" }, { name: "branch", type: "string" }, { name: "disposal", type: "string" }, { name: "owner", type: "string" }]);
        if (bad) return err(bad);
        if (typeof input.ticket !== "string" && typeof input.branch !== "string") return err("pass a ticket (with an optional ticketTitle) or a branch");
        if (input.disposal !== undefined && input.disposal !== "merge" && input.disposal !== "job") return err('"disposal" must be merge or job');
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        const payload: Commands["worktree:provision"]["payload"] = { repoName: r.identity };
        for (const k of ["ticket", "ticketTitle", "branch", "owner"] as const) if (typeof input[k] === "string") payload[k] = input[k] as string;
        if (input.disposal === "merge" || input.disposal === "job") payload.disposal = input.disposal;
        return fromResponse(await deps.command<Commands["worktree:provision"]["data"]>("worktree:provision", payload, { timeoutMs: PROVISION_TIMEOUT_MS }));
      },
    },
    {
      name: "worktree_dispose",
      description: `Dispose a worktree by its tree name (not the one this session sits in); it goes to the restorable trash. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string", description: "The tree name as worktree list prints it." } }, required: ["repoName", "tree"], additionalProperties: false },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:dispose"]["data"]>("worktree:dispose", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: DISPOSE_TIMEOUT_MS }));
      },
    },
    {
      name: "worktree_stop_holders",
      description: `End the processes rt ties to a worktree (dev servers, watchers), and only those. There is no general kill tool. ${REPO_NAME_RULE}`,
      inputSchema: { type: "object", properties: { ...REPO_PROP, tree: { type: "string" } }, required: ["repoName", "tree"], additionalProperties: false },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "tree", type: "string" }]);
        if (bad) return err(bad);
        const r = await repo(input);
        if ("error" in r) return err(r.error);
        return fromResponse(await deps.command<Commands["worktree:stop-holders"]["data"]>("worktree:stop-holders", { repoName: r.identity, tree: input.tree as string }, { timeoutMs: 60_000 }));
      },
    },
  ];
}
```

The unit test passes an identity string, which `resolveRepoTarget` accepts without a registry lookup when it parses as an identity; if `tryResolveRepoArg` still consults the store, seed the repo index the way `tools.test.ts` does (`setKvValue(REPO_INDEX_NS, ...)`) in a `beforeEach`.

- [ ] **Step 4: Run.** `bun test lib/mcp`: PASS, roster 47.
- [ ] **Step 5: Commit.** `git add lib/mcp/worktree-tools.ts lib/mcp/tools.ts lib/mcp/__tests__/worktree-tools.test.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: worktree_provision, worktree_dispose, worktree_stop_holders"`.

### Task 12: `lib/mcp/herd-tools.ts`

**Files:**
- Create: `lib/mcp/herd-tools.ts`
- Modify: `lib/mcp/tools.ts` (spread; keep `herd_gates`, `herd_ask`, `herd_answer`, `herd_report` where they are)
- Test: `lib/mcp/__tests__/herd-tools.test.ts`; `tools.test.ts` `NAMES` gains ten, count 57

**Interfaces:**
- Consumes: rt-client `herdStart`, `herdSpawn`, `herdClose`, `herdStatus`, `herdList`, `herdAttend`, `herdWrapUp`, `herdResume`, `herdMilestone` (signatures in `packages/rt-client/src/client.ts:565-690`); `runRtVerb` (`lib/mcp/rt-verb.ts`); `resolveSoleHerd`, `requireWorkerEnv` from `shared.ts`; `resolveRepoTarget`.
- Produces: `herdToolDefs(deps: HerdToolDeps = realHerdToolDeps): McpToolDef[]` with `HerdToolDeps = { start, spawn, close, status, list, attend, wrapUp, resume, milestone, verb: typeof runRtVerb }` (each the rt-client function's type).
- Tools: `herd_start {name, repo, hidden?}`; `herd_spawn {herd?, job, brief?, dir?, model?, effort?, account?, disposable?}`; `herd_brief {job, template, strategy?, strategies?, methodFile?, fill?: string[], out?}`; `herd_close {herd?, job}`; `herd_status {herd?}`; `herd_list {all?}`; `herd_attend {herd?, job}`; `herd_wrap_up {herd?, closePanes?, dispose?: string[], deleteJobDirs?, archiveRoom?}`; `herd_resume {herd}`; `herd_milestone {artifact, summary?}` (worker env).
- Herd resolution for `herd?`: explicit, else `env.HERD_ID`, else `resolveSoleHerd()`.

- [ ] **Step 1: Failing tests**

```ts
// lib/mcp/__tests__/herd-tools.test.ts
import { describe, expect, test } from "bun:test";
import { herdToolDefs, type HerdToolDeps } from "../herd-tools.ts";

function fake() {
  const calls: Array<{ fn: string; a: any; o: any }> = [];
  const rec = (fn: string) => (async (a: unknown, o: unknown) => { calls.push({ fn, a, o }); return { ok: true, data: { fn } }; }) as any;
  const deps: HerdToolDeps = {
    start: rec("start"), spawn: rec("spawn"), close: rec("close"), status: rec("status"), list: rec("list"),
    attend: rec("attend"), wrapUp: rec("wrapUp"), resume: rec("resume"), milestone: rec("milestone"),
    verb: (async (input: unknown) => { calls.push({ fn: "verb", a: input, o: undefined }); return { ok: true, body: { brief: "x" } }; }) as any,
  };
  return { calls, tool: (n: string) => herdToolDefs(deps).find((t) => t.name === n)! };
}
const SESSION = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "p1", HERDR_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv;

describe("herd shepherd tools", () => {
  test("herd_start uses the session and pane from env", async () => {
    const { tool, calls } = fake();
    await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ name: "n", session: "s1", callerPane: "p1" });
  });
  test("herd_start without a session errors", async () => {
    const { tool } = fake();
    const r = await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("herd_spawn passes every option and a minutes-long timeout, with no check", async () => {
    const { tool, calls } = fake();
    await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", job: "j", brief: "/b.md", model: "opus", effort: "high", account: "a", disposable: true });
    expect(calls[0]!.o.timeoutMs).toBeGreaterThanOrEqual(180_000);
  });
  test("herd defaults to HERD_ID when omitted", async () => {
    const { tool, calls } = fake();
    await tool("herd_status").handler({}, { HERD_ID: "hd-9" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toEqual({ herd: "hd-9" });
  });
  test("herd_brief spawns rt herd brief through the verb runner with repeated --fill", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: "/t.md", strategy: "direct-tdd", strategies: "/s.md", fill: ["goal=ship", "fence=src/"], out: "/o.md" }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", "/t.md", "--strategy", "direct-tdd", "--strategies", "/s.md", "--fill", "goal=ship", "--fill", "fence=src/", "--out", "/o.md"] });
  });
  test("herd_attend needs HERDR_WORKSPACE_ID", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", job: "j", callerWorkspace: "w1" });
  });
  test("herd_wrap_up forwards the wrap-up form's answers", async () => {
    const { tool, calls } = fake();
    await tool("herd_wrap_up").handler({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true }, SESSION);
    expect(calls[0]!.a).toEqual({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true });
  });
  test("herd_resume passes the session", async () => {
    const { tool, calls } = fake();
    await tool("herd_resume").handler({ herd: "hd-1" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", session: "s1", callerPane: "p1" });
  });
});

describe("herd_milestone", () => {
  test("uses the worker env and passes artifact and summary", async () => {
    const { tool, calls } = fake();
    await tool("herd_milestone").handler({ artifact: "/a.md", summary: "done" }, { ...SESSION, HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", job: "j", session: "s1", pane: "p1", artifact: "/a.md", summary: "done" });
  });
  test("outside a worker pane it errors with the worker-pane text", async () => {
    const { tool } = fake();
    const r = await tool("herd_milestone").handler({ artifact: "/a.md" }, {} as NodeJS.ProcessEnv);
    expect(r.error).toContain("HERD_ID and HERD_JOB are not set");
  });
});
```

- [ ] **Step 2: Run to verify failure.** FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// lib/mcp/herd-tools.ts
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
```

Match each rt-client wrapper's exact parameter list (`packages/rt-client/src/client.ts`); `herdList` takes `{ all? }`, `herdStatus` takes `{ herd }`. Spread `...herdToolDefs()` in `tools.ts`.

- [ ] **Step 4: Run.** `bun test lib/mcp`: PASS, roster 57.
- [ ] **Step 5: Commit.** `git add lib/mcp/herd-tools.ts lib/mcp/tools.ts lib/mcp/__tests__/herd-tools.test.ts lib/mcp/__tests__/tools.test.ts` then `git commit -m "mcp: shepherd herd tools and herd_milestone"`.

### Task 13: Wider `rt_verb` and the per-node cap

**Files:**
- Modify: `lib/command-tree.ts:151` (add `agentTimeoutMs?: number` beside `agentSafe`), `lib/mcp/rt-verb.ts` (use it), `lib/command-tree-def.ts` (flag 25 leaves), `lib/__tests__/agent-safe.test.ts` (pinned list)
- Test: `lib/mcp/__tests__/rt-verb.test.ts`

**Interfaces:**
- Produces: `CommandNode.agentTimeoutMs?: number` ("the rt_verb cap for a leaf whose normal run outlasts RT_VERB_TIMEOUT_MS"); `runRtVerb` spawns with `timeoutMs: leaf.node.agentTimeoutMs ?? RT_VERB_TIMEOUT_MS`.

- [ ] **Step 1: Failing test** (append to `rt-verb.test.ts`; extend the local `tree` with `slow: { description: "s", module: "./m.ts", agentSafe: true, agentTimeoutMs: 600_000, args: [{ name: "JSON", flag: "--json", type: "boolean" }] }` under `worktree.subcommands`)

```ts
test("a leaf's agentTimeoutMs replaces the default cap", async () => {
  const calls: { argv: string[]; opts: unknown }[] = [];
  await runRtVerb({ args: ["worktree", "slow"] }, deps(ok("{}"), calls));
  expect((calls[0]!.opts as { timeoutMs: number }).timeoutMs).toBe(600_000);
});
```

And replace the pinned list in `lib/__tests__/agent-safe.test.ts` with the sorted full set:

```ts
"daemon status", "endpoint lookup", "events list", "gate list", "gate subscriptions", "git branches", "git log", "git status",
"herd brief", "herd gates", "herd status", "pane list", "pane peek", "repos status", "runs find", "runs show",
"settings explain", "settings get", "settings list", "setup status", "skills bind", "skills check", "skills compile",
"skills surface", "skills sync", "skills writing-style show", "team status", "worktree await-ready", "worktree list", "worktree triage",
```

(`skills surface` is a branch with `set` under it at `lib/command-tree-def.ts:2253`; read the node: if it is a branch, flag its leaf `skills surface set` instead and pin that string.)

- [ ] **Step 2: Run to verify failure.** `bun test lib/mcp/__tests__/rt-verb.test.ts lib/__tests__/agent-safe.test.ts`: FAIL (timeout is 30000; the pinned list differs).

- [ ] **Step 3: Implement**

In `lib/command-tree.ts` after `agentSafe?: true;`:

```ts
  /** rt_verb's cap for this leaf when its normal run outlasts RT_VERB_TIMEOUT_MS. */
  agentTimeoutMs?: number;
```

In `lib/mcp/rt-verb.ts`, the spawn call: `timeoutMs: leaf.node.agentTimeoutMs ?? RT_VERB_TIMEOUT_MS,` and the timeout message uses the same value: `const cap = leaf.node.agentTimeoutMs ?? RT_VERB_TIMEOUT_MS;` before the spawn, then `if (res.code === 124) return fail(\`${verb} timed out after ${cap / 1000}s\`);`.

In `lib/command-tree-def.ts`, add `agentSafe: true,` to each leaf listed above. For each, confirm `args` contains an entry with `flag: "--json"`; where it does not (`runs show` at `:418` lacks one), add `{ name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the raw result as JSON" }` and confirm the handler honors `--json` (`commands/runs.ts:138` does). Add `agentTimeoutMs: 600_000` to `worktree await-ready`, `skills compile`, `skills sync`, `skills check`.

- [ ] **Step 4: Run.** `bun test lib/mcp/__tests__/rt-verb.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts` then `bun run picker:check`: PASS.

- [ ] **Step 5: Verify each new leaf prints JSON without a TTY.** For each of the 25 leaves run it once from source with `--json` and no TTY, e.g. `RT_BATCH=1 bun cli.ts settings list --json` and `RT_BATCH=1 bun cli.ts git branches --json`; each prints one JSON document on stdout (a read that needs a daemon may print a JSON error; that is still JSON). Any leaf that prints prose or a picker gets a JSON branch mirroring the one in `commands/runs.ts:175` before this task commits.

- [ ] **Step 6: Commit.** `git add lib/command-tree.ts lib/command-tree-def.ts lib/mcp/rt-verb.ts lib/mcp/__tests__/rt-verb.test.ts lib/__tests__/agent-safe.test.ts commands` then `git commit -m "rt_verb: widen the agent-safe set; per-leaf agentTimeoutMs cap"`.

### Task 14: PR (d) close-out

- [ ] **Step 1:** e2e list assertion gains the three worktree tools and ten herd tools; add one `tools/call rt_verb {args:["settings","list"]}` case asserting `ok`.
- [ ] **Step 2:** Build `dist/rt`; run `e2e/tests/mcp-serve.test.ts`; `bun run test`; `bunx tsc --noEmit`; `bun run picker:check`.
- [ ] **Step 3:** Commit `mcp: e2e lists the worktree and herd tools`; PR `mcp: worktree and herd tools, wider rt_verb (RT-326 d)`; merge; deploy.
- [ ] **Step 4: Smoke** from a fresh Claude Code session on the harness: `worktree_provision {ticket}` then EnterWorktree by path; `worktree_stop_holders`; `worktree_dispose` from another pane; `herd_start`, `herd_brief`, `herd_spawn` (one worker), `herd_status`, `herd_list`, `herd_attend`, `herd_close`, `herd_wrap_up`, `herd_resume`; from the worker: `herd_milestone`. `rt_verb` for `runs show`, `skills check`, `git status`.

## PR (e): relocation auto-accept on attended panes

### Task 15: Capture the dialogs and extend the parser

**Files:**
- Modify: `lib/daemon/__tests__/trust-dialog.test.ts` (two captured fixtures), `lib/daemon/trust-dialog.ts` (`BOXED_HEADING_RE`, `ENTER_ECHO_START`, and the parser's echo read)

**Interfaces:**
- Produces: `readRelocationPrompt` also parses the ExitWorktree drawing; `RelocationPrompt` gains `tool: "EnterWorktree" | "ExitWorktree"` on the `accept` variant.

- [ ] **Step 1: Capture, before touching any regex.** In a herdr pane (attended, not an `rt agent` launch), start Claude Code in a registered rt repo checkout, call `EnterWorktree` with `path` set to an rt pool tree (from `rt worktree list`). When the dialog paints, from another pane run `rt pane peek <paneId> --lines 80` and save the text verbatim. Accept it by hand. Then call `ExitWorktree` and capture again when its dialog paints (if no dialog paints, note it: ExitWorktree drops out of the hook in Task 17 and this task only adds the attended EnterWorktree fixture). Save both captures into the test file as `ATTENDED_ENTER` and `EXIT` string arrays, pasted byte for byte (box characters included), with a comment giving the Claude Code version (`claude --version`).

- [ ] **Step 2: Write the failing tests**

```ts
describe("captured attended-pane dialogs", () => {
  test("the attended EnterWorktree dialog parses to its path", () => {
    const p = readRelocationPrompt(ATTENDED_ENTER.join("\n"));
    expect(p).toMatchObject({ kind: "accept", tool: "EnterWorktree", path: "<the path in the capture>" });
  });
  test("the ExitWorktree dialog parses to its path", () => {
    const p = readRelocationPrompt(EXIT.join("\n"));
    expect(p).toMatchObject({ kind: "accept", tool: "ExitWorktree", path: "<the path in the capture>" });
  });
});
```

Replace `<the path in the capture>` with the literal path the capture shows.

- [ ] **Step 3: Run to verify failure.** `bun test lib/daemon/__tests__/trust-dialog.test.ts`: the ExitWorktree case fails (heading does not match), and every existing case passes.

- [ ] **Step 4: Widen the anchors from the capture only.** Replace the two constants with what the ExitWorktree capture shows. If the capture's heading line reads ` ExitWorktree ` and its echo starts `   Exiting worktree(`, the change is:

```ts
const BOXED_HEADING_RE = /^[│┃╎┆|] (?<tool>EnterWorktree|ExitWorktree)\s+[│┃╎┆|]\s*$/;
const ECHO_STARTS: Record<"EnterWorktree" | "ExitWorktree", string> = { EnterWorktree: "   Entering worktree(", ExitWorktree: "   Exiting worktree(" };
```

and `ruledEchoPath` tries each echo prefix, returning the tool it matched; the boxed branch reads `tool` from the heading's named group; the returned `accept` object carries `tool`. If the capture's wording differs from these guesses, use the capture's wording. `trust-accept.ts`'s `driveRelocationAccept` compares `p.path`/`p.resolvesTo` only, so it needs no change beyond the type.

- [ ] **Step 5: Run the whole file.** `bun test lib/daemon/__tests__/trust-dialog.test.ts lib/daemon/__tests__/trust-accept.test.ts`: PASS, including every spoof and painted-dialog case.
- [ ] **Step 6: Commit.** `git add lib/daemon/trust-dialog.ts lib/daemon/__tests__/trust-dialog.test.ts` then `git commit -m "trust-dialog: ExitWorktree and attended EnterWorktree captures; parser reads both drawings"`.

### Task 16: `pane:announce-relocation` in the daemon

**Files:**
- Create: `lib/daemon/relocation-announce.ts`
- Modify: `packages/rt-client/src/commands.ts` (the `Commands` entry and `COMMAND_NAMES`), `lib/daemon/handlers/pane.ts` (`createPaneHandlers` gains `relocation?: RelocationWatcher` and the handler), `lib/daemon/command-router.ts` (pass `opts.relocation`), `lib/daemon.ts` (construct the watcher beside the reconciler's `relocationAccept`)
- Test: `lib/daemon/__tests__/relocation-announce.test.ts`; `lib/daemon/__tests__/rt-client-commands.test.ts` must stay green (the handler exists even when no watcher is wired)

**Interfaces:**
- Produces, in `packages/rt-client/src/commands.ts`:

```ts
"pane:announce-relocation": {
  payload: { sessionId: string; paneId?: string; tool: "EnterWorktree" | "ExitWorktree"; path?: string; cwd: string };
  data: { scheduled: boolean; pane: string | null; reason?: "no-pane" | "herd-pane" | "disabled" | "awaiting-path" };
};
```

Name mode is two announcements: the `PreToolUse` hook's (no path; it records the session's origin and schedules nothing, because rt's `WorktreeCreate` hook still has to provision the tree, minutes on a cold create) and then `rt worktree claude-hook`'s, sent the moment the tree exists with its path (Task 17), which schedules the watch. Path mode is one announcement with the path.

- `createRelocationWatcher(deps: RelocationWatcherDeps): RelocationWatcher` where

```ts
export interface RelocationWatcherDeps {
  snapshot: () => Promise<LivePane[] | null>;
  drive: (pane: LivePane, allowed: (path: string) => boolean) => Promise<RelocationDriveOutcome>;
  isRegisteredTree: (path: string) => boolean;
  isHerdPane: (paneRef: string) => boolean;
  enabled: () => boolean;
  realpath: (p: string) => string;
  log: Pick<Logger, "info" | "warn" | "debug">;
  windowMs?: number;   // default 8000
  pollMs?: number;     // default 500
  sleep?: (ms: number) => Promise<void>;
}
export interface RelocationWatcher {
  announce(a: Commands["pane:announce-relocation"]["payload"]): Promise<Commands["pane:announce-relocation"]["data"]>;
  originFor(sessionId: string): string | undefined;
}
```

- [ ] **Step 1: Failing tests**

```ts
// lib/daemon/__tests__/relocation-announce.test.ts
import { describe, expect, test } from "bun:test";
import { createRelocationWatcher, type RelocationWatcherDeps } from "../relocation-announce.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const pane: LivePane = { paneRef: "7", sockPath: "/s", workspaceId: "w", agentStatus: "blocked", sessionId: "s1", cwd: "/repo" };
const log = { info() {}, warn() {}, debug() {} };

function watcher(over: Partial<RelocationWatcherDeps> & { outcomes?: Array<"no-dialog" | "accepted" | "unregistered" | "stuck">; seen?: Array<(p: string) => boolean> } = {}) {
  const outcomes = [...(over.outcomes ?? ["accepted"])];
  const seen: Array<(p: string) => boolean> = over.seen ?? [];
  const deps: RelocationWatcherDeps = {
    snapshot: async () => [pane],
    drive: async (_p, allowed) => { seen.push(allowed); return outcomes.shift() ?? "no-dialog"; },
    isRegisteredTree: (p) => p === "/pool/t1" || p === "/pool/t2",
    isHerdPane: () => false,
    enabled: () => true,
    realpath: (p) => p,
    log,
    windowMs: 50,
    pollMs: 5,
    sleep: async () => {},
    ...over,
  };
  return { w: createRelocationWatcher(deps), seen };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("relocation watcher", () => {
  test("schedules a watch for the pane the session id resolves to", async () => {
    const { w } = watcher();
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: true, pane: "7" });
  });
  test("no matching pane, a herd pane, or the setting off: nothing is scheduled", async () => {
    expect(await watcher({ snapshot: async () => [] }).w.announce({ sessionId: "zz", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
    expect(await watcher({ isHerdPane: () => true }).w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "herd-pane" });
    expect(await watcher({ enabled: () => false }).w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "disabled" });
  });
  test("EnterWorktree allows only the announced registered path", async () => {
    const { w, seen } = watcher();
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(seen[0]!("/pool/t1")).toBe(true);
    expect(seen[0]!("/pool/t2")).toBe(false);
    expect(seen[0]!("/elsewhere")).toBe(false);
  });
  test("EnterWorktree without a path (name mode) records the origin and schedules nothing: the tree does not exist yet", async () => {
    const { w, seen } = watcher();
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "awaiting-path" });
    await settle();
    expect(seen).toEqual([]);
    expect(w.originFor("s1")).toBe("/repo");
  });
  test("the provisioned-path announcement that follows name mode schedules the watch for that path only", async () => {
    const { w, seen } = watcher();
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" });
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t2", cwd: "/repo" })).toEqual({ scheduled: true, pane: "7" });
    await settle();
    expect(seen[0]!("/pool/t2")).toBe(true);
    expect(seen[0]!("/pool/t1")).toBe(false);
    expect(w.originFor("s1")).toBe("/repo");
  });
  test("ExitWorktree allows the session's recorded origin, which need not be registered", async () => {
    const { w, seen } = watcher({ outcomes: ["accepted", "accepted"] });
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await w.announce({ sessionId: "s1", tool: "ExitWorktree", cwd: "/pool/t1" });
    await settle();
    expect(w.originFor("s1")).toBe("/repo");
    expect(seen[1]!("/repo")).toBe(true);
    expect(seen[1]!("/pool/t2")).toBe(false);
  });
  test("polls while there is no dialog, stops on accepted, and gives up at the window", async () => {
    const a = watcher({ outcomes: ["no-dialog", "no-dialog", "accepted", "accepted"] });
    await a.w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(a.seen.length).toBe(3);
    const b = watcher({ outcomes: [], windowMs: 10 });
    await b.w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(b.seen.length).toBeGreaterThan(0);
  });
  test("an unregistered outcome stops the watch: the human answers", async () => {
    const { w, seen } = watcher({ outcomes: ["unregistered", "accepted"] });
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(seen.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test lib/daemon/__tests__/relocation-announce.test.ts`: FAIL, module missing.

- [ ] **Step 3: Implement the watcher**

```ts
// lib/daemon/relocation-announce.ts
import type { Logger } from "pino";
import type { Commands } from "../../packages/rt-client/src/commands.ts";
import { resolveLivePane, type LivePane } from "./pane-resolve-live.ts";
import type { RelocationDriveOutcome } from "./trust-accept.ts";

export interface RelocationWatcherDeps {
  snapshot: () => Promise<LivePane[] | null>;
  drive: (pane: LivePane, allowed: (path: string) => boolean) => Promise<RelocationDriveOutcome>;
  isRegisteredTree: (path: string) => boolean;
  isHerdPane: (paneRef: string) => boolean;
  enabled: () => boolean;
  realpath: (p: string) => string;
  log: Pick<Logger, "info" | "warn" | "debug">;
  windowMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Announce = Commands["pane:announce-relocation"]["payload"];
type Scheduled = Commands["pane:announce-relocation"]["data"];

export interface RelocationWatcher {
  announce(a: Announce): Promise<Scheduled>;
  originFor(sessionId: string): string | undefined;
}

// The dialog paints after the hook returns, so the watch is a short poll:
// long enough for EnterWorktree to provision and paint, short enough that a
// stale announcement cannot answer a later, unrelated dialog.
const WINDOW_MS = 8_000;
const POLL_MS = 500;

export function createRelocationWatcher(deps: RelocationWatcherDeps): RelocationWatcher {
  const origins = new Map<string, string>();
  const windowMs = deps.windowMs ?? WINDOW_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));

  const same = (a: string, b: string): boolean => {
    try { return deps.realpath(a) === deps.realpath(b); } catch { return false; }
  };

  function allowedFor(a: Announce): (path: string) => boolean {
    if (a.tool === "ExitWorktree") {
      const origin = origins.get(a.sessionId);
      return (p) => origin !== undefined && same(p, origin);
    }
    const want = a.path as string;
    return (p) => deps.isRegisteredTree(p) && same(p, want);
  }

  async function watch(pane: LivePane, allowed: (p: string) => boolean, a: Announce): Promise<void> {
    const deadline = Date.now() + windowMs;
    while (Date.now() <= deadline) {
      let outcome: RelocationDriveOutcome;
      try {
        outcome = await deps.drive(pane, allowed);
      } catch (err) {
        deps.log.warn({ err, pane: pane.paneRef }, "relocation: drive threw; leaving the dialog to the human");
        return;
      }
      if (outcome === "accepted") {
        deps.log.info({ pane: pane.paneRef, tool: a.tool, path: a.path }, "relocation: accepted an announced relocation");
        return;
      }
      if (outcome !== "no-dialog") {
        deps.log.info({ pane: pane.paneRef, outcome }, "relocation: not accepting; the human answers");
        return;
      }
      await sleep(pollMs);
    }
    deps.log.debug({ pane: pane.paneRef, tool: a.tool }, "relocation: no dialog inside the window");
  }

  return {
    originFor: (sessionId) => origins.get(sessionId),
    async announce(a) {
      // The origin is the cwd of the FIRST EnterWorktree announcement; the
      // provisioned-path one that follows in name mode has the same cwd.
      if (a.tool === "EnterWorktree" && a.path === undefined) origins.set(a.sessionId, a.cwd);
      if (a.tool === "EnterWorktree" && a.path !== undefined && !origins.has(a.sessionId)) origins.set(a.sessionId, a.cwd);
      const panes = (await deps.snapshot()) ?? [];
      const pane = resolveLivePane({ paneId: a.paneId, sessionId: a.sessionId }, panes);
      if (!pane) return { scheduled: false, pane: null, reason: "no-pane" };
      if (a.tool === "EnterWorktree" && a.path === undefined) return { scheduled: false, pane: pane.paneRef, reason: "awaiting-path" };
      if (deps.isHerdPane(pane.paneRef)) return { scheduled: false, pane: pane.paneRef, reason: "herd-pane" };
      if (!deps.enabled()) return { scheduled: false, pane: pane.paneRef, reason: "disabled" };
      void watch(pane, allowedFor(a), a);
      return { scheduled: true, pane: pane.paneRef };
    },
  };
}
```

- [ ] **Step 4: Wire the command.** In `packages/rt-client/src/commands.ts` add the `Commands` entry (above) next to `"pane:focus"` and `"pane:announce-relocation"` to `COMMAND_NAMES` after `"pane:focus"`. In `lib/daemon/handlers/pane.ts`, `createPaneHandlers` gains `relocation?: RelocationWatcher` and a handler:

```ts
"pane:announce-relocation": async (raw: unknown): Promise<CommandResult<"pane:announce-relocation">> => {
  const p = raw as Commands["pane:announce-relocation"]["payload"] | undefined;
  if (!p || typeof p.sessionId !== "string" || typeof p.cwd !== "string") return { ok: false, error: "sessionId and cwd are required" };
  if (p.tool !== "EnterWorktree" && p.tool !== "ExitWorktree") return { ok: false, error: "tool must be EnterWorktree or ExitWorktree" };
  if (p.path !== undefined && typeof p.path !== "string") return { ok: false, error: "path must be a string" };
  if (!opts.relocation) return { ok: true, data: { scheduled: false, pane: null, reason: "disabled" } };
  return { ok: true, data: await opts.relocation.announce(p) };
},
```

`buildRoutedHandlers` gains `relocation?: RelocationWatcher` and passes it to `createPaneHandlers`. In `lib/daemon.ts`, beside the reconciler wiring (`:726-760`), build the watcher once and pass it into `buildRoutedHandlers`:

```ts
const relocationWatcher = createRelocationWatcher({
  snapshot: snapshotPanes,
  drive: (pane, allowed) => {
    const paneId = pane.paneRef.startsWith("bg:") ? pane.paneRef.slice("bg:".length) : pane.paneRef;
    return driveRelocationAccept({ herdr: herdrRequest, sock: { sockPath: pane.sockPath }, pane: paneId, log, context: { paneRef: pane.paneRef, announced: true }, isRegisteredTree: allowed });
  },
  isRegisteredTree: (path) => findTreeByPath(path) !== null,
  isHerdPane: (paneRef) => { try { return herdStore.list({ status: "active" }).some((h) => herdStore.jobs(h.id).some((j) => j.pane === paneRef)); } catch { return true; } },
  enabled: () => { try { const v = getSetting<unknown>("panes.relocationAutoAccept").value; return typeof v === "boolean" ? v : true; } catch { return true; } },
  realpath: (p) => realpathSync(p),
  log,
});
```

`driveRelocationAccept`'s `isRegisteredTree` is the provenance predicate it checks before any key and on every re-read, so passing `allowed` there is what scopes the accept to the announced path.

- [ ] **Step 5: Run.** `bun test lib/daemon/__tests__/relocation-announce.test.ts lib/daemon/__tests__/rt-client-commands.test.ts lib/daemon/__tests__/trust-accept.test.ts` then `bunx tsc --noEmit`: PASS.
- [ ] **Step 6: Commit.** `git add lib/daemon/relocation-announce.ts lib/daemon/handlers/pane.ts lib/daemon/command-router.ts lib/daemon.ts packages/rt-client/src/commands.ts lib/daemon/__tests__/relocation-announce.test.ts` then `git commit -m "daemon: pane:announce-relocation drives the relocation dialog on an announced attended pane"`.

### Task 17: The hidden verb `rt worktree announce-relocation`

**Files:**
- Modify: `commands/worktree-hook.ts` (add `buildRelocationAnnouncement` and `announceRelocation`), `lib/command-tree-def.ts` (node under `worktree.subcommands`, beside `"claude-hook"` at `:1219`)
- Test: `commands/__tests__/worktree-announce-relocation.test.ts`

**Interfaces:**
- Produces: `buildRelocationAnnouncement(stdin: string, env: NodeJS.ProcessEnv): Commands["pane:announce-relocation"]["payload"] | null` (null when the hook input is not an Enter/ExitWorktree call or lacks a session id); `announceRelocation(_args: string[]): Promise<void>` reads stdin, calls `rtCommand("pane:announce-relocation", payload, { timeoutMs: 3_000 })`, prints nothing, always exits 0.
- Also: `parseHookStdin`'s `create` variant gains `sessionId?: string` (from `session_id`), and `claudeHookCommand` sends the second, path-carrying announcement right after `decideCreate` returns a path (name mode's tree now exists), before it prints the path.

- [ ] **Step 1: Failing test**

```ts
// commands/__tests__/worktree-announce-relocation.test.ts
import { describe, expect, test } from "bun:test";
import { buildRelocationAnnouncement } from "../worktree-hook.ts";

const hook = (tool: string, input: Record<string, unknown>) => JSON.stringify({ session_id: "s1", cwd: "/repo", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });

describe("buildRelocationAnnouncement", () => {
  test("EnterWorktree by path carries the path, session, cwd and pane", () => {
    expect(buildRelocationAnnouncement(hook("EnterWorktree", { path: "/pool/t1" }), { HERDR_PANE_ID: "7" } as NodeJS.ProcessEnv))
      .toEqual({ sessionId: "s1", paneId: "7", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
  });
  test("EnterWorktree by name carries no path", () => {
    expect(buildRelocationAnnouncement(hook("EnterWorktree", { name: "rt-326" }), {} as NodeJS.ProcessEnv))
      .toEqual({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" });
  });
  test("ExitWorktree carries the tool and cwd", () => {
    expect(buildRelocationAnnouncement(hook("ExitWorktree", {}), {} as NodeJS.ProcessEnv)).toEqual({ sessionId: "s1", tool: "ExitWorktree", cwd: "/repo" });
  });
  test("another tool, no session, or bad JSON is null", () => {
    expect(buildRelocationAnnouncement(hook("Bash", { command: "ls" }), {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement(JSON.stringify({ tool_name: "EnterWorktree", tool_input: {}, cwd: "/r" }), {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement("{not json", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildRelocationAnnouncement("", {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("parseHookStdin keeps the session for the provisioned-path announcement", () => {
  test("WorktreeCreate carries session_id when present", () => {
    expect(parseHookStdin(JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: "/repo", name: "rt-326", session_id: "s1" })))
      .toEqual({ event: "create", cwd: "/repo", name: "rt-326", sessionId: "s1" });
    expect(parseHookStdin(JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: "/repo", name: "rt-326" })))
      .toEqual({ event: "create", cwd: "/repo", name: "rt-326" });
  });
});
```

(`parseHookStdin` is already exported from `commands/worktree-hook.ts`; add it to the import.)

- [ ] **Step 2: Run to verify failure.** `bun test commands/__tests__/worktree-announce-relocation.test.ts`: FAIL.

- [ ] **Step 3: Implement**

In `commands/worktree-hook.ts`:

```ts
import { rtCommand } from "../packages/rt-client/src/index.ts";
import type { Commands } from "../packages/rt-client/src/index.ts";

type Announcement = Commands["pane:announce-relocation"]["payload"];

export function buildRelocationAnnouncement(stdin: string, env: NodeJS.ProcessEnv): Announcement | null {
  let hook: { session_id?: unknown; cwd?: unknown; tool_name?: unknown; tool_input?: unknown };
  try { hook = JSON.parse(stdin); } catch { return null; }
  if (!hook || typeof hook !== "object") return null;
  const tool = hook.tool_name;
  if (tool !== "EnterWorktree" && tool !== "ExitWorktree") return null;
  if (typeof hook.session_id !== "string" || typeof hook.cwd !== "string") return null;
  const out: Announcement = { sessionId: hook.session_id, tool, cwd: hook.cwd };
  if (env.HERDR_PANE_ID) out.paneId = env.HERDR_PANE_ID;
  const input = hook.tool_input;
  if (tool === "EnterWorktree" && input && typeof input === "object" && typeof (input as { path?: unknown }).path === "string") out.path = (input as { path: string }).path;
  return out;
}

// A hook that fails must never stall the pane: every path prints nothing and exits 0.
export async function announceRelocation(_args: string[]): Promise<void> {
  const stdin = process.stdin.isTTY ? "" : await Bun.stdin.text();
  const payload = buildRelocationAnnouncement(stdin, process.env);
  if (!payload) return;
  try { await rtCommand("pane:announce-relocation", payload, { timeoutMs: 3_000 }); } catch { /* the daemon being down is the human's dialog, not the hook's error */ }
}
```

In `parseHookStdin`, the create branch becomes:

```ts
if (j.hook_event_name === "WorktreeCreate" && typeof j.cwd === "string" && typeof j.name === "string") {
  return { event: "create", cwd: j.cwd, name: j.name, ...(typeof j.session_id === "string" ? { sessionId: j.session_id } : {}) };
}
```

with `ParsedStdin`'s create variant `{ event: "create"; cwd: string; name: string; sessionId?: string }`. In `claudeHookCommand`, between the `refused` check and `console.log(decision.path)`:

```ts
if (parsed.sessionId) {
  const announce: Commands["pane:announce-relocation"]["payload"] = { sessionId: parsed.sessionId, tool: "EnterWorktree", path: decision.path, cwd: parsed.cwd };
  if (process.env.HERDR_PANE_ID) announce.paneId = process.env.HERDR_PANE_ID;
  try { await rtCommand("pane:announce-relocation", announce, { timeoutMs: 3_000 }); } catch { /* same as above: the dialog falls to the human */ }
}
```

This is the announcement that schedules the watch in name mode; the tree exists at this point and Claude Code paints the dialog right after the hook prints the path, so the 8s window in Task 16 starts when it should.

Command tree node, beside `"claude-hook"`:

```ts
"announce-relocation": {
  description: "Claude Code EnterWorktree/ExitWorktree PreToolUse hook endpoint (stdin JSON in, nothing out); never call directly",
  module: "./commands/worktree-hook.ts",
  fn: "announceRelocation",
  hidden: true,
  omitBehavior: { exempt: "agent-facing; driven by Claude Code over stdin, never interactively" },
  args: [],
},
```

`lib/module-registry.ts:66` already thunks `./commands/worktree-hook.ts`; confirm with `grep -n worktree-hook lib/module-registry.ts`.

- [ ] **Step 4: Run.** `bun test commands/__tests__/worktree-announce-relocation.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/command-tree-help.test.ts` then `bun run picker:check`: PASS. Then `printf '{"session_id":"x","cwd":"/tmp","tool_name":"Bash","tool_input":{}}' | bun cli.ts worktree announce-relocation` prints nothing and exits 0.
- [ ] **Step 5: Commit.** `git add commands/worktree-hook.ts lib/command-tree-def.ts commands/__tests__/worktree-announce-relocation.test.ts` then `git commit -m "worktree: hidden announce-relocation hook verb"`.

### Task 18: PR (e) close-out

- [ ] **Step 1: Hook-to-daemon test.** Add to `e2e/tests/reconciler.test.ts` (or a new `e2e/tests/relocation-announce.test.ts` on the same harness): start the daemon, send `pane:announce-relocation` over the socket with a session id no pane has, assert `{ scheduled: false, pane: null, reason: "no-pane" }`; send with `tool: "Bash"`, assert an error. (The accept path itself needs a live herdr pane and is covered by the smoke below.)
- [ ] **Step 2:** `bun run test`; `bunx tsc --noEmit`; `bun run picker:check`; build `dist/rt` and run the e2e file.
- [ ] **Step 3:** Commit; PR `daemon: relocation auto-accept for announced attended panes (RT-326 e)`; merge; deploy (`rt daemon restart` is what makes the new command live).
- [ ] **Step 4: Smoke** needs the hook from Part B Task 26 installed in the plugin (`rt skills sync --pack mattstack` after that task merges) and a fresh Claude Code session started after both the deploy and the sync (hooks and the MCP server are read at session start): in an attended herdr pane, `EnterWorktree` by path into a pool tree, then `ExitWorktree`; neither dialog waits. Then `EnterWorktree` by name (rt's `WorktreeCreate` hook provisions; the dialog paints after the tree exists): it does not wait either. Then `EnterWorktree` to a directory outside rt's registry: the dialog waits for the person (check `rt daemon logs` for "leaving it for the human").

---

# Part B: mattstack-skills

Repo: `/Users/matt/Documents/GitHub/mattstack-skills` (branch off `main`; the repo is not rt-managed, so use `git worktree add .worktrees/mcp-tools -b mcp-tools` from the repo root, as two plain commands if the guard objects). Every task in this part follows `superpowers:writing-skills` and ends the same way; that shared tail is written once here and each task's last step points at it.

**The replacement table.** Every skill edit in Parts B and C is one of these old-to-new substitutions. "The tool" always means the mattstack MCP server's tool of that name (`mcp__plugin_mattstack_mattstack__<name>`), written in prose the way `gate_ask` and `mr_comment` already are in `attachments/gate-protocol/SKILL.md` and `attachments/review/review/SKILL.md`. `<runDb>` is the value `run_start` returned, carried in the agent's context and passed explicitly on every run call.

| Old (Bash) | New (tool call, described in prose) |
|---|---|
| `PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"` | delete the line |
| `rt runs run-start <flags> --pack-dirs "$PACK_DIRS" [--ticket <id>] [--spawned-by "<surface>"]` then `export RT_RUN_DB=<runDb>` | `run_start` with `flags` = the `{{run-start.flags}}` text verbatim, `skillDir` = this skill's directory, `ticket`, `spawnedBy`; keep `runDb` from the result |
| `rt runs stage-start --stage S` | `run_stage {runDb, action: "start", stage: "S"}` |
| `rt runs stage-done --stage S` | `run_stage {runDb, action: "done", stage: "S"}` |
| `rt runs stage-fail --stage S --reason "R" [--detail-path P]` | `run_stage {runDb, action: "fail", stage, reason, detailPath}` |
| `rt runs stage-redirect --stage S --to T --reason "R"` | `run_stage {runDb, action: "redirect", stage, to, reason}` |
| `rt runs field set K V --stage S` | `run_field_set {runDb, key, value, stage}` |
| `rt runs field get K` | `run_field_get {runDb, key}` (its `value`) |
| `rt runs decision record --contract C --scope S --selection '<JSON>' --decided-by W` | `run_decision {runDb, contract, scope, selection: <the JSON as an object>, decidedBy}` |
| `rt runs run-status --status X` then `unset RT_RUN_DB` | `run_status {runDb, status}`; delete the unset |
| `rt runs snapshot` | `run_snapshot {runDb}` |
| `rt runs --repo R --json` (the Resume listing) | `run_list {repo}` |
| `glab mr view <iid> --json ...` | `mr_view {repoName: <worktree path>, iid}` |
| `glab mr list --source-branch B` | `mr_for_branch {repoName, branches: [B]}` |
| `glab mr list ...` (other filters) | `mr_list {repoName, state}` and filter the result |
| `glab api .../merge_requests/<iid>/discussions` | `mr_threads {repoName, iid, refresh: true}` |
| `glab ci status`, `glab api .../pipelines`, `glab ci status --live` polling | `mr_pipeline {repoName, iid}` (live by default); poll it under the stage's own wait rules |
| `glab ci trace <job>`, `glab api .../jobs/<id>/trace` | `mr_job_trace {repoName, iid, jobId}` |
| `glab mr merge ...` | `mr_merge {repoName, iid, squash?, removeSourceBranch?, whenPipelineSucceeds?}` |
| `git push -u origin <branch>` | `git_push {tree, setUpstream: true}` |
| `git push --force-with-lease` | `git_push {tree, forceWithLease: true}` |
| `git push` (plain) | `git_push {tree}` |
| `git fetch origin` then `git rebase origin/<default>` | `git_rebase {tree, onto: "origin/<default>"}` (a remote-tracking `onto` fetches that remote first; a bare `git fetch` for a read stays in Bash) |
| `git rebase --abort` | `git_rebase {tree, abort: true}` |
| `cd <worktree> && rt sync --json` | `branch_sync {tree}`; exit-code table becomes the `status` field (`synced`, `conflict`) or the tool's error |
| `rt worktree provision --repo R --ticket T --json` / `--branch B` | `worktree_provision {repoName, ticket, ticketTitle}` / `{repoName, branch}`; then `EnterWorktree` with `path` = the result's `path` |
| `git worktree add <sibling-path> ...` | delete; `worktree_provision` is the only path |
| `rt worktree dispose ...` | `worktree_dispose {repoName, tree}` |
| `lsof -ti tcp:<port>` ... `kill <pid>` | `worktree_stop_holders {repoName, tree}` |
| `rt herd start/spawn/brief/close/status/list/attend/wrap-up/resume` | `herd_start`, `herd_spawn`, `herd_brief`, `herd_close`, `herd_status`, `herd_list`, `herd_attend`, `herd_wrap_up`, `herd_resume` with the same fields as flags |
| `rt herd ask/answer/report/milestone` (worker) | `herd_ask`, `herd_answer`, `herd_report`, `herd_milestone` |
| `rt gate ask --questions "$(jq -c .questions F)" --kind K --context "$(jq -r .context F)"` | Read `F` with the Read tool, then `gate_ask {questions: <its questions>, kind: "K", context: <its context>}` |
| `rt worktree list`, `rt herd status`, `rt endpoint lookup`, `rt pane peek`, `rt herd gates` (shelled) | `rt_verb {args: ["worktree", "list", ...]}` etc. (all agent-safe after Part A) |
| `rt skills check/compile/sync/bind/surface set ...` | `rt_verb {args: ["skills", "compile", "--pack", "<pack>"]}` etc. |
| frontmatter `allowed-tools: Bash(rt runs:*)`, `Bash(glab ...)`, `Bash(rt worktree provision:*)`, `Bash(rt sync:*)` | delete the entry (the tool needs no allow rule); keep `Bash(git commit:*)`-style entries and project tooling |

**Kept on Bash (do not convert):** `rt gate answer <id> --answers <json> --by shepherd` (shepherd pane only), `rt gate wait <id>`, `rt chat tail`, `rt events wait` (the three under `Monitor`), `git commit`, `git add`, `git merge-base`, `git rebase --continue` / `--skip` (after a `git_rebase` conflict), `pnpm` and pack scripts, `gh` flows. Each of the four rt calls is written in exactly that bare form, never wrapped in `cd ... &&`, `$(...)` or a pipe.

**Shared tail for every Part B task (the "certification tail"):**

1. RED first: before editing, run the target skill's scenario with a fresh subagent (`Agent` tool, general-purpose, the skill loaded by path, a glance harness worktree as cwd, the scenario from `tests/desc-test-scenarios.json` or a two-line request that reaches the changed calls) and confirm its transcript shows the Bash calls being replaced. Keep the transcript excerpt for the commit body.
2. Edit per the replacement table.
3. GREEN: repeat step 1 on the edited skill. Pass means the transcript shows the tools being called and contains no `rt runs`, `glab`, `git push`, `git rebase`, `rt herd`, `rt worktree provision`, `export RT_RUN_DB` or `unset RT_RUN_DB` Bash call; the only rt Bash calls are the kept list. A skill that still reaches for Bash is not done: fix the wording (name the tool in the sentence that used to name the command) and re-run.
4. `sh tests/certify.sh <skill-dir>` for every skill dir the task touched (`--domain` is never used in this repo): exit 0.
5. `sh tests/repo-purity.sh`: exit 0. `grep -rn "$(printf '\xe2\x80\x94')" <touched files>` finds nothing (no em dashes; likewise `\xe2\x80\x93`).
6. Bump `version` in `.claude-plugin/plugin.json` (patch bump per task, e.g. `0.21.1` to `0.21.2`) in the same commit.
7. Commit on the branch: `<area>: <what moved to tools>`.
8. After the PR merges to `main`: `rt skills sync --pack mattstack`, then confirm with `rt skills check` that the installed copy is the merged one.

### Task 19: Pipeline engines (`work`, `ship`, `watch-ci`)

**Files:**
- Modify: `attachments/pipeline/work/SKILL.md` (audit rows: `PACK_DIRS` line 33, `run-start` 54, `export RT_RUN_DB` 55, 2x `run-status`, 2x `stage-start`, `stage-done`, `stage-fail`, `stage-redirect`, 5x `field set`, 5x `decision record`, `snapshot`, the `rt runs --repo` Resume listing at 112-124, `unset RT_RUN_DB` at 105 and 181-187; frontmatter `Bash(rt runs:*)` at 6)
- Modify: `attachments/pipeline/ship/SKILL.md` (same run family: `PACK_DIRS` 47, `run-start` + `export`, `run-status`, 2x `stage-start`, `stage-done`, 4x `field set`, 2x `decision record`, `snapshot`, Resume listing; plus `git push -u origin <branch>` at 105)
- Modify: `attachments/pipeline/watch-ci/SKILL.md` (run family as above; `glab mr list --source-branch` at 78; `glab ci status --live` / `glab ci trace` at 142; `export RT_RUN_DB` 2x)
- Test: the certification tail; scenarios `work`, `ship`, `watch-ci` in `tests/desc-test-scenarios.json`

**Interfaces:**
- Consumes: the replacement table; tools from Part A.
- Produces: the three engines carry `runDb` in context from `run_start` onward; `## Resume` says "call `run_list {repo}`, pick the running run, and use its `runDb`" in place of the `RT_RUN_DB=...` re-export.

- [ ] **Step 1: RED baseline** (certification tail step 1) for each of the three; note the Bash calls seen.
- [ ] **Step 2: Rewrite the run-state passages.** In each engine, replace the `## 3` run-start block (lines 40-70 of `work/SKILL.md` and their twins) with:

```markdown
Then start the run with the `run_start` tool: `flags` is the compiled flag
text below, verbatim; `skillDir` is this skill's own directory; add `ticket`
when the request named one and `spawnedBy` when this run was spawned rather
than started interactively. Never fabricate a ticket.

{{run-start.flags}}

The result must carry `ok: true` and a `runDb`. Anything else means this rt
predates the run tools: stop and tell the user to update rt. Keep `runDb`
and pass it to every `run_*` call below; nothing is exported.
```

Then substitute every remaining `rt runs ...` command in the file per the table, keeping the surrounding sentence (e.g. "First action: `run_stage` with `action: "start"` and `stage: <stage>`"). Delete `export RT_RUN_DB`, `unset RT_RUN_DB`, the `PACK_DIRS` line, and the paragraph at `work/SKILL.md:112-124` about `RT_RUN_DB` resolution, replacing it with the `run_list` Resume sentence above. Delete `Bash(rt runs:*)` from `allowed-tools`.
- [ ] **Step 3: Forge calls.** `ship/SKILL.md:105`: "Push with `git_push` (`tree` = this worktree, `setUpstream: true`), then create the MR with `mr_create` ...". `watch-ci/SKILL.md:78`: `mr_for_branch`; `:142`: "poll `mr_pipeline` (live) until the pipeline settles, then `mr_job_trace` for each failed job".
- [ ] **Step 4: GREEN, certify, purity, bump, commit** (tail steps 3-7). Commit: `pipeline engines: run state and forge calls through the MCP tools`.

### Task 20: Pipeline stages (`stage-provision` ... `stage-watch-ci`)

**Files:**
- Modify: `attachments/pipeline/stage-provision/SKILL.md` (run family; `rt worktree provision --repo <repo> --ticket <ticket> --json` at 45 and the `ok:` branch at 49, Resume at 84; `allowed-tools: Bash(rt worktree provision:*)` at 8), `stage-plan`, `stage-implement`, `stage-self-review`, `stage-gates`, `stage-evidence`, `stage-ship` (`git push` at its ship step), `stage-watch-ci` (`glab ci status`, `glab ci trace`) under `attachments/pipeline/`
- Test: certification tail; the `work` scenario (stages are reached through the engine)

**Interfaces:**
- Consumes: the engine passes `runDb` into each stage's context (Task 19's engines say so at the stage hand-off: add one sentence "Each stage receives `runDb` and passes it on every `run_*` call" in `work/SKILL.md`'s `## 4` if Task 19 did not).

- [ ] **Step 1: RED** on `stage-provision` and `stage-watch-ci` (the two with forge calls).
- [ ] **Step 2: Run state.** In every stage, the `## Run state` block becomes:

```markdown
- First action: `run_stage` with `action: "start"`, `stage: "<stage>"` and the run's `runDb`.
- Read consumed fields with `run_field_get` before deriving or asking for them.
- Write each declared produce the moment it exists with `run_field_set` (`key`, `value`, `stage: "<stage>"`).
- Last action on success: `run_stage` with `action: "done"`; on failure `run_stage` with `action: "fail"` and a `reason` naming what actually failed, before you report it.
```

Substitute the remaining `rt runs decision record` and `rt runs field` calls per the table.
- [ ] **Step 3: Provision.** `stage-provision/SKILL.md:45-49`: "Call `worktree_provision` with `repoName` (the repo's checkout path) and `ticket` (plus `ticketTitle` when known). On `ok`: `EnterWorktree` with `path` set to the result's `path`; write `branch` and `worktree` with `run_field_set`." Resume at 84 unchanged except the field writes. Delete the `allowed-tools` line.
- [ ] **Step 4: Ship and watch-ci stages.** `stage-ship`: `git_push {tree, setUpstream: true}`; `stage-watch-ci`: `mr_pipeline` and `mr_job_trace` as in Task 19.
- [ ] **Step 5: GREEN (via a `work` run on the harness), certify all nine stage dirs, purity, bump, commit** `pipeline stages: run state, provision and forge calls through the MCP tools`.

### Task 21: Review verbs (`review`, `self-review`, `receive-review`) and `review-posting`

**Files:**
- Modify: `attachments/review/review/SKILL.md` (run family incl. `export RT_RUN_DB` 2x; `glab mr view`, `glab mr diff`; `rt gate ask --questions "$(jq ...)"` at 195 and the `--kind review-post` at 206), `attachments/review/self-review/SKILL.md` (run family; `git merge-base` stays), `attachments/review/receive-review/SKILL.md` (run family; `glab api` 2x; `git push`; `rt gate ask` with jq at 277 and 476; `rt gate answer` stays), `attachments/review-posting/SKILL.md` (`glab mr view`)
- Test: certification tail; scenarios `review`, `self-review`, `receive-review`

- [ ] **Step 1: RED** on all three.
- [ ] **Step 2: Run family** per Task 19's wording (`run_start` ... `run_status`; delete export/unset).
- [ ] **Step 3: Forge reads.** `review`: `mr_view` for the MR, and for the diff keep `git` reads in Bash (`git diff <base>...<head>` needs no rule); `receive-review`: the two `glab api` discussion reads become one `mr_threads {refresh: true}` (this is the thread-fetch step the spec says it never had: put it before the respond-plan gate); `review-posting`: `mr_view`.
- [ ] **Step 4: Gates.** Each `rt gate ask --questions "$(jq -c .questions F)" --kind K --context "$(jq -r .context F)"` becomes: "Read `F`; call `gate_ask` with its `questions` array, `kind: "K"` and its `context`; act on the returned presentation as `gate-protocol` says." The `rt gate answer ... --by pane` line after a form stays as `gate_answer`. Push in `receive-review` becomes `git_push {tree}`.
- [ ] **Step 5: GREEN, certify the four dirs, purity, bump, commit** `review verbs: run state, thread fetch and gates through the MCP tools`.

### Task 22: Forge verbs (`checkout`, `rebase-worktree`, `sync-open-mrs`, `map-open-mrs`) and `gate-protocol`, `run-identity`

**Files:**
- Modify: `attachments/forge/checkout/SKILL.md` (`git fetch` + `git worktree add <sibling>` fallback: delete; `glab mr list`, `glab mr view`; `rt worktree provision ... --json` at 60; 2x `decision record`, 2x `field set`), `attachments/forge/rebase-worktree/SKILL.md` (`cd <worktree> && rt sync --json` at 63 and the exit-code table at 65-85; `git fetch`/`git rebase`/`git rebase --abort`/`git push --force-with-lease` manual path at 85-160; `glab mr list/view`, `glab repo view`; 3x `decision record`, 3x `field set`; frontmatter allow rules 11-16), `attachments/forge/sync-open-mrs/SKILL.md` (run family incl. `export RT_RUN_DB` 2x; `git push --force-with-lease` at 123), `attachments/forge/map-open-mrs/SKILL.md` (`glab mr list`; `rt worktree list` shelled), `attachments/gate-protocol/SKILL.md` (`rt gate ask` 2x, `rt runs decision record`, 3x `field set`; `rt gate answer` and `rt gate wait` stay), `attachments/run-identity/SKILL.md` (`rt runs field set`)
- Test: certification tail; scenarios `rebase-worktree`, `sync-open-mrs`

- [ ] **Step 1: RED** on `rebase-worktree` and `sync-open-mrs`.
- [ ] **Step 2: rebase-worktree.** The fast path becomes "call `branch_sync {tree}`"; the exit-code table becomes a two-row table on the result: `status: "synced"` (report the move; the push already happened) and `status: "conflict"` (the bundle; go to the conflict section). The tool's error text replaces exit 4's refusal row. The manual path (85-160) becomes `git_rebase {tree, onto: "origin/<default>"}` then, on `status: "conflict"`, the same conflict gate; `abort` is `git_rebase {abort: true}`, `--continue` stays Bash; the push is `git_push {tree, forceWithLease: true}`. The default branch comes from `mr_view`'s `targetBranch` or `git symbolic-ref` in Bash (a read). Delete allow rules 11-16.
- [ ] **Step 3: checkout.** `worktree_provision {repoName, branch}` replaces line 60; delete the sibling `git worktree add` fallback and its `git fetch`; `glab mr list/view` become `mr_for_branch` / `mr_view`.
- [ ] **Step 4: sync-open-mrs, map-open-mrs, gate-protocol, run-identity** per the table (`git_push {forceWithLease: true}`; `mr_list`; `rt_verb {args: ["worktree","list"]}`; `gate_ask`; `run_decision`; `run_field_set`).
- [ ] **Step 5: GREEN, certify the six dirs, purity, bump, commit** `forge verbs and gate protocol: branch_sync, git and worktree tools`.

### Task 23: Shepherdr (source and compiled copy)

**Files:**
- Modify: `attachments/orchestration/shepherdr/SKILL.md` (`rt herd *` 20 calls; `rt worktree provision` at 236; `rt endpoint lookup`, `rt pane peek`, `rt chat dm` reads; `lsof`/`kill` at 481-486 and 528; the trust-modal step at 418; every `cloud-lane` mention), `attachments/orchestration/shepherdr/references/job-template.md` (`rt herd ask/answer/report/milestone`, `rt runs run-start`, `rt chat dm`), `skills/shepherdr/SKILL.md` and `skills/shepherdr/references/job-template.md` (the compiled copies: same edits, or recompile if the compiler regenerates them: check `git log -1 -- skills/shepherdr/SKILL.md` and the `compiled-from` marker)
- Delete: `attachments/orchestration/shepherdr/references/cloud-lane.md`, `skills/shepherdr/references/cloud-lane.md`
- Test: certification tail; scenario `shepherdr`

- [ ] **Step 1: RED** on `shepherdr` (spawn one worker on the harness).
- [ ] **Step 2: Herd calls** per the table; `rt gate answer <gate-id> --answers '<json>' --by shepherd` at 311 stays and its note at 315 stays.
- [ ] **Step 3: Cloud lane.** Delete both `cloud-lane.md`; remove every sentence that points at it (`grep -n "cloud" attachments/orchestration/shepherdr/SKILL.md skills/shepherdr/SKILL.md` must return nothing afterwards).
- [ ] **Step 4: Wrap-up kill step** (481-486, 528): replace with "call `worktree_stop_holders {repoName, tree}` for each job's tree; it ends only the processes rt tied to that tree. There is no general kill." Delete the `lsof`/`pkill` guidance.
- [ ] **Step 5: Trust-modal step** (418): it names what to run or is cut. The daemon watchdog accepts the trust modal and the relocation dialog for worker panes on its own (`lib/daemon/herd-watchdog.ts`), so the step becomes: "The watchdog accepts a worker's trust and relocation dialogs itself and parks a job that stays stuck (`stuck-at-modal` in `herd_status`). For a parked job: `herd_attend` it, answer the dialog by hand, or `herd_close` and re-spawn."
- [ ] **Step 6: Worker brief.** `job-template.md` names `herd_ask`, `herd_answer`, `herd_report`, `herd_milestone` and `run_start` in place of the `rt herd ...` / `rt runs run-start` commands; `rt chat dm` stays (chat).
- [ ] **Step 7: GREEN, certify `attachments/orchestration/shepherdr` and `skills/shepherdr`, purity, bump, commit** `shepherdr: herd tools, stop-holders wrap-up, cloud lane removed`.

### Task 24: Plugin skills (`editing-skills`, `extending-a-pack`, `creating-a-pack`)

**Files:**
- Modify: `plugin/skills/editing-skills/SKILL.md` (`rt skills bind/check/compile/surface set`, 3x `rt skills sync`), `plugin/skills/extending-a-pack/SKILL.md` (`rt skills bind/check/compile/composition/packs/surface set`; code blocks with trailing `# ...` comments), `plugin/skills/creating-a-pack/SKILL.md` (`rt skills init`, `rt setup pack`, `rt team create`, `rt daemon status`, `git push`)
- Test: certification tail

- [ ] **Step 1: RED** on `extending-a-pack`.
- [ ] **Step 2:** `rt skills check/compile/sync/bind/surface set` become `rt_verb` calls (e.g. `rt_verb {args: ["skills", "sync", "--pack", "<pack>"]}`); `rt skills composition`, `rt skills packs`, `rt skills init`, `rt setup pack`, `rt team create`, `rt daemon status` are one-time setup, not routine: `daemon status` becomes `rt_verb`, the rest stay Bash and are noted as "asks once". `git push` in `creating-a-pack` becomes `git_push {tree, setUpstream: true}`.
- [ ] **Step 3: Pasted comments.** In `extending-a-pack`, every fenced code block loses its trailing `# ...` comments (move the explanation to the sentence above the block).
- [ ] **Step 4: GREEN, certify the three dirs, purity, bump, commit** `plugin skills: rt skills verbs through rt_verb; no pasted comments`.

### Task 25: The `execution-strategy`, `parameterized-skills` and `wrap-up` mentions

**Files:**
- Modify: `attachments/execution-strategy/SKILL.md` (`rt herd brief`), `attachments/parameterized-skills/references/convention.md` (the `rt skills compile` mention: `rt_verb`), `skills/wrap-up/SKILL.md` and `attachments/wrap-up-form/SKILL.md` (any `rt worktree dispose` or `rt herd wrap-up` wording: `worktree_dispose`, `herd_wrap_up`)
- Test: certification tail

- [ ] **Step 1:** `grep -rn "rt herd\|rt worktree\|rt skills\|rt runs\|glab\|git push" attachments/execution-strategy attachments/parameterized-skills attachments/wrap-up-form skills/wrap-up` and substitute each hit per the table.
- [ ] **Step 2: GREEN on `wrap-up`, certify, purity, bump, commit** `wrap-up and strategy parts: tool names`.

### Task 26: Hooks: the relocation announce hook and the doorbell

**Files:**
- Create: `hooks/relocation-announce.sh`
- Modify: `hooks/hooks.json`
- Test: `tests/test-relocation-hook.sh` (new, modeled on `tests/test-gate-stop-hook.sh`)

**Interfaces:**
- Consumes: `rt worktree announce-relocation` (Task 17) reading the hook's stdin.
- Produces: a `PreToolUse` entry with `"matcher": "EnterWorktree|ExitWorktree"` running the script with `"timeout": 5`.

- [ ] **Step 1: Failing test.** `tests/test-relocation-hook.sh`: runs the script with a fake `rt` on `PATH` (a shell script that records its argv and stdin to a temp file and exits 0) and asserts: (a) the script exits 0 and prints nothing; (b) the fake rt was called with `worktree announce-relocation` and received the stdin JSON; (c) with no `rt` on `PATH` and no `~/.local/bin/rt` the script still exits 0. Run: `sh tests/test-relocation-hook.sh`: FAIL, script missing.
- [ ] **Step 2: Implement**

```sh
#!/bin/sh
# PreToolUse hook on EnterWorktree and ExitWorktree: hands the hook's stdin
# to rt so the daemon can answer the relocation dialog on this pane. Every
# path exits 0 and prints nothing; a missing rt or daemon is the human's
# dialog, never a blocked tool call.
set -u
: "${HOME:=}"
INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0
RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0
printf '%s' "$INPUT" | "$RT" worktree announce-relocation >/dev/null 2>&1 || true
exit 0
```

In `hooks/hooks.json`, add to the `PreToolUse` array:

```json
{
  "matcher": "EnterWorktree|ExitWorktree",
  "hooks": [
    { "type": "command", "command": "sh \"${CLAUDE_PLUGIN_ROOT}/hooks/relocation-announce.sh\"", "timeout": 5 }
  ]
}
```

- [ ] **Step 3: Doorbell.** `hooks/herdr-doorbell.sh` says it is "Wired as a PreToolUse hook on AskUserQuestion" but `hooks.json` does not register it. Decide by reading it against `lib/agent-hooks.ts` in rt (which injects its own AskUserQuestion hook, `gate-fork.sh`, on every `rt agent` launch): if the doorbell duplicates the fork-check's job, delete `hooks/herdr-doorbell.sh` and any reference to it; otherwise register it under `PreToolUse` with `"matcher": "AskUserQuestion"`. Record the choice in the commit body.
- [ ] **Step 4: Run** `sh tests/test-relocation-hook.sh` and `sh tests/test-gate-stop-hook.sh`: both exit 0. `bun run` the plugin contract test if one exists for hooks (`grep -rn hooks.json tests`).
- [ ] **Step 5: Bump, commit** `hooks: announce EnterWorktree/ExitWorktree to rt; doorbell resolved`.

### Task 27: Audit re-run, version, PR, sync

**Files:**
- Modify: `.claude-plugin/plugin.json` (final minor bump, e.g. to `0.22.0`), `CERTIFICATION.md` ledger rows for every skill certified in Tasks 19-26

- [ ] **Step 1: Audit re-run.** Re-run the three audit agents' scan over the branch: `grep -rnE "^\s*(rt (runs|herd|worktree provision|worktree dispose|sync|gate ask|skills (check|compile|sync|bind))|glab |git push|git rebase|git worktree add|export RT_RUN_DB|unset RT_RUN_DB|lsof)" attachments skills plugin hooks --include='*.md'` (single command; quote the glob). Every hit must be on the kept list (`rt gate answer ... --by shepherd`, `rt gate wait`, `git rebase --continue|--skip`) or in prose explaining the tool that replaced it. Fix any other hit in the task that owns the file, then re-run.
- [ ] **Step 2: Shell state.** `grep -rn '\$IID\|\$PACK_DIRS\|read_token\|\$RT_RUN_DB' attachments skills plugin` returns nothing.
- [ ] **Step 3:** `sh tests/repo-purity.sh`; `sh tests/certify.sh` for each touched dir; `bun run desc-test` (the description selection matrix) passes at its prior rate.
- [ ] **Step 4:** Ledger rows in `CERTIFICATION.md`; commit `certification: RT-326 rewrite ledger`; open the PR `skills run on MCP tools, not Bash (RT-326)`; merge on green.
- [ ] **Step 5:** `rt skills sync --pack mattstack`; `rt skills check` shows the new version installed. Then run Task 18 step 4's relocation smoke (it needs this hook installed).

---

# Part C: the claimview pack

Pack: `/Users/matt/.mattstack/teams/claimview/mattstack/packs/claimview`, inside the team repo `/Users/matt/.mattstack/teams/claimview` (origin `claimview-tools` on GitLab). Constraints: no mattstack ticket ids in any file or commit message there; the repo auto-commits and pushes dirty files on `main`, so work in a worktree. `.worktrees/` is git-ignored in that repo.

### Task 28: Branch the team repo and inventory the pack

- [ ] **Step 1:** From `/Users/matt/.mattstack/teams/claimview`: `git worktree add .worktrees/mcp-tools -b mcp-tools` (one plain command). All Part C edits happen under `/Users/matt/.mattstack/teams/claimview/.worktrees/mcp-tools/mattstack/packs/claimview`.
- [ ] **Step 2:** Record the pack-authored call inventory (origin `pack-fill` in `audit-claimview.tsv`), which is the edit list for Task 29:

| file | calls |
|---|---|
| `PACK.md` | `rt skills compile`, `rt skills materialize` |
| `attachments/board-doctor/SKILL.md` | `git fetch`, 2x `git rebase --continue` (stays), `glab mr list`, `glab mr view` |
| `attachments/board-doctor-api/SKILL.md` | `glab api`, `glab ci status`, `glab mr list`, `glab mr view` |
| `attachments/board-review/SKILL.md` | `glab mr view` |
| `attachments/capture-evidence/SKILL.md` + `resolve-target.py` | `glab mr list/view`, `rt endpoint lookup` (shelled, also from python), `rt settings set`, `lsof` (a read: stays) |
| `attachments/cvi-gates/SKILL.md` | `git worktree add`, `rt runs field get` |
| `attachments/dev-servers/SKILL.md` | 3x `rt endpoint lookup`, `rt worktree list`, `rt intercept install/status`, `rt sdm connect`, `rt verify`, `lsof` |
| `attachments/provision/SKILL.md` | 5x `rt worktree provision` |
| `attachments/receive-review/SKILL.md`, `review-criteria`, `self-review`, `skills/review/SKILL.md` | `git fetch` (a read: stays), `glab mr list` |
| `attachments/shepherdr-domain/SKILL.md`, `skills/shepherdr/SKILL.md` | `rt herd attend/gates/spawn/status/wrap-up`, `rt worktree dispose/provision` |
| `attachments/ship-domain/SKILL.md` + `preflight-checks.md`, `skills/ship/**` | `git fetch`, `git push`, `git push --force-with-lease`, `glab mr list` |
| `attachments/stage-*` and `attachments/work-provision`, `work-policy` | `rt runs field set/get`, `rt worktree provision`, `git worktree add`, `glab api/mr list/view`, `git push` (these are compiled outputs; their fills above are the source) |
| `attachments/watch-ci-domain/SKILL.md`, `skills/watch-ci/SKILL.md` | `glab api`, 2x `glab mr list`, `glab mr view` |
| `skills/context/SKILL.md` | `rt worktree provision` |

### Task 29: Rewrite the fills and hand-authored skills

**Files:**
- Modify: every fill and hand-authored skill in the Task 28 table (`attachments/{board-doctor,board-doctor-api,board-review,capture-evidence,cvi-gates,dev-servers,provision,receive-review,review-criteria,self-review,shepherdr-domain,ship-domain,watch-ci-domain,work-provision,work-policy}/`, `skills/context/SKILL.md`, `PACK.md`); the compiled `attachments/stage-*`, `attachments/checkout*`, `attachments/map-open-mrs`, `attachments/sync-open-mrs` and `skills/{work,review,ship,watch-ci,rebase-worktree,shepherdr}` are regenerated in Task 30, not edited by hand
- Test: certification tail adapted: RED/GREEN with the pack's `work` verb on the harness repo registered under the claimview team (or a claimview worktree Matt names); `sh /Users/matt/Documents/GitHub/mattstack-skills/tests/certify.sh <dir> --domain` (domain mode: purity greps skipped, structure checked)

- [ ] **Step 1: RED** on `skills/ship` and `skills/shepherdr` (the two with git writes and herd calls).
- [ ] **Step 2: Substitute per the Part B replacement table** in each fill: `rt worktree provision` to `worktree_provision`; `rt worktree dispose` to `worktree_dispose`; `rt herd *` to `herd_*`; `glab mr list/view`, `glab api`, `glab ci status` to `mr_list`/`mr_for_branch`/`mr_view`/`mr_threads`/`mr_pipeline`; `git push` forms to `git_push`; `rt runs field set/get` to `run_field_set`/`run_field_get`; `rt endpoint lookup`, `rt worktree list` to `rt_verb`; `git worktree add` (in `cvi-gates`) deleted in favour of `worktree_provision`. `rt intercept`, `rt sdm connect`, `rt verify`, `rt settings set`, `lsof` reads and `git fetch` stay (project tooling and reads). `resolve-target.py`'s `rt endpoint lookup` subprocess stays (a script, not an agent call). `PACK.md`'s `rt skills compile/materialize` become `rt_verb` examples.
- [ ] **Step 3: Employer check.** `grep -rnE "RT-[0-9]+|SKILLS-[0-9]+|mattstack ticket" .` inside the pack returns nothing.
- [ ] **Step 4: Commit on the branch** (no ticket id): `claimview pack: forge, worktree, herd and run calls through the mattstack MCP tools`.

### Task 30: Recompile, certify, bump, MR, sync

- [ ] **Step 1: Recompile** from the worktree's pack root: `rt skills compile --pack claimview --manifest <the worktree's mattstack/skills.jsonc if the manifest lives in the repo, else the per-repo manifest rt skills compile auto-finds>`; the compiled `skills/*` and `attachments/stage-*` regenerate from the mattstack-skills version installed in Task 27 plus the fills from Task 29.
- [ ] **Step 2: Audit re-run** over the pack: the Task 27 grep, run inside the pack directory. Every hit is on the kept list or prose.
- [ ] **Step 3: GREEN** on `work`, `ship`, `watch-ci`, `shepherdr` (one worker) against the claimview harness. `certify.sh --domain` on every touched dir exits 0.
- [ ] **Step 4:** Bump `version` in `.claude-plugin/plugin.json` (`0.5.64` to `0.6.0`); commit `claimview pack: recompile on mattstack 0.22; version 0.6.0`.
- [ ] **Step 5: Publish through the team zone, not an MR.** Pack changes reach `claimview-tools` only through the team zone's auto-snapshot of `main`; nothing here writes to that employer project directly. From `/Users/matt/.mattstack/teams/claimview` (on `main`): `git merge --ff-only mcp-tools` (one command); the auto-snapshot commits and pushes it. Then `rt skills sync --pack claimview`; `rt skills check` shows 0.6.0. Remove the worktree: `git worktree remove .worktrees/mcp-tools` and `git branch -d mcp-tools`. An MR on `claimview-tools` is never opened by an agent for this work; if one is wanted, Matt says so explicitly and opens or authorizes it himself.

---

# Part E: pack authoring

Spec section "Pack authoring": a generated tool list, a lint in `rt skills check` (advisory unless `--strict`), and an advisory LLM audit. rt work first (Tasks 31-33, one PR), then mattstack-skills (Tasks 34-35, certification tail). The lint lands after the Part B and C rewrites so its first run on both packs is clean.

### Task 31: `rt mcp tools --json`

**Files:**
- Modify: `commands/mcp.ts` (add `mcpToolsPayload` and `mcpToolsList`), `lib/command-tree-def.ts:1476-1489` (a `tools` leaf under `mcp.subcommands`)
- Test: `commands/__tests__/mcp-tools-list.test.ts`

**Interfaces:**
- Produces: `mcpToolsPayload(tools: McpToolDef[] = mcpTools()): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }` and `mcpToolsList(args: string[]): Promise<void>` (prints the payload as JSON under `--json`, else one `name` per line). Tasks 33 and 34 read the JSON.
- `./commands/mcp.ts` is already thunked in `lib/module-registry.ts`; no registry change.

- [ ] **Step 1: Failing test**

```ts
// commands/__tests__/mcp-tools-list.test.ts
import { describe, expect, test } from "bun:test";
import { mcpToolsPayload } from "../mcp.ts";
import { mcpTools } from "../../lib/mcp/tools.ts";

describe("mcpToolsPayload", () => {
  test("carries every roster tool with its description and schema, in roster order", () => {
    const roster = mcpTools();
    const payload = mcpToolsPayload(roster);
    expect(payload.tools.map((t) => t.name)).toEqual(roster.map((t) => t.name));
    for (const [i, t] of payload.tools.entries()) {
      expect(t.description).toBe(roster[i]!.description);
      expect(t.inputSchema).toEqual(roster[i]!.inputSchema);
      expect(Object.keys(t)).toEqual(["name", "description", "inputSchema"]);
    }
  });
  test("is plain JSON (no handlers, no functions)", () => {
    const text = JSON.stringify(mcpToolsPayload());
    expect(JSON.parse(text).tools.length).toBe(mcpTools().length);
    expect(text).not.toContain("handler");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test commands/__tests__/mcp-tools-list.test.ts`: FAIL, no `mcpToolsPayload`.

- [ ] **Step 3: Implement.** In `commands/mcp.ts` (a static import of `lib/mcp/tools.ts` here is fine: `mcpServe` already imports it dynamically, and this module is itself lazy behind the registry thunk):

```ts
import { mcpTools, type McpToolDef } from "../lib/mcp/tools.ts";

export function mcpToolsPayload(tools: McpToolDef[] = mcpTools()): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } {
  return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
}

export async function mcpToolsList(args: string[]): Promise<void> {
  const payload = mcpToolsPayload();
  if (args.includes("--json")) { console.log(JSON.stringify(payload)); return; }
  for (const t of payload.tools) console.log(t.name);
}
```

Check `lib/__tests__/no-eager-tui.test.ts` still passes (it pins that `lib/command-tree.ts` and the registry do not eagerly import command modules; `commands/mcp.ts` importing `lib/mcp/tools.ts` statically is inside a thunked module).

Tree node, beside `serve`:

```ts
tools: {
  description: "Every tool the mattstack MCP server publishes: name, description, input schema (the source the docs and the skills reference are generated from)",
  module: "./commands/mcp.ts",
  fn: "mcpToolsList",
  hidden: true,
  omitBehavior: { exempt: "no positional argument; a listing" },
  args: [{ name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Print the full roster as JSON" }],
},
```

- [ ] **Step 4: Run.** `bun test commands/__tests__/mcp-tools-list.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/command-tree-help.test.ts` then `bun run picker:check`: PASS. `bun cli.ts mcp tools --json` prints one JSON document whose `tools` has 57 entries.
- [ ] **Step 5: Commit.** `git add commands/mcp.ts lib/command-tree-def.ts commands/__tests__/mcp-tools-list.test.ts` then `git commit -m "mcp: hidden rt mcp tools --json prints the roster"`.

### Task 32: The `rt skills check` lint and `--strict`

**Files:**
- Create: `lib/skills/mcp-lint.ts`
- Modify: `commands/skills.ts` (`Flags.strict`, `parseFlags`, `CheckPayload.mcpLint`, `computeCheck`, `skillsCheck` output, `checkPack`'s options), `lib/command-tree-def.ts:2221` (`check` gains `--strict`), `lib/skills/sync.ts` (`checkPack` returns `lintHits`; the recheck step fails on hits), `commands/skills-sync.ts:107-110`
- Test: `lib/skills/__tests__/mcp-lint.test.ts`; `lib/skills/__tests__/sync.test.ts` (one new case)

**Interfaces:**
- Produces, in `lib/skills/mcp-lint.ts`:

```ts
export interface LintRule { id: string; pattern: RegExp; tool: string; note: string }
export interface LintHit { file: string; line: number; text: string; rule: string; tool: string; note: string }
export const MCP_LINT_RULES: LintRule[];
export const KEPT_ON_BASH: RegExp[];
export function lintSkillText(text: string, file: string): LintHit[];
export function lintPackDir(dir: string, deps?: { list: (dir: string) => string[]; read: (path: string) => string }): LintHit[];
export function formatHit(h: LintHit): string;   // "<file>:<line>: `<text>` shells out for <rule>; use the <tool> tool (<note>)"
```

- `CheckPayload.mcpLint: LintHit[]` and `CheckPayload.strictLint: boolean` (true for the `mattstack` pack, or when the resolved manifest carries `"strictLint": true`); `checkPack(opts & { strict?: boolean })`; `SyncDeps.checkPack: (packName) => Promise<{ drift: boolean; lintHits: number; strict: boolean }>`.
- The allow marker: a line carrying `<!-- mcp-lint: allow -->`, or a code line whose previous line is only that marker, is never a hit (a "never hand-build a `glab api` call" warning, `the glab CLI (authenticated)` in a requirements list).

- [ ] **Step 1: Failing tests**

```ts
// lib/skills/__tests__/mcp-lint.test.ts
import { describe, expect, test } from "bun:test";
import { KEPT_ON_BASH, lintPackDir, lintSkillText, MCP_LINT_RULES } from "../mcp-lint.ts";

const md = (...lines: string[]) => lines.join("\n");

describe("lintSkillText: one hit per rule", () => {
  const cases: Array<[string, string, string]> = [
    ["rt-runs", "```bash\nrt runs stage-start --stage plan\n```", "run_stage"],
    ["glab", "Run `glab mr view 12 --json`.", "mr_view"],
    ["git-push", "```sh\ngit push -u origin feat/x\n```", "git_push"],
    ["git-rebase", "then `git rebase origin/main`", "git_rebase"],
    ["git-pull", "`git pull` first", "git_pull"],
    ["rt-herd", "```\nrt herd spawn --job a\n```", "herd_spawn"],
    ["rt-worktree", "`rt worktree provision --repo x --ticket T-1`", "worktree_provision"],
    ["rt-sync", "```bash\ncd <tree> && rt sync --json\n```", "branch_sync"],
    ["run-db-env", "```\nexport RT_RUN_DB=/x\n```", "run_start"],
    ["subst", "```bash\nIID=$(glab mr list --json | jq .[0].iid)\n```", "mr_for_branch"],
    ["worktree-add", "`git worktree add ../sibling feat/x`", "worktree_provision"],
    ["gate-ask", "```\nrt gate ask --questions \"$(jq -c .questions f)\"\n```", "gate_ask"],
    ["pkill", "`pkill -f <path>` then `kill $PID`", "worktree_stop_holders"],
  ];
  for (const [rule, text, tool] of cases) {
    test(`${rule} hits and names ${tool}`, () => {
      const hits = lintSkillText(text, "a/SKILL.md");
      expect(hits.length, text).toBeGreaterThan(0);
      expect(hits[0]!.rule).toBe(rule);
      expect(hits.map((h) => h.tool)).toContain(tool);
      expect(hits[0]!.file).toBe("a/SKILL.md");
      expect(hits[0]!.line).toBeGreaterThan(0);
    });
  }
  test("every rule in MCP_LINT_RULES has a case above", () => {
    expect(MCP_LINT_RULES.map((r) => r.id).sort()).toEqual(cases.map((c) => c[0]).sort());
  });
});

describe("lintSkillText: no hits", () => {
  test("the kept-on-Bash list", () => {
    const kept = md(
      "```bash", "rt gate answer <id> --answers '<json>' --by shepherd", "rt gate wait <id>", "rt chat tail", "rt events wait 'run:*'",
      "git rebase --continue", "git rebase --skip", "git commit -m x", "git add -A", "git fetch origin", "git merge-base HEAD origin/main", "```",
    );
    expect(lintSkillText(kept, "k.md")).toEqual([]);
    expect(KEPT_ON_BASH.length).toBeGreaterThan(0);
  });
  test("prose that names a tool", () => {
    const prose = md(
      "Push with the `git_push` tool (`tree`, `setUpstream: true`).",
      "Start the run with `run_start`; keep its `runDb`.",
      "Call `rt_verb` with args [\"herd\", \"status\"].",
      "Merge with `mr_merge`; GitLab still enforces approvals.",
      "Provision with `worktree_provision`, then EnterWorktree by path.",
    );
    expect(lintSkillText(prose, "p.md")).toEqual([]);
  });
  test("plain prose outside code is not linted (the audit covers it)", () => {
    expect(lintSkillText("Then push the branch and open the MR.", "p.md")).toEqual([]);
  });
  test("the allow marker excuses its own line and the code line under a marker-only line", () => {
    const allowed = md(
      "Never hand-build a `glab api` call. <!-- mcp-lint: allow -->",
      "- the `glab` CLI (authenticated) <!-- mcp-lint: allow -->",
      "<!-- mcp-lint: allow -->",
      "`git push --force` is what this guard exists to stop.",
      "```bash",
      "<!-- mcp-lint: allow -->",
      "git rebase -i HEAD~3",
      "```",
    );
    expect(lintSkillText(allowed, "a.md")).toEqual([]);
  });
  test("the marker excuses one line only, never the rest of a block", () => {
    const partly = md("```bash", "<!-- mcp-lint: allow -->", "git push", "git rebase origin/main", "```");
    const hits = lintSkillText(partly, "a.md");
    expect(hits.map((h) => h.rule)).toEqual(["git-rebase"]);
  });
});

describe("lintPackDir", () => {
  test("walks skills, attachments and plugin/skills markdown only", () => {
    const files: Record<string, string> = {
      "/p/skills/work/SKILL.md": "```\nrt runs snapshot\n```",
      "/p/attachments/fill/SKILL.md": "`glab mr view 1`",
      "/p/plugin/skills/x/SKILL.md": "`git push`",
      "/p/README.md": "`git push`",
      "/p/skills/work/notes.txt": "`git push`",
    };
    const hits = lintPackDir("/p", { list: () => Object.keys(files), read: (p) => files[p] ?? "" });
    expect(hits.map((h) => h.file).sort()).toEqual(["/p/attachments/fill/SKILL.md", "/p/plugin/skills/x/SKILL.md", "/p/skills/work/SKILL.md"]);
  });
});
```

And in `lib/skills/__tests__/sync.test.ts`, beside the existing drift cases, three new ones on the recheck step: `checkPack` returning `{ drift: false, lintHits: 2, strict: true }` makes the report not ok with a step message containing `mcp lint` and `rt skills check`; `{ drift: false, lintHits: 2, strict: false }` keeps the report ok and the step's message contains `2 hits (advisory` and `strictLint`; `{ drift: false, lintHits: 0, strict: true }` is ok with no lint text.

- [ ] **Step 2: Run to verify failure.** `bun test lib/skills/__tests__/mcp-lint.test.ts lib/skills/__tests__/sync.test.ts`: FAIL.

- [ ] **Step 3: Implement the lint**

```ts
// lib/skills/mcp-lint.ts
import { readdirSync, readFileSync, statSync } from "fs";
import { join, sep } from "path";

export interface LintRule { id: string; pattern: RegExp; tool: string; note: string }
export interface LintHit { file: string; line: number; text: string; rule: string; tool: string; note: string }

// The replacement table, as patterns over code-shaped text (fenced blocks and
// inline spans). Order matters only for which rule names a line first.
export const MCP_LINT_RULES: LintRule[] = [
  { id: "run-db-env", pattern: /\b(export|unset)\s+RT_RUN_DB\b/, tool: "run_start", note: "keep the runDb run_start returns and pass it on every run_* call" },
  { id: "subst", pattern: /\b[A-Za-z_][A-Za-z0-9_]*=\$\(\s*(rt|glab)\b/, tool: "mr_for_branch", note: "a tool returns the value; nothing needs a shell variable (the tool depends on the inner call: glab mr list is mr_for_branch or mr_list, rt runs is run_*)" },
  { id: "rt-runs", pattern: /\brt runs\b/, tool: "run_stage", note: "run_start, run_stage, run_field_set, run_field_get, run_decision, run_status, run_snapshot, run_list" },
  { id: "rt-sync", pattern: /\brt sync\b/, tool: "branch_sync", note: "one call: fetch, cherry-gated reset, rebase, force-with-lease push" },
  { id: "rt-worktree", pattern: /\brt worktree (provision|dispose)\b/, tool: "worktree_provision", note: "worktree_provision or worktree_dispose" },
  { id: "rt-herd", pattern: /\brt herd\b/, tool: "herd_spawn", note: "herd_start, herd_spawn, herd_brief, herd_close, herd_status, herd_list, herd_attend, herd_wrap_up, herd_resume, herd_ask, herd_answer, herd_report, herd_milestone" },
  { id: "gate-ask", pattern: /\brt gate ask\b/, tool: "gate_ask", note: "read the questions file and pass its questions, kind and context" },
  { id: "glab", pattern: /\bglab\b/, tool: "mr_view", note: "mr_view, mr_list, mr_for_branch, mr_threads, mr_pipeline, mr_job_trace, mr_merge, or an mr_* write" },
  { id: "git-push", pattern: /\bgit push\b/, tool: "git_push", note: "setUpstream: true for a first push, forceWithLease: true after a rebase" },
  { id: "git-rebase", pattern: /\bgit rebase\b(?!\s+--(continue|skip)\b)/, tool: "git_rebase", note: "onto: \"origin/<default>\" (it fetches), or abort: true" },
  { id: "git-pull", pattern: /\bgit pull\b/, tool: "git_pull", note: "fast-forward only" },
  { id: "worktree-add", pattern: /\bgit worktree add\b/, tool: "worktree_provision", note: "sibling worktrees are never created by hand" },
  { id: "pkill", pattern: /\bpkill\b|\bkill\s+(-\w+\s+)?\$/, tool: "worktree_stop_holders", note: "ends only the processes rt ties to the tree" },
];

// Written in one bare form by the skills; each stays on Bash on purpose.
export const KEPT_ON_BASH: RegExp[] = [
  /\brt gate answer\b.*--by shepherd\b/,
  /\brt gate wait\b/,
  /\brt chat tail\b/,
  /\brt events wait\b/,
];

const FENCE = /^\s*(```|~~~)/;
const INLINE = /`([^`\n]+)`/g;
export const ALLOW_MARKER = /<!--\s*mcp-lint:\s*allow\s*-->/;

/** Code-shaped text per line: whole lines inside a fence, inline spans outside
    one. A line carrying the allow marker, or sitting under a marker-only line,
    is dropped here so no rule sees it. */
function codeOn(lines: string[]): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let fenced = false;
  lines.forEach((raw, i) => {
    if (FENCE.test(raw)) { fenced = !fenced; return; }
    if (ALLOW_MARKER.test(raw)) return;
    const prev = lines[i - 1] ?? "";
    if (ALLOW_MARKER.test(prev) && prev.replace(ALLOW_MARKER, "").trim() === "") return;
    if (fenced) { out.push({ line: i + 1, text: raw }); return; }
    for (const m of raw.matchAll(INLINE)) out.push({ line: i + 1, text: m[1]! });
  });
  return out;
}

export function lintSkillText(text: string, file: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const { line, text: code } of codeOn(text.split("\n"))) {
    if (KEPT_ON_BASH.some((k) => k.test(code))) continue;
    const rule = MCP_LINT_RULES.find((r) => r.pattern.test(code));
    if (rule) hits.push({ file, line, text: code.trim(), rule: rule.id, tool: rule.tool, note: rule.note });
  }
  return hits;
}

const LINTED_ROOTS = ["skills", "attachments", join("plugin", "skills")];

function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const p = join(d, name);
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir) { if (name !== "node_modules" && name !== ".git") visit(p); } else out.push(p);
    }
  };
  visit(dir);
  return out;
}

export function lintPackDir(dir: string, deps: { list: (dir: string) => string[]; read: (path: string) => string } = { list: walk, read: (p) => readFileSync(p, "utf8") }): LintHit[] {
  const roots = LINTED_ROOTS.map((r) => join(dir, r) + sep);
  return deps.list(dir)
    .filter((p) => p.endsWith(".md") && roots.some((r) => p.startsWith(r)))
    .sort()
    .flatMap((p) => lintSkillText(deps.read(p), p));
}

export function formatHit(h: LintHit): string {
  return `${h.file}:${h.line}: \`${h.text}\` shells out for ${h.rule}; use the ${h.tool} tool (${h.note})`;
}
```

- [ ] **Step 4: Wire `check`, `--strict` and sync.** In `commands/skills.ts`: `Flags` gains `strict: boolean` (parsed from `--strict`); `CheckPayload` gains `mcpLint: LintHit[]` and `strictLint: boolean`; `computeCheck` sets `mcpLint: lintPackDir(resolved.packDir)` and `strictLint: resolved.packName === "mattstack" || manifestStrictLint(resolved.manifestPath)`, where `manifestStrictLint(path)` parses the manifest with jsonc-parser's `parse` (already imported in this file) and returns `manifest.strictLint === true` (false when the path is null or unreadable); `skillsCheck`'s human output prints `formatHit(h)` for each hit after the verb rows, then `mcp lint: N hits (advisory; --strict fails on them)` or `mcp lint: clean`; `if (flags.strict && payload.mcpLint.length > 0) process.exitCode = 1;` and the `--json` envelope includes `mcpLint` and `strictLint`. Tree node `check` gains `{ name: "Strict", flag: "--strict", type: "boolean", default: false, hint: "Fail the exit code on mcp lint hits (mattstack-skills CI uses this; rt skills sync applies it to the mattstack pack and to a pack whose manifest sets strictLint)" }`. In `lib/skills/sync.ts`: `SyncDeps.checkPack` returns `{ drift: boolean; lintHits: number; strict: boolean }`; the recheck step (`:280`) fails with `mcp lint: ${lintHits} hits; run rt skills check --pack ${pack} and fix them before syncing` only when `strict && lintHits > 0`; when `!strict && lintHits > 0` the step passes with the message `mcp lint: ${lintHits} hits (advisory; set "strictLint": true in the manifest to refuse on them)`. `commands/skills-sync.ts:107-110` returns `{ drift: payload.drift, lintHits: payload.mcpLint.length, strict: payload.strictLint }`. A team is therefore never blocked from publishing by a new rule until it opts in.

- [ ] **Step 5: Run.** `bun test lib/skills commands/__tests__/skills*` then `bunx tsc --noEmit`: PASS. Then `bun cli.ts skills check --pack-dir /Users/matt/Documents/GitHub/mattstack-skills --strict` (the Part B branch, merged) exits 0 with `mcp lint: clean`; the same with `--pack-dir` at the claimview pack exits 0. If either reports hits, that is a rewrite gap: fix in the owning Part B or C file first (lint over the pre-rewrite `main` of mattstack-skills must show hits, which is the lint's own RED). A hit on a deliberate don't (a warning that quotes the shell form) gets the `<!-- mcp-lint: allow -->` marker on that line, not a deletion.
- [ ] **Step 6: Commit.** `git add lib/skills/mcp-lint.ts commands/skills.ts commands/skills-sync.ts lib/skills/sync.ts lib/command-tree-def.ts lib/skills/__tests__/mcp-lint.test.ts lib/skills/__tests__/sync.test.ts` then `git commit -m "skills check: mcp lint from the replacement table with an allow marker; --strict; sync refuses for mattstack and strictLint packs"`.

### Task 33: `rt skills audit --pack <pack>` and the PR

**Files:**
- Create: `commands/skills-audit.ts`
- Modify: `lib/module-registry.ts` (thunk `"./commands/skills-audit.ts": () => import("../commands/skills-audit.ts")`), `lib/command-tree-def.ts` (`audit` leaf under `skills.subcommands`, beside `check`)
- Test: `commands/__tests__/skills-audit.test.ts`

**Interfaces:**
- Consumes: `buildClaudeArgv(inv: AgentInvocation, bins?)` and `resolveClaudeBin()` from `lib/agent-argv/claude.ts` (the same builder every `rt agent --surface headless` launch uses; `headless: true` emits `-p --output-format json`); `runCapture` (`lib/subprocess.ts`); `lintPackDir`'s file walk (`lib/skills/mcp-lint.ts`); `mcpToolsPayload` (Task 31); `checkPack` for pack resolution (`commands/skills.ts`).
- Produces: `buildAuditPrompt(paths: string[], tools: Array<{ name: string; description: string }>): string` (paths only, never file text: the claimview pack is about 19k lines and one `-p` argument that size risks E2BIG against ARG_MAX, and neither `claudeArgs` nor `runCapture` offers a stdin path for the prompt); `buildAuditInvocation(prompt: string, sessionId: string): AgentInvocation` with `extraArgs: "--allowedTools Read"` so the headless run reads the listed files itself with no permission bypass; `lintedMarkdownFiles(dir): string[]` exported from `lib/skills/mcp-lint.ts` (the markdown walk `lintPackDir` already does, extracted); `skillsAudit(args: string[]): Promise<void>`. Exit 0 with the report on stdout; exit 2 only when no claude binary or no pack resolves. Never a gate.

- [ ] **Step 1: Failing test**

```ts
// commands/__tests__/skills-audit.test.ts
import { describe, expect, test } from "bun:test";
import { buildAuditInvocation, buildAuditPrompt } from "../skills-audit.ts";
import { buildClaudeArgv } from "../../lib/agent-argv/claude.ts";

const paths = ["/p/skills/ship/SKILL.md", "/p/attachments/f/SKILL.md"];
const tools = [{ name: "git_push", description: "Push the tree's current branch." }, { name: "mr_create", description: "Create an MR." }];
const SESSION = "11111111-1111-4111-8111-111111111111";

describe("buildAuditPrompt", () => {
  test("names every file path and every tool with its description, and no file text", () => {
    const p = buildAuditPrompt(paths, tools);
    for (const f of paths) expect(p).toContain(f);
    for (const t of tools) { expect(p).toContain(t.name); expect(p).toContain(t.description); }
    expect(p).toContain("Read each file");
  });
  test("asks for the three pattern-proof findings and a per-finding file:line", () => {
    const p = buildAuditPrompt(paths, tools);
    expect(p).toContain("plain words");
    expect(p).toContain("shell variables");
    expect(p).toContain("wrapped");
    expect(p).toContain("file:line");
  });
  test("stays small however large the pack is", () => {
    const many = Array.from({ length: 2000 }, (_, i) => `/p/attachments/f${i}/SKILL.md`);
    expect(buildAuditPrompt(many, tools).length).toBeLessThan(120_000);
  });
});

describe("buildAuditInvocation", () => {
  test("is a headless claude run with the prompt, Read allowed, no bypass, no account", () => {
    const inv = buildAuditInvocation("PROMPT", SESSION);
    expect(inv).toMatchObject({ headless: true, prompt: "PROMPT", session: { kind: "start", sessionId: SESSION }, yolo: false, extraArgs: "--allowedTools Read" });
    const argv = buildClaudeArgv(inv, { claude: "/bin/claude" });
    expect(argv[0]).toBe("/bin/claude");
    expect(argv).toContain("-p");
    expect(argv.slice(argv.indexOf("--output-format"), argv.indexOf("--output-format") + 2)).toEqual(["--output-format", "json"]);
    expect(argv.slice(argv.indexOf("--allowedTools"), argv.indexOf("--allowedTools") + 2)).toEqual(["--allowedTools", "Read"]);
    expect(argv.at(-1)).toBe("PROMPT");
    expect(argv.some((a) => a.includes("dangerously"))).toBe(false);
    expect(inv.account).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun test commands/__tests__/skills-audit.test.ts`: FAIL, module missing.

- [ ] **Step 3: Implement**

First, in `lib/skills/mcp-lint.ts`, extract the walk `lintPackDir` does into an export and have `lintPackDir` call it:

```ts
export function lintedMarkdownFiles(dir: string, list: (dir: string) => string[] = walk): string[] {
  const roots = LINTED_ROOTS.map((r) => join(dir, r) + sep);
  return list(dir).filter((p) => p.endsWith(".md") && roots.some((r) => p.startsWith(r))).sort();
}

export function lintPackDir(dir: string, deps: { list: (dir: string) => string[]; read: (path: string) => string } = { list: walk, read: (p) => readFileSync(p, "utf8") }): LintHit[] {
  return lintedMarkdownFiles(dir, deps.list).flatMap((p) => lintSkillText(deps.read(p), p));
}
```

Then the command:

```ts
// commands/skills-audit.ts
import { randomUUID } from "crypto";
import { relative } from "path";
import { buildClaudeArgv, resolveClaudeBin, type AgentInvocation } from "../lib/agent-argv/claude.ts";
import { mcpToolsPayload } from "./mcp.ts";
import { checkPack } from "./skills.ts";
import { lintedMarkdownFiles } from "../lib/skills/mcp-lint.ts";
import { runCapture } from "../lib/subprocess.ts";

const AUDIT_TIMEOUT_MS = 600_000;

// Paths only: a pack runs to tens of thousands of lines, and the prompt is
// one argv token, so inlining file text would hit ARG_MAX. The run reads the
// files itself (Read is the one tool it is allowed).
export function buildAuditPrompt(paths: string[], tools: Array<{ name: string; description: string }>): string {
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const fileList = paths.map((p) => `- ${p}`).join("\n");
  return [
    "You are auditing a mattstack skill pack. Agents that load these skills run in Claude Code auto mode, where every shell command a tool could have covered costs a classifier round trip or is blocked outright.",
    "The mattstack MCP server publishes these tools:",
    toolList,
    "Read each file listed under Files with the Read tool (they are relative to your working directory), then report, as a Markdown list with one file:line per finding, three kinds of instruction that no pattern lint can catch:",
    "1. an instruction in plain words (\"push the branch\", \"open the MR\", \"rebase onto main\") that an agent will turn into a shell command a tool covers; name the tool;",
    "2. values carried between code blocks through shell variables ($IID, $RT_RUN_DB, read_token) instead of a tool result passed on explicitly;",
    "3. wrapped commands (cd x && ..., VAR=$(...), pipes, -C <tree>) around an rt, glab or git call.",
    "Anything on this kept list is fine and must not be reported: rt gate answer --by shepherd, rt gate wait, rt chat tail, rt events wait, git commit, git add, git fetch, git merge-base, git rebase --continue, git rebase --skip, project tooling such as pnpm. A line carrying <!-- mcp-lint: allow --> is a deliberate don't and must not be reported either.",
    "End with one line: `findings: <n>`.",
    "## Files",
    fileList,
  ].join("\n\n");
}

// Headless, no permission bypass, Read alone allowed: the audit reads the
// pack and writes nothing.
export function buildAuditInvocation(prompt: string, sessionId: string): AgentInvocation {
  return { headless: true, prompt, session: { kind: "start", sessionId }, yolo: false, extraArgs: "--allowedTools Read" };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function skillsAudit(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const pack = flag(args, "--pack");
  const packDir = flag(args, "--pack-dir");
  if (!pack && !packDir) { console.error("rt skills audit: pass --pack <name> or --pack-dir <dir>"); process.exit(2); }
  const resolved = await checkPack({ ...(pack ? { pack } : {}), ...(packDir ? { packDir } : {}) });
  let claude: string;
  try { claude = resolveClaudeBin(); } catch { console.error("rt skills audit: no claude binary on PATH; the audit needs a Claude login"); process.exit(2); }
  const files = lintedMarkdownFiles(resolved.packDir).map((p) => relative(resolved.packDir, p));
  const prompt = buildAuditPrompt(files, mcpToolsPayload().tools.map((t) => ({ name: t.name, description: t.description })));
  const argv = buildClaudeArgv(buildAuditInvocation(prompt, randomUUID()), { claude });
  const r = await runCapture(argv as [string, ...string[]], { cwd: resolved.packDir, timeoutMs: AUDIT_TIMEOUT_MS, stderr: "pipe" });
  let text = r.stdout;
  try { const parsed = JSON.parse(r.stdout) as { result?: string }; if (typeof parsed.result === "string") text = parsed.result; } catch { /* claude printed plain text; show it as is */ }
  if (r.exitCode !== 0) console.error(`rt skills audit: claude exited ${r.exitCode}: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
  if (json) { console.log(JSON.stringify({ pack: resolved.pack, packDir: resolved.packDir, files, report: text, advisory: true })); return; }
  console.log(`rt skills audit (advisory; never a gate): ${resolved.pack}\n`);
  console.log(text);
}
```

Tree node under `skills.subcommands`:

```ts
audit: {
  description: "Advisory LLM audit of a pack's skills and fills for shell instructions the MCP tools cover (plain-words commands, shell-variable hand-offs, wrapped calls); slow, costs tokens, never a gate",
  module: "./commands/skills-audit.ts",
  fn: "skillsAudit",
  args: [
    { name: "Pack", flag: "--pack", type: "text", placeholder: "acme", hint: "Pack name; omit with --pack-dir" },
    { name: "Pack dir", flag: "--pack-dir", type: "text", placeholder: "/path/to/pack", hint: "Audit this pack directory instead of resolving --pack" },
    SETUP_JSON_ARG,
  ],
},
```

No required positional, so no `omitBehavior` is needed; `bun run picker:check` confirms. Registry thunk added as named above.

- [ ] **Step 4: Run.** `bun test commands/__tests__/skills-audit.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts` then `bun run picker:check` then `bunx tsc --noEmit`: PASS. Then one real run: `bun cli.ts skills audit --pack-dir /Users/matt/Documents/GitHub/mattstack-skills` prints a report ending in `findings: <n>` and exits 0 whatever `n` is.
- [ ] **Step 5: Commit, PR, deploy.** `git add commands/skills-audit.ts lib/module-registry.ts lib/command-tree-def.ts lib/skills/mcp-lint.ts commands/__tests__/skills-audit.test.ts` then `git commit -m "skills audit: advisory headless-claude pass over a pack with the tool list"`. `bun run test`, `bunx tsc --noEmit`, build `dist/rt` and run `e2e/tests/skills-sync.test.ts` (sync's recheck now carries `lintHits`). PR `skills: mcp tools listing, check lint with --strict, advisory audit (RT-326 pack authoring)`; merge; deploy; from a fresh session `rt_verb {args: ["skills", "check", "--pack", "mattstack", "--strict"]}` returns clean.

### Task 34: The `mcp-tools` reference and the pack-authoring pointers (mattstack-skills)

**Files:**
- Create: `attachments/mcp-tools/SKILL.md` (hand-written front matter and header), `attachments/mcp-tools/reference.md` (generated), `scripts/gen-mcp-tools.ts`, `tests/test-mcp-tools-reference.sh`
- Modify: `plugin/skills/creating-a-pack/SKILL.md` (section "## 4. Offer the first rules, once"), `plugin/skills/extending-a-pack/SKILL.md` (section "## 2. Write it (context or fill)"), `plugin/skills/editing-skills/SKILL.md` (the GREEN step), `CERTIFICATION.md` (checklist line)
- Test: `sh tests/test-mcp-tools-reference.sh`; certification tail

**Interfaces:**
- Consumes: `rt mcp tools --json` (Task 31).
- Produces: `attachments/mcp-tools/reference.md`, one `### <name>` section per tool with its description and a fenced JSON schema, headed by a generated-file banner naming the command that regenerates it.

- [ ] **Step 1: Failing test**

```sh
#!/bin/sh
# tests/test-mcp-tools-reference.sh: the committed reference is what rt generates today.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
command -v rt >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no rt on PATH"; exit 0; }
command -v bun >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no bun on PATH"; exit 0; }
TMP=$(mktemp)
rt mcp tools --json | bun "$ROOT/scripts/gen-mcp-tools.ts" > "$TMP" || { echo "FAIL mcp-tools-reference: generation failed"; exit 1; }
if cmp -s "$TMP" "$ROOT/attachments/mcp-tools/reference.md"; then echo "ok   mcp-tools-reference"; rm -f "$TMP"; exit 0; fi
echo "FAIL mcp-tools-reference: attachments/mcp-tools/reference.md is stale; run: rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md"
diff "$TMP" "$ROOT/attachments/mcp-tools/reference.md" | head -20
rm -f "$TMP"
exit 1
```

Run: `sh tests/test-mcp-tools-reference.sh`: FAIL (no generator, no reference).

- [ ] **Step 2: The generator**

```ts
// scripts/gen-mcp-tools.ts: stdin = `rt mcp tools --json`, stdout = reference.md
const input = JSON.parse(await Bun.stdin.text()) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
const out: string[] = [
  "# mattstack MCP tools",
  "",
  "Generated from `rt mcp tools --json`; do not edit by hand. Regenerate with:",
  "`rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md`",
  "",
  "Every tool below is on the mattstack MCP server, which is allowed whole in every mattstack install. Before a skill tells an agent to run a shell command, check whether a tool here covers it.",
  "",
];
for (const t of input.tools) {
  out.push(`### ${t.name}`, "", t.description, "", "```json", JSON.stringify(t.inputSchema, null, 2), "```", "");
}
process.stdout.write(out.join("\n"));
```

`attachments/mcp-tools/SKILL.md`:

```markdown
---
name: mcp-tools
description: "Reference: every tool on the mattstack MCP server, generated from rt. Read when writing a skill or fill that would otherwise tell an agent to run rt, glab or a git write in Bash."
disable-model-invocation: true
---

# mattstack MCP tools

`reference.md` beside this file is generated from `rt mcp tools --json` and
lists every tool with its input schema. The rule for skill authors: if a
skill does something as part of its normal flow and it is an rt call, a
forge call or a git write, it is a tool call, named in the sentence that
would otherwise carry the command. `rt skills check` lints for the shell
forms the tools replace; `rt skills audit --pack <pack>` reads for the
plain-words cases a lint cannot see.

Kept on Bash on purpose: `rt gate answer <id> --answers <json> --by shepherd`,
`rt gate wait <id>`, `rt chat tail`, `rt events wait`, `git commit`, `git add`,
`git fetch`, `git merge-base`, `git rebase --continue` and `--skip`, and project tooling.
```

Generate: `rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md` (one pipeline is fine outside an rt worktree session; from one, run the two halves as separate commands with a temp file).

- [ ] **Step 3: Pointers and the GREEN question.** `creating-a-pack` "## 4. Offer the first rules, once" and `extending-a-pack` "## 2. Write it (context or fill)" each gain one paragraph: "Before a fill tells an agent to run a command, open `attachments/mcp-tools/reference.md` (the `mcp-tools` reference): every rt call, forge call and git write a pipeline needs is a tool there, and `rt skills check` flags the shell form. `rt skills audit --pack <pack>` is the slower read for plain-words instructions." `editing-skills`' GREEN step gains the question: "Did the fresh agent run a shell command a tool covers (`rt runs`, `glab`, `git push`, `git rebase`, `rt herd`, `rt worktree provision`)? Then the skill is not green: name the tool in the sentence that named the command." (The superpowers `writing-skills` skill is not this repo's to edit; `editing-skills` is the mattstack wrapper every skill edit here goes through, so the question lives there and in `CERTIFICATION.md`'s checklist.) Add `- [ ] GREEN transcript shows no shell command a mattstack MCP tool covers` to the checklist in `CERTIFICATION.md`.
- [ ] **Step 4: Run.** `sh tests/test-mcp-tools-reference.sh` exits 0; `sh tests/certify.sh attachments/mcp-tools`, `plugin/skills/creating-a-pack`, `plugin/skills/extending-a-pack`, `plugin/skills/editing-skills` exit 0; `sh tests/repo-purity.sh` exits 0; GREEN on `extending-a-pack` (a fresh agent asked to add a fill that pushes a branch names `git_push`, not `git push`).
- [ ] **Step 5: Bump, commit** `mcp-tools reference: generated from rt; pack skills point at it; GREEN asks about tool coverage`.

### Task 35: `--strict` in mattstack-skills CI and the sync gate

**Files:**
- Modify: `.github/workflows/purity.yml` (a lint job), `CERTIFICATION.md` (the `--strict` line), `.claude-plugin/plugin.json` (bump)
- Test: the workflow itself on the PR; locally `bun cli.ts skills check --pack-dir /Users/matt/Documents/GitHub/mattstack-skills --strict` from the rt checkout

- [ ] **Step 1: Prove the invocation locally first.** From the rt checkout: `bun cli.ts skills check --pack-dir /Users/matt/Documents/GitHub/mattstack-skills --strict` exits 0 and prints `mcp lint: clean`. If `--pack-dir` needs the mattstack root too, add `--mattstack-dir /Users/matt/Documents/GitHub/mattstack-skills` and carry the same flag into the workflow.
- [ ] **Step 2: The job.** Append to `.github/workflows/purity.yml`:

```yaml
  mcp-lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: m4ttstack/rt
          # The merge commit of the rt PR that shipped the mcp lint (Task 33).
          # A sha, never a floating branch: rt main must not be able to turn
          # this repo red without a change here. Moved to a release tag as a
          # deliberate bump once one exists.
          ref: <merge sha of Task 33's PR>
          path: rt
      - uses: oven-sh/setup-bun@v2
      - name: Install rt's dependencies
        run: bun install --frozen-lockfile
        working-directory: rt
      - name: mcp lint (strict)
        run: bun cli.ts skills check --pack-dir "$GITHUB_WORKSPACE" --strict
        working-directory: rt
        env:
          RT_SKIP_SETUP: "1"
          RT_BATCH: "1"
```

`m4ttstack/rt` is public and its one scoped dependency, `@mattstack/glance` (`^0.27.0` in `package.json`), is public on npm (`npm view @mattstack/glance version` prints 0.27.0), so `bun install --frozen-lockfile` needs no token and no fallback. `ref` is the full merge commit sha of Task 33's PR on rt `main` (read it with `gh pr view <number> --json mergeCommit -q .mergeCommit.oid` and paste the 40 characters); no rt release is cut before this task, so a tag would not resolve on the job's first run. When the next rt release ships, or a later release changes a rule, the pin moves to that tag or sha in the same PR that fixes any hits, so the two land together. Record the sha in the commit body.

- [ ] **Step 3: Sync gate.** Nothing to add in this repo: `rt skills sync --pack mattstack` (Task 32) already refuses on hits for this pack. State it in `CERTIFICATION.md`: "`rt skills check --strict` is the merge gate in CI and `rt skills sync` refuses on hits for the mattstack pack; a team pack sees hits as advisory on sync until its manifest sets `\"strictLint\": true`. A deliberate don't that quotes a shell form carries `<!-- mcp-lint: allow -->`."
- [ ] **Step 4: Run.** Push the branch; the `mcp-lint` job is green. `sh tests/repo-purity.sh` locally.
- [ ] **Step 5: Bump (minor, e.g. `0.23.0`), commit** `ci: rt skills check --strict as the mcp lint gate`; PR `pack authoring: mcp-tools reference and strict lint (RT-326)`; merge; `rt skills sync --pack mattstack`.

---

# Part D: cleanup, docs, the auto-mode run

### Task 36: `BASE_PERMISSIONS` (Matt applies) and its test

**Files:**
- Modify (by Matt): `lib/setup/base-permissions.ts`
- Test: `lib/setup/__tests__/base-permissions.test.ts` (new; the agent writes it)

- [ ] **Step 1: The lines for Matt.** The list becomes exactly:

```ts
export const BASE_PERMISSIONS: string[] = [
  "mcp__plugin_fast-browser_fast-browser",
  "mcp__plugin_mattstack_mattstack",
  "EnterWorktree",
  "Bash(claude plugin update *)",
  "Bash(rt gate *)",
  "Bash(rt chat tail *)",
  "Bash(rt events wait *)",
];
```

(dropped: `Bash(glab *)`, `Bash(glab mr approve *)`, `Bash(glab mr note *)`, `Bash(rt skills sync *)`, `Bash(rt runs *)`; kept: `Bash(rt gate *)`; added: the two Monitor waits). The header comment's `glab` and `rt runs` paragraphs are replaced by one sentence: "`rt gate`, `rt chat tail` and `rt events wait` are the long waits and the shepherd's CLI-only answer that skills still run in Bash, each in one bare form; everything else a skill runs routinely is a tool on the mattstack server." Hand these to Matt as a diff; he commits them.

- [ ] **Step 2: The test (agent-written, before Matt's edit, so it fails first)**

```ts
// lib/setup/__tests__/base-permissions.test.ts
import { describe, expect, test } from "bun:test";
import { BASE_PERMISSIONS } from "../base-permissions.ts";

describe("BASE_PERMISSIONS", () => {
  test("carries no forge CLI, no rt runs, and no git rule; keeps the long waits", () => {
    expect(BASE_PERMISSIONS.some((r) => r.startsWith("Bash(glab"))).toBe(false);
    expect(BASE_PERMISSIONS).not.toContain("Bash(rt runs *)");
    expect(BASE_PERMISSIONS).not.toContain("Bash(rt skills sync *)");
    expect(BASE_PERMISSIONS.some((r) => r.startsWith("Bash(git"))).toBe(false);
    for (const kept of ["mcp__plugin_mattstack_mattstack", "Bash(rt gate *)", "Bash(rt chat tail *)", "Bash(rt events wait *)"]) expect(BASE_PERMISSIONS).toContain(kept);
  });
});
```

Run: `bun test lib/setup/__tests__/base-permissions.test.ts`: FAIL until Matt's edit lands; PASS after. Then `bun test lib/setup`.
- [ ] **Step 3: Commit** the test with Matt's edit (one commit, Matt's): `setup: base permissions drop glab and rt runs; keep gate, add the Monitor waits`.

### Task 37: AGENTS.md and the rt.cool MCP page

**Files:**
- Modify: `AGENTS.md` sections "Gates and the `rt_verb` MCP tool" (`:172-200`) and "The relocation prompt parser reads a real capture"
- Modify: the rt.cool docs MCP page via the `rt:docs` skill (its concept guide for the MCP server and the generated command reference)

- [ ] **Step 1: Gates section.** Replace "Mark a verb agent-safe only when it writes nothing the calling agent does not already own (its own run, its own gates, a read)" with the spec's rule: "Mark a verb agent-safe when a skill runs it as part of its normal flow and it is an rt call, a forge call or a git write the classifier blocks; the skill's own gates stay the human check. A leaf whose run outlasts `RT_VERB_TIMEOUT_MS` sets `agentTimeoutMs` on its node." Replace "Merge, and anything equally irreversible, stays off the server so the classifier or a human stays in front of it" with "`mr_merge` is on the server (GitLab still enforces approvals and pipeline rules); the skill's ship gate is the human check." Add one paragraph naming the tool families and files: run tools (`lib/mcp/run-tools.ts`, in-process over `runWriteVerb`), GitLab reads (`mr-read-tools.ts`), git writes (`git-tools.ts`, guarded by `tree-guard.ts`: `git_push` never force-pushes without lease and never pushes main/master/the default branch; `branch_sync` refuses to reset over unpushed commits), worktree and herd tools.
- [ ] **Step 2: Relocation section.** Add: the parser now reads the EnterWorktree and ExitWorktree drawings (both captured); attended herdr panes are driven only after a `pane:announce-relocation` from the plugin's `PreToolUse` hook, within `lib/daemon/relocation-announce.ts`'s window, and only for the announced path (or the session's recorded origin on exit); herd worker panes stay with the watchdog.
- [ ] **Step 3: Docs.** Invoke `rt:docs`; regenerate the command reference (the `announce-relocation` verb is hidden and must not appear; `agentSafe` leaves list under the MCP page); update the MCP concept page with the tool families and the kept-on-Bash list.
- [ ] **Step 4:** `bun test lib/__tests__/command-tree-help.test.ts`; commit `docs: AGENTS.md and rt.cool for the MCP tool families`; PR `docs: MCP tools over Bash (RT-326 cleanup)`; merge on green CI (docs-only: no CodeRabbit wait).

### Task 38: The auto-mode run and the strict lint on both packs

- [ ] **Step 0: Strict lint first.** `rt skills check --pack mattstack --strict` and `rt skills check --pack claimview --strict` both exit 0 with `mcp lint: clean` on the installed packs (mattstack 0.23, claimview 0.6.0). A hit here is a rewrite gap: fix it in the owning Part B or C file, re-certify, bump, sync, and re-run before the auto-mode run starts.
- [ ] **Step 1:** On a machine (or a fresh Claude config dir) where Install seeded `permissions.defaultMode: "auto"` and the merged rt, mattstack 0.23 and claimview 0.6.0 are installed, run one real `work` run on the harness repo end to end (provision through ship and watch-ci) and one shepherdr herd with two workers, including an `EnterWorktree` and an `ExitWorktree` in the attended pane.
- [ ] **Step 2: Pass criteria**, checked in the transcripts and `rt daemon logs`: every rt, forge and git-write call went through a tool (the only Bash rt calls are `rt gate wait`, `rt gate answer --by shepherd`, `rt chat tail`, `rt events wait`); no call waited on the classifier (no "permission" pause in the pane); the relocation dialog never waited on the person. Record the run ids and the herd id in the RT-326 ticket and close it.
- [ ] **Step 3:** If any call still hit Bash, that is a skill wording bug: fix it in the owning Part B or C task's file, re-certify, bump, sync, and re-run this task.

---

## Self-review

**Spec coverage.** Run tracking (8 tools, `cwd` on `runWriteVerb`, `run_start` flags and `skillDir`, `runDb` on every call, `run_list`): Tasks 1-3. GitLab reads (6) and `mr_merge` via `mr:action`/`setAutoMerge`: Tasks 4-6. Git writes with every refusal, `branch_sync` with the cherry-gated reset: Tasks 7-10. Worktrees (3), herd (10 incl. `herd_brief` via the verb runner), wider `rt_verb` (25 leaves, `agentTimeoutMs`, `herd brief` agent-safe): Tasks 11-14. Relocation: captures first, parser, `pane:announce-relocation`, the hook verb, the plugin hook, name-mode handled: Tasks 15-18, 26. Skills: engines, stages, review verbs, forge verbs, gate-protocol, shepherdr (cloud lane deleted, worker brief, stop-holders, trust-modal step), plugin skills (pasted comments), doorbell hook, shell state, audit re-run: Tasks 19-27. Claimview: Tasks 28-30. Pack authoring (`rt mcp tools --json` pinned to `mcpTools()`, the lint with per-rule hits and the kept-list and tool-prose no-hits, `--strict` in `check` and refused by `sync`, the advisory `rt skills audit` reusing `buildClaudeArgv`'s headless form with prompt and argv tested without a spawn, the generated `mcp-tools` reference with its regeneration test, the `creating-a-pack` and `extending-a-pack` pointers, the GREEN question, `--strict` in CI): Tasks 31-35. Cleanup (`BASE_PERMISSIONS` by Matt, AGENTS.md both sections, rt.cool), the strict lint on both packs and the auto-mode run: Tasks 36-38. Release: the mattstack.app release that carries rt, the plugin and the pack together is the existing `rt:release` flow and is not a task here; Task 38 is the gate before it.

Rulings in Part E: the lint reads code-shaped text only (fenced blocks and inline spans), so prose that names a tool never hits and plain-words instructions are left to the audit, as the spec divides them; the `<!-- mcp-lint: allow -->` marker excuses its own line or the one code line under a marker-only line, never a whole block. `rt skills sync` refuses on hits only for the mattstack pack or a manifest with `"strictLint": true`; other packs see hits as advisory. The audit prompt carries file paths, not text (a 19k-line pack in one argv token would hit ARG_MAX; `claudeArgs` and `runCapture` have no stdin route), and the headless run reads them with `--allowedTools Read` and no bypass. The GREEN question lives in mattstack-skills' `editing-skills` and `CERTIFICATION.md`, since the superpowers `writing-skills` skill is not this repo's to edit. CI runs the lint by checking out the public `m4ttstack/rt` and running `bun cli.ts skills check --pack-dir ... --strict`, because no rt binary is installed on a GitHub runner.

**Placeholder scan.** Task 15's `<the path in the capture>`, Task 30's manifest path and Task 35's `<merge sha of Task 33's PR>` are the deliberate fill-ins that depend on a capture, a machine or a merge that has not happened yet; each says where the value comes from and what to record. No "TBD", no "similar to Task N" without the code repeated.

**Type consistency.** `McpToolDef` and `ToolResult` come from `shared.ts` (Task 2) and every later tool file imports them from there. `GitToolDeps.sync` returns `{ code, stdout, stderr }` in Tasks 8 and 9 (Task 9 notes the `ExecResult` field check). `RelocationDriveOutcome` (Task 16) is `trust-accept.ts`'s existing export. `Commands["pane:announce-relocation"]` is declared in Task 16 and consumed by Task 17's `buildRelocationAnnouncement`.

**Review Focus coverage.** (1) symlinked tree: Task 7's realpath test. (2) upstream with another name or remote, and `push.default=matching`: Task 8 pushes an explicit `HEAD:refs/heads/<upstream>` refspec to the upstream's remote and only invents `origin/<branch>` under `setUpstream`; the renamed-upstream, other-remote and "no upstream" tests pin it. `git_rebase` refuses a dash-leading `onto` (the `--exec` hole) and `branch_sync` shares `git_push`'s protected-branch refusal, both tested. (3) shell syntax in `flags`: Task 2's `splitFlags` test. (4) dialog naming a registered tree that is not the announced path: Task 16's "allows only the announced registered path" test. (5) `mr_merge` auto-merge honesty: Task 5's `autoMerge: true` test.

