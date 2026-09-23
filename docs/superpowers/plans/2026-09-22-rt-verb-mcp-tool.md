# rt_verb MCP tool (RT-244) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `rt_verb` to the mattstack MCP server: it runs only command-tree leaves marked `agentSafe`, so agents call those rt verbs with no permission prompt.

**Architecture:** A TUI-free resolver walks argv down `TREE`; a new `agentSafe` flag on `CommandNode` marks what the tool may run, guarded by a gate test; a shared self-spawn helper builds rt's own argv; `lib/mcp/rt-verb.ts` holds the handler with injected spawn, and `lib/mcp/tools.ts` registers it.

**Tech Stack:** Bun, TypeScript, `bun:test`, the MCP stdio server in `commands/mcp.ts`.

**Spec:** `docs/superpowers/specs/2026-09-22-rt-verb-mcp-tool-design.md`

## Global Constraints

- Tool name `rt_verb`; input `{ args: string[], cwd?: string }`.
- The walk is anchored at `args[0]`; a leading `-` is refused before any lookup.
- Only declared flags (`CommandArg.flag`) plus `--json` pass; `--name=value` is checked by name.
- Spawn argv: `[...rtSelfArgv(), ...path, ...rest]`, with `--json` appended once when absent. Env adds `RT_BATCH=1` and `RT_SKIP_SETUP=1`. Timeout 30s through `execWithTimeout`.
- Launch set: `worktree list`, `endpoint lookup`, `herd status`. `skills writing-style show` is marked by the writing-style lane after this merges.
- `lib/mcp` must not import `lib/command-tree.ts` (it imports the TUI); `lib/command-tree-def.ts` imports only types from it and is safe.
- Clean-code comments: comments state constraints only, never narration or review history.
- Run `bun run test:all` (or at least the e2e file touched) before calling anything verified; plain `bun run test` skips e2e.
- Work in this repo-tools worktree's own branch; never on the shared main checkout.

## Review Focus

- `["--post-install", "worktree", "list"]` and any other leading flag: refused before the walk (Task 4 test).
- An alias in the middle of the path (for example `rt wt list` if `wt` aliases `worktree`): resolves, and the spawned path uses the canonical name (Task 1 test).
- A flag value that itself starts with `-` (`--repo -x`): refused as an undeclared flag; acceptable and pinned so it does not regress silently (Task 4 test).
- A daemon that is down: `worktree list` exits 1 with plain text; the error surfaces the text (Task 4 test).
- A branch node (`["worktree"]`) or an unknown verb: refused with the agent-safe list (Task 4 test).

---

### Task 1: TUI-free command resolver

**Files:**
- Create: `lib/command-tree-resolve.ts`
- Modify: `lib/command-tree.ts` (`resolveNode`, `resolveNodeName` delegate)
- Test: `lib/__tests__/command-tree-resolve.test.ts`

**Interfaces:**
- Produces:
  - `lookupChild(tree: Record<string, CommandNode>, name: string): { key: string; node: CommandNode } | null`
  - `resolveLeaf(tree: Record<string, CommandNode>, args: string[]): { node: CommandNode; path: string[]; rest: string[] } | null`
  - `listAgentSafe(tree: Record<string, CommandNode>): { path: string[]; node: CommandNode }[]` (used by Tasks 2 and 4)

- [ ] **Step 1: Write the failing test**

`lib/__tests__/command-tree-resolve.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { CommandNode } from "../command-tree.ts";
import { listAgentSafe, lookupChild, resolveLeaf } from "../command-tree-resolve.ts";
import { TREE } from "../command-tree-def.ts";

const leaf = (extra: Partial<CommandNode> = {}): CommandNode => ({ description: "x", module: "./m.ts", ...extra });

const tree: Record<string, CommandNode> = {
  worktree: {
    description: "w",
    aliases: ["wt"],
    subcommands: { list: leaf({ agentSafe: true, aliases: ["ls"] }), dispose: leaf() },
  },
  version: leaf(),
};

describe("lookupChild", () => {
  test("direct and alias names resolve to the canonical key", () => {
    expect(lookupChild(tree, "worktree")?.key).toBe("worktree");
    expect(lookupChild(tree, "wt")?.key).toBe("worktree");
    expect(lookupChild(tree, "nope")).toBeNull();
  });
});

describe("resolveLeaf", () => {
  test("walks to the leaf and splits off its own args", () => {
    const r = resolveLeaf(tree, ["worktree", "list", "--repo", "x"]);
    expect(r?.path).toEqual(["worktree", "list"]);
    expect(r?.rest).toEqual(["--repo", "x"]);
    expect(r?.node.agentSafe).toBe(true);
  });

  test("aliases resolve at every level and the path is canonical", () => {
    expect(resolveLeaf(tree, ["wt", "ls"])?.path).toEqual(["worktree", "list"]);
  });

  test("a branch with no matching child stops at the branch", () => {
    const r = resolveLeaf(tree, ["worktree", "bogus"]);
    expect(r?.path).toEqual(["worktree"]);
    expect(r?.node.subcommands).toBeDefined();
    expect(r?.rest).toEqual(["bogus"]);
  });

  test("an unknown first arg resolves to nothing", () => {
    expect(resolveLeaf(tree, ["nope"])).toBeNull();
    expect(resolveLeaf(tree, ["--post-install", "worktree"])).toBeNull();
  });

  test("matches the real tree's dispatch for every alias in TREE", () => {
    const walk = (level: Record<string, CommandNode>, prefix: string[]) => {
      for (const [key, node] of Object.entries(level)) {
        for (const alias of node.aliases ?? []) {
          expect(resolveLeaf(TREE, [...prefix, alias])?.path).toEqual([...prefix, key]);
        }
        if (node.subcommands) walk(node.subcommands, [...prefix, key]);
      }
    };
    walk(TREE, []);
  });
});

describe("listAgentSafe", () => {
  test("lists agent-safe leaves by canonical path", () => {
    expect(listAgentSafe(tree).map((e) => e.path)).toEqual([["worktree", "list"]]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test lib/__tests__/command-tree-resolve.test.ts`
Expected: FAIL, cannot find module `../command-tree-resolve.ts` (and a type error on `agentSafe` until Task 2; add the field in this task's Step 3 so the file compiles).

- [ ] **Step 3: Implement**

`lib/command-tree-resolve.ts`:

```ts
/**
 * Alias-aware tree walking with no TUI imports, so lib/mcp can resolve a verb
 * without loading lib/command-tree.ts (which pulls in the terminal UI).
 */
import type { CommandNode } from "./command-tree.ts";

export function lookupChild(tree: Record<string, CommandNode>, name: string): { key: string; node: CommandNode } | null {
  const direct = tree[name];
  if (direct) return { key: name, node: direct };
  for (const [key, node] of Object.entries(tree)) {
    if (node.aliases?.includes(name)) return { key, node };
  }
  return null;
}

/** Walks from args[0] only; the first arg that names no child ends the path. */
export function resolveLeaf(
  tree: Record<string, CommandNode>,
  args: string[],
): { node: CommandNode; path: string[]; rest: string[] } | null {
  let level = tree;
  let node: CommandNode | null = null;
  const path: string[] = [];
  let i = 0;
  while (i < args.length) {
    const hit = lookupChild(level, args[i]!);
    if (!hit) break;
    node = hit.node;
    path.push(hit.key);
    i++;
    if (!hit.node.subcommands) break;
    level = hit.node.subcommands;
  }
  return node ? { node, path, rest: args.slice(i) } : null;
}

export function listAgentSafe(tree: Record<string, CommandNode>, prefix: string[] = []): { path: string[]; node: CommandNode }[] {
  return Object.entries(tree).flatMap(([key, node]) => {
    const path = [...prefix, key];
    if (node.subcommands) return listAgentSafe(node.subcommands, path);
    return node.agentSafe ? [{ path, node }] : [];
  });
}
```

In `lib/command-tree.ts`, add the field to `CommandNode` (after `omitBehavior`):

```ts
  /**
   * An agent may run this leaf through the mattstack MCP server's `rt_verb`
   * tool with no permission prompt, including from a pane reading untrusted
   * text (an MR under review). The bar: no state change the caller directs,
   * under any flag the leaf declares. It never deletes, and never writes
   * settings, secrets, worktrees, runs, or another agent's state. Housekeeping
   * the implementation does on any read (a legacy import, a self-healing index
   * row) is not a caller-directed change and does not disqualify a leaf.
   * Set it only on a leaf that declares --json. Guarded by
   * lib/__tests__/agent-safe.test.ts.
   */
  agentSafe?: true;
```

Replace the bodies of `resolveNode` and `resolveNodeName` in `lib/command-tree.ts`:

```ts
function resolveNode(tree: Record<string, CommandNode>, name: string): CommandNode | null {
  return lookupChild(tree, name)?.node ?? null;
}

function resolveNodeName(tree: Record<string, CommandNode>, name: string): string {
  return lookupChild(tree, name)?.key ?? name;
}
```

and add `import { lookupChild } from "./command-tree-resolve.ts";` with the other imports.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/command-tree-resolve.test.ts lib/__tests__/command-tree*.test.ts`
Expected: PASS, including the existing dispatch tests.

- [ ] **Step 5: Commit**

```bash
git add lib/command-tree-resolve.ts lib/command-tree.ts lib/__tests__/command-tree-resolve.test.ts
git commit -m "command-tree: TUI-free resolveLeaf and the agentSafe node flag"
```

---

### Task 2: The agent-safe gate and the launch set

**Files:**
- Modify: `lib/command-tree-def.ts` (three `agentSafe: true`)
- Test: `lib/__tests__/agent-safe.test.ts`

**Interfaces:**
- Consumes: `listAgentSafe` (Task 1).

- [ ] **Step 1: Write the failing test**

`lib/__tests__/agent-safe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { TREE } from "../command-tree-def.ts";
import { listAgentSafe } from "../command-tree-resolve.ts";

describe("agent-safe surface", () => {
  test("every agent-safe leaf is listed here, so each addition is reviewed", () => {
    expect(listAgentSafe(TREE).map((e) => e.path.join(" ")).sort()).toEqual([
      "endpoint lookup",
      "herd status",
      "worktree list",
    ]);
  });

  test("each is a leaf that declares --json and can run without a person", () => {
    for (const { path, node } of listAgentSafe(TREE)) {
      const where = path.join(" ");
      expect(node.subcommands, where).toBeUndefined();
      expect((node.args ?? []).some((a) => a.flag === "--json"), `${where} declares --json`).toBe(true);
      expect(node.devOnly, where).toBeFalsy();
      expect(node.hidden, where).toBeFalsy();
      expect(node.requiresTTY, where).toBeFalsy();
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test lib/__tests__/agent-safe.test.ts`
Expected: FAIL, the list is empty.

- [ ] **Step 3: Check each verb against the bar, then mark it**

Before marking, read each handler and confirm no flag it declares directs a state change: `commands/worktree.ts` `worktreeList` (`--repo`, `--json`), `commands/endpoint.ts` `endpointLookup` (role, `--path`, `--json`), `commands/herd.ts` `status` (`--herd`, `--json`). If one fails the bar, leave it unmarked and remove it from the test's list, and say so in the task report.

In `lib/command-tree-def.ts` add `agentSafe: true,` to the `worktree` › `list` node, the `endpoint` › `lookup` node, and the `herd` › `status` node (next to each node's `module`).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/agent-safe.test.ts lib/__tests__/picker-conformance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/command-tree-def.ts lib/__tests__/agent-safe.test.ts
git commit -m "command-tree: mark worktree list, endpoint lookup, herd status agent-safe"
```

---

### Task 3: Shared self-spawn helper

**Files:**
- Create: `lib/rt-self.ts`
- Modify: `commands/home.ts:397-399` (`rtSelfBin` uses `isCompiledRt`)
- Test: `lib/__tests__/rt-self.test.ts`

**Interfaces:**
- Produces: `isCompiledRt(moduleUrl?: string): boolean`; `rtSelfArgv(opts?: { compiled?: boolean; execPath?: string; main?: string }): string[]`.

- [ ] **Step 1: Write the failing test**

`lib/__tests__/rt-self.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isCompiledRt, rtSelfArgv } from "../rt-self.ts";

describe("isCompiledRt", () => {
  test("a module under the compiled binary's /$bunfs root is compiled", () => {
    expect(isCompiledRt("file:///$bunfs/root/rt")).toBe(true);
  });
  test("a source module is not", () => {
    expect(isCompiledRt("file:///Users/dev/repo-tools/lib/rt-self.ts")).toBe(false);
  });
  test("this test process runs from source", () => {
    expect(isCompiledRt()).toBe(false);
  });
});

describe("rtSelfArgv", () => {
  test("compiled: the binary alone", () => {
    expect(rtSelfArgv({ compiled: true, execPath: "/Apps/mattstack.app/Contents/Helpers/rt" })).toEqual(["/Apps/mattstack.app/Contents/Helpers/rt"]);
  });
  test("source: bun plus the entry script", () => {
    expect(rtSelfArgv({ compiled: false, execPath: "/opt/bun", main: "/repo/cli.ts" })).toEqual(["/opt/bun", "/repo/cli.ts"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test lib/__tests__/rt-self.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`lib/rt-self.ts`:

```ts
import { fileURLToPath } from "url";

/** Every module of the compiled binary is served from /$bunfs; execPath's basename cannot tell (it is `bun` from source and anything a user renames). */
export function isCompiledRt(moduleUrl: string = import.meta.url): boolean {
  return fileURLToPath(moduleUrl).startsWith("/$bunfs");
}

/** Argv prefix that runs this same rt: from source, execPath is bun and Bun.main is cli.ts. */
export function rtSelfArgv(opts: { compiled?: boolean; execPath?: string; main?: string } = {}): string[] {
  const execPath = opts.execPath ?? process.execPath;
  return (opts.compiled ?? isCompiledRt()) ? [execPath] : [execPath, opts.main ?? Bun.main];
}
```

In `commands/home.ts`, replace the body of `rtSelfBin`:

```ts
function rtSelfBin(): string {
  return isCompiledRt() ? process.execPath : "rt";
}
```

and add `import { isCompiledRt } from "../lib/rt-self.ts";`. Remove the now-unused `fileURLToPath` import from `commands/home.ts` only if nothing else in the file uses it.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/__tests__/rt-self.test.ts commands/__tests__/home.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rt-self.ts lib/__tests__/rt-self.test.ts commands/home.ts
git commit -m "rt-self: one compiled check and a self-spawn argv"
```

---

### Task 4: The rt_verb handler and tool

**Files:**
- Create: `lib/mcp/rt-verb.ts`
- Modify: `lib/mcp/tools.ts` (header rule, register `rt_verb`)
- Test: `lib/mcp/__tests__/rt-verb.test.ts`; modify `lib/mcp/__tests__/tools.test.ts` (roster)

**Interfaces:**
- Consumes: `resolveLeaf`, `listAgentSafe` (Task 1); `rtSelfArgv` (Task 3); `execWithTimeout`, `ExecResult` from `lib/setup/probes.ts`.
- Produces: `runRtVerb(input: { args?: unknown; cwd?: unknown }, deps?: RtVerbDeps): Promise<{ ok: true; body: unknown } | { ok: false; error: string }>`; `RT_VERB_TIMEOUT_MS = 30_000`.

- [ ] **Step 1: Write the failing tests**

`lib/mcp/__tests__/rt-verb.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { CommandNode } from "../../command-tree.ts";
import type { ExecResult } from "../../setup/probes.ts";
import { RT_VERB_TIMEOUT_MS, runRtVerb, type RtVerbDeps } from "../rt-verb.ts";

const tree: Record<string, CommandNode> = {
  worktree: {
    description: "w",
    aliases: ["wt"],
    subcommands: {
      list: { description: "l", module: "./m.ts", agentSafe: true, args: [{ name: "Repo", flag: "--repo", type: "text" }, { name: "JSON", flag: "--json", type: "boolean" }] },
      dispose: { description: "d", module: "./m.ts" },
    },
  },
};

function deps(result: ExecResult, calls: { argv: string[]; opts: unknown }[] = []): RtVerbDeps {
  return {
    tree,
    selfArgv: () => ["/bin/rt"],
    isDir: (p) => p === "/work",
    spawn: async (argv, opts) => {
      calls.push({ argv, opts });
      return result;
    },
  };
}
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

describe("runRtVerb", () => {
  test("runs an agent-safe leaf with the full argv, cwd, env and timeout", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    const r = await runRtVerb({ args: ["worktree", "list", "--repo", "x"], cwd: "/work" }, deps(ok('{"worktrees":[]}'), calls));
    expect(r).toEqual({ ok: true, body: { worktrees: [] } });
    expect(calls[0]!.argv).toEqual(["/bin/rt", "worktree", "list", "--repo", "x", "--json"]);
    expect(calls[0]!.opts).toEqual({ cwd: "/work", env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" }, timeoutMs: RT_VERB_TIMEOUT_MS });
  });

  test("does not double --json and canonicalizes aliases", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    await runRtVerb({ args: ["wt", "list", "--json", "--repo=x"] }, deps(ok("{}"), calls));
    expect(calls[0]!.argv).toEqual(["/bin/rt", "worktree", "list", "--json", "--repo=x"]);
  });

  test("refuses a leading flag before any lookup", async () => {
    for (const args of [["--post-install", "worktree", "list"], ["--daemon"], ["-V"]]) {
      const r = await runRtVerb({ args }, deps(ok("{}")));
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toContain("worktree list");
    }
  });

  test("refuses a non-agent-safe leaf, a branch and an unknown verb, naming the allowed set", async () => {
    for (const args of [["worktree", "dispose"], ["worktree"], ["nope"]]) {
      const r = await runRtVerb({ args }, deps(ok("{}")));
      expect(r.ok ? "" : r.error).toContain("Agent-safe verbs: worktree list");
    }
  });

  test("refuses an undeclared flag, including a value that starts with a dash", async () => {
    for (const args of [["worktree", "list", "--prune"], ["worktree", "list", "--repo", "-x"]]) {
      const r = await runRtVerb({ args }, deps(ok("{}")));
      expect(r.ok).toBe(false);
    }
  });

  test("refuses a bad cwd and bad args", async () => {
    expect((await runRtVerb({ args: ["worktree", "list"], cwd: "rel" }, deps(ok("{}")))).ok).toBe(false);
    expect((await runRtVerb({ args: ["worktree", "list"], cwd: "/missing" }, deps(ok("{}")))).ok).toBe(false);
    expect((await runRtVerb({ args: [] }, deps(ok("{}")))).ok).toBe(false);
    expect((await runRtVerb({ args: "worktree list" }, deps(ok("{}")))).ok).toBe(false);
  });

  test("exit 2 surfaces the user-error envelope's message", async () => {
    const r = await runRtVerb({ args: ["worktree", "list"] }, deps({ code: 2, stdout: '{"contract":1,"error":{"code":"x","message":"no such repo"}}', stderr: "" }));
    expect(r).toEqual({ ok: false, error: "no such repo" });
  });

  test("exit 1 with {error} on stdout surfaces it; plain text surfaces the text", async () => {
    const a = await runRtVerb({ args: ["worktree", "list"] }, deps({ code: 1, stdout: '{"error":"registry unreadable"}', stderr: "" }));
    expect(a.ok ? "" : a.error).toContain("registry unreadable");
    const b = await runRtVerb({ args: ["worktree", "list"] }, deps({ code: 1, stdout: "daemon not running", stderr: "" }));
    expect(b.ok ? "" : b.error).toContain("daemon not running");
  });

  test("a timeout, a crash and non-JSON success are short errors", async () => {
    const t = await runRtVerb({ args: ["worktree", "list"] }, deps({ code: 124, stdout: "", stderr: "" }));
    expect(t.ok ? "" : t.error).toContain("timed out");
    const c = await runRtVerb({ args: ["worktree", "list"] }, deps({ code: 139, stdout: "", stderr: "x".repeat(2000) }));
    expect(c.ok ? "" : c.error.length).toBeLessThan(500);
    const n = await runRtVerb({ args: ["worktree", "list"] }, deps(ok("not json")));
    expect(n.ok).toBe(false);
  });
});
```

In `lib/mcp/__tests__/tools.test.ts`, add `"rt_verb"` to `NAMES`, change the roster count test to `16`, and rename it `"roster has 16 tools"`.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test lib/mcp/__tests__/rt-verb.test.ts lib/mcp/__tests__/tools.test.ts`
Expected: FAIL, cannot find module `../rt-verb.ts`; roster mismatch.

- [ ] **Step 3: Implement the handler**

`lib/mcp/rt-verb.ts`:

```ts
import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { TREE } from "../command-tree-def.ts";
import type { CommandNode } from "../command-tree.ts";
import { listAgentSafe, resolveLeaf } from "../command-tree-resolve.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { execWithTimeout, type ExecResult } from "../setup/probes.ts";

export const RT_VERB_TIMEOUT_MS = 30_000;
const TAIL_BYTES = 400;

export interface RtVerbDeps {
  tree: Record<string, CommandNode>;
  selfArgv: () => string[];
  isDir: (path: string) => boolean;
  spawn: (argv: string[], opts: { cwd?: string; env: Record<string, string>; timeoutMs: number }) => Promise<ExecResult>;
}

export function realRtVerbDeps(): RtVerbDeps {
  return {
    tree: TREE,
    selfArgv: () => rtSelfArgv(),
    isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
    spawn: (argv, opts) => execWithTimeout(argv, opts),
  };
}

type RtVerbResult = { ok: true; body: unknown } | { ok: false; error: string };

const fail = (error: string): RtVerbResult => ({ ok: false, error });

function tail(text: string): string {
  const t = text.trim();
  return t.length > TAIL_BYTES ? `...${t.slice(-TAIL_BYTES)}` : t;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function errorText(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const e = (value as { error: unknown }).error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
  return null;
}

export async function runRtVerb(input: { args?: unknown; cwd?: unknown }, deps: RtVerbDeps = realRtVerbDeps()): Promise<RtVerbResult> {
  const { args } = input;
  if (!Array.isArray(args) || args.length === 0 || !args.every((a) => typeof a === "string")) {
    return fail("args must be a non-empty array of strings, without the leading rt");
  }
  const allowed = `Agent-safe verbs: ${listAgentSafe(deps.tree).map((e) => e.path.join(" ")).join(", ")}`;
  // cli.ts matches --daemon, --post-install, --grant-fda and --version only at args[0].
  if (args[0]!.startsWith("-")) return fail(`args[0] must name a verb, not a flag. ${allowed}`);

  const leaf = resolveLeaf(deps.tree, args);
  if (!leaf || leaf.node.subcommands || !leaf.node.agentSafe) return fail(`"${args.join(" ")}" is not an agent-safe rt verb. ${allowed}`);

  const verb = `rt ${leaf.path.join(" ")}`;
  const declared = new Set(["--json", ...(leaf.node.args ?? []).flatMap((a) => (a.flag ? [a.flag] : []))]);
  for (const arg of leaf.rest) {
    if (!arg.startsWith("-")) continue;
    const name = arg.split("=")[0]!;
    if (!declared.has(name)) return fail(`${verb} does not declare ${name}. Declared flags: ${[...declared].join(", ")}`);
  }

  let cwd: string | undefined;
  if (input.cwd !== undefined) {
    if (typeof input.cwd !== "string" || !isAbsolute(input.cwd) || !deps.isDir(input.cwd)) {
      return fail("cwd must be an absolute path to an existing directory");
    }
    cwd = input.cwd;
  }

  const rest = leaf.rest.includes("--json") ? leaf.rest : [...leaf.rest, "--json"];
  const res = await deps.spawn([...deps.selfArgv(), ...leaf.path, ...rest], {
    cwd,
    env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" },
    timeoutMs: RT_VERB_TIMEOUT_MS,
  });

  const parsed = parseJson(res.stdout);
  if (res.code === 0) return parsed.ok ? { ok: true, body: parsed.value } : fail(`${verb} returned non-JSON output: ${tail(res.stdout)}`);
  if (res.code === 124) return fail(`${verb} timed out after ${RT_VERB_TIMEOUT_MS / 1000}s`);
  const envelopeMessage = parsed.ok ? errorText(parsed.value) : null;
  if (res.code === 2 && envelopeMessage) return fail(envelopeMessage);
  const detail = envelopeMessage ?? (tail(res.stderr) || tail(res.stdout));
  return fail(`${verb} failed (exit ${res.code})${detail ? `: ${detail}` : ""}`);
}
```

Check `execWithTimeout`'s option names against `lib/setup/probes.ts:71` (`cwd`, `timeoutMs`, `env`) and its timeout exit code (the tool rows treat `124` as timed out); adjust the `124` branch if the helper reports timeouts differently, and update the test to match.

- [ ] **Step 4: Register the tool**

In `lib/mcp/tools.ts`, change the header comment's first sentence to:

```ts
/**
 * The MCP tool roster: one McpToolDef per tool, each a thin wrapper over an
 * existing daemon command, except rt_verb, which runs agent-safe CLI leaves
 * (some reads, a setting or a file, need no daemon, and putting one in their
 * path would make a daemon outage cost the caller the read).
```

keeping the rest of the header. Add `import { runRtVerb } from "./rt-verb.ts";` and append to the array `mcpTools()` returns:

```ts
    {
      name: "rt_verb",
      description: "Run one read-only rt verb and return its --json result. Only verbs marked agent-safe run; anything else is refused with the list of verbs that do. Pass args without the leading \"rt\" (e.g. [\"worktree\", \"list\"]) and cwd when the verb depends on the current repo, since this server's working directory is fixed at session start and does not follow cd or EnterWorktree.",
      inputSchema: {
        type: "object",
        properties: {
          args: { type: "array", items: { type: "string" }, minItems: 1 },
          cwd: { type: "string", description: "Absolute directory to run in; defaults to the server's own." },
        },
        required: ["args"],
      },
      handler: async (input) => {
        const r = await runRtVerb(input);
        return r.ok ? ok(r.body) : err(r.error);
      },
    },
```

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/rt-verb.ts lib/mcp/tools.ts lib/mcp/__tests__/rt-verb.test.ts lib/mcp/__tests__/tools.test.ts
git commit -m "mcp: rt_verb runs agent-safe rt verbs"
```

---

### Task 5: End to end over the compiled binary

**Files:**
- Modify: `e2e/tests/mcp-serve.test.ts`

- [ ] **Step 1: Write the failing e2e**

Add `"rt_verb"` to `EXPECTED_TOOL_NAMES`. Add a test inside the `describe` block, after the existing one:

```ts
  test("rt_verb runs worktree list the same as the CLI and refuses a leading flag", async () => {
    const server = runRtPiped(["mcp", "serve"], home);
    const client = new McpClient(server);
    try {
      await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "rt-e2e", version: "0.0.0" } });
      client.notify("notifications/initialized");

      const call = await client.request("tools/call", { name: "rt_verb", arguments: { args: ["worktree", "list"] } });
      expect(call.error).toBeUndefined();
      const result = call.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBeUndefined();

      const cli = runRt(["worktree", "list", "--json"], home);
      const cliOut = await new Response(cli.stdout as ReadableStream).text();
      await cli.exited;
      expect(JSON.parse(result.content[0]!.text)).toEqual(JSON.parse(cliOut));

      const refused = await client.request("tools/call", { name: "rt_verb", arguments: { args: ["--post-install", "worktree", "list"] } });
      const refusedResult = refused.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(refusedResult.isError).toBe(true);
      expect(refusedResult.content[0]!.text).toContain("Agent-safe verbs:");
    } finally {
      server.stdin.end();
      await server.exited;
    }
  });
```

Match the existing test's teardown and the `runRt` helper's stdout handling in this file (read the first test's `finally` block and `runRt`'s return shape, and use the same idioms); the snippet above shows intent, not the file's exact helper names where they differ.

- [ ] **Step 2: Run the e2e**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/mcp-serve.test.ts`
(the preload rebuilds `dist/rt` whenever it is older than the sources, and the
harness runs it under a temp HOME; never run the built binary against the real
HOME).
Expected: PASS. Both tests pass, and every stdout line is still JSON-RPC.

- [ ] **Step 3: Full suite**

Run: `bun run test:all`
Expected: PASS. Rerun any failure on `main` before calling it pre-existing.

- [ ] **Step 4: Commit and open the PR**

```bash
git add e2e/tests/mcp-serve.test.ts
git commit -m "e2e: rt_verb over the compiled mcp serve"
git push -u origin HEAD
gh pr create --title "RT-244: rt_verb, a curated MCP tool for agent-safe rt verbs" --body "<what it adds, the agent-safe bar and gate test, the launch set, the self-spawn helper, and test evidence>"
```

Wait for CodeRabbit's review and address every actionable finding, and wait for CI to go green. The distribution lane reviews. Merge only with the operator's confirmation.
