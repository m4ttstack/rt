import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type { CommandNode } from "../../command-tree.ts";
import type { ExecResult } from "../../setup/probes.ts";
import { RT_VERB_TIMEOUT_MS, runRtVerb, type RtVerbDeps } from "../rt-verb.ts";

/** A real directory standing in for the Claude Code temp root -- checkTempRootPath realpaths the parent, so the root must actually exist on disk. */
const FAKE_TEMP_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-verb-out-")));
/** Stands in for an installed plugin root; the read guard realpaths the file, so it must exist. */
const FAKE_PLUGIN_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-verb-plugin-")));
const OUTSIDE = realpathSync(mkdtempSync(join(tmpdir(), "rt-verb-outside-")));
const TEMPLATE = join(FAKE_PLUGIN_ROOT, "job-template.md");
const SECRET = join(OUTSIDE, "id_ed25519");
const ESCAPE_LINK = join(FAKE_PLUGIN_ROOT, "escape.md");
writeFileSync(TEMPLATE, "template");
writeFileSync(SECRET, "PRIVATE KEY");
symlinkSync(SECRET, ESCAPE_LINK);

afterAll(() => {
  for (const dir of [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT, OUTSIDE]) rmSync(dir, { recursive: true, force: true });
});

const tree: Record<string, CommandNode> = {
  worktree: {
    description: "w",
    aliases: ["wt"],
    subcommands: {
      list: { description: "l", module: "./m.ts", agentSafe: true, args: [{ name: "Repo", flag: "--repo", type: "text" }, { name: "JSON", flag: "--json", type: "boolean" }] },
      dispose: { description: "d", module: "./m.ts" },
      slow: { description: "s", module: "./m.ts", agentSafe: true, agentTimeoutMs: 600_000, args: [{ name: "JSON", flag: "--json", type: "boolean" }] },
      brief: {
        description: "b", module: "./m.ts", agentSafe: true, agentTempRootFlags: ["--out"], agentReadRootFlags: ["--template"],
        args: [{ name: "Out", flag: "--out", type: "text" }, { name: "Template", flag: "--template", type: "text" }, { name: "JSON", flag: "--json", type: "boolean" }],
      },
    },
  },
};

function deps(result: ExecResult, calls: { argv: string[]; opts: unknown }[] = [], tempRoots: string[] = [FAKE_TEMP_ROOT], readRoots: string[] = [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT]): RtVerbDeps {
  return {
    tree,
    selfArgv: () => ["/bin/rt"],
    isDir: (p) => p === "/work",
    spawn: async (argv, opts) => {
      calls.push({ argv, opts });
      return result;
    },
    tempRoots: () => tempRoots,
    readRoots: () => ({ roots: readRoots }),
  };
}
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

async function refused(input: { args?: unknown; cwd?: unknown }) {
  const calls: { argv: string[]; opts: unknown }[] = [];
  const r = await runRtVerb(input, deps(ok("{}"), calls));
  expect(calls).toEqual([]);
  return r;
}

describe("runRtVerb", () => {
  test("runs an agent-safe leaf with the full argv, cwd, env and timeout", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    const r = await runRtVerb({ args: ["worktree", "list", "--repo", "x"], cwd: "/work" }, deps(ok('{"worktrees":[]}'), calls));
    expect(r).toEqual({ ok: true, body: { worktrees: [] } });
    expect(calls[0]!.argv).toEqual(["/bin/rt", "worktree", "list", "--repo", "x", "--json"]);
    expect(calls[0]!.opts).toEqual({ cwd: "/work", env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" }, timeoutMs: RT_VERB_TIMEOUT_MS });
  });

  test("a leaf's agentTimeoutMs replaces the default cap", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    await runRtVerb({ args: ["worktree", "slow"] }, deps(ok("{}"), calls));
    expect((calls[0]!.opts as { timeoutMs: number }).timeoutMs).toBe(600_000);
  });

  test("a timed-out leaf's own cap names the timeout, not the default", async () => {
    const r = await runRtVerb({ args: ["worktree", "slow"] }, deps({ code: 124, stdout: "", stderr: "" }));
    expect(r.ok ? "" : r.error).toContain("timed out after 600s");
    expect(r.ok ? "" : r.error).not.toContain("30s");
  });

  test("agentTempRootFlags: a value inside the temp root passes through, both --name value and --name=value", async () => {
    const out = join(FAKE_TEMP_ROOT, "brief.md");
    const a = await runRtVerb({ args: ["worktree", "brief", "--out", out] }, deps(ok("{}")));
    expect(a.ok).toBe(true);
    const b = await runRtVerb({ args: ["worktree", "brief", `--out=${out}`] }, deps(ok("{}")));
    expect(b.ok).toBe(true);
  });

  test("agentTempRootFlags: a value outside the temp root is refused with zero spawn calls, both flag forms", async () => {
    const outside = join(realpathSync(homedir()), ".zshrc");
    const a = await refused({ args: ["worktree", "brief", "--out", outside] });
    expect(a.ok ? "" : a.error).toContain("temp root");
    const b = await refused({ args: ["worktree", "brief", `--out=${outside}`] });
    expect(b.ok ? "" : b.error).toContain("temp root");
  });

  test("agentTempRootFlags: a relative value is refused with zero spawn calls", async () => {
    const r = await refused({ args: ["worktree", "brief", "--out", "relative/brief.md"] });
    expect(r.ok).toBe(false);
  });

  test("agentReadRootFlags: a file inside an allowed read root passes through, both --name value and --name=value", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    const a = await runRtVerb({ args: ["worktree", "brief", "--template", TEMPLATE] }, deps(ok("{}"), calls));
    expect(a.ok).toBe(true);
    const b = await runRtVerb({ args: ["worktree", "brief", `--template=${TEMPLATE}`] }, deps(ok("{}"), calls));
    expect(b.ok).toBe(true);
    expect(calls.map((c) => c.argv.slice(3, 5))).toEqual([["--template", TEMPLATE], ["--template", TEMPLATE]]);
  });

  test("agentReadRootFlags: a file outside every read root is refused with zero spawn calls, both flag forms", async () => {
    const a = await refused({ args: ["worktree", "brief", "--template", SECRET] });
    expect(a.ok ? "" : a.error).toContain("--template");
    expect(a.ok ? "" : a.error).toContain("plugin or pack root");
    const b = await refused({ args: ["worktree", "brief", `--template=${SECRET}`] });
    expect(b.ok ? "" : b.error).toContain("plugin or pack root");
  });

  test("agentReadRootFlags: a relative value is refused with zero spawn calls", async () => {
    const r = await refused({ args: ["worktree", "brief", "--template", "job-template.md"] });
    expect(r.ok ? "" : r.error).toContain("absolute");
  });

  test("agentReadRootFlags: a symlink inside a read root pointing outside is refused with zero spawn calls", async () => {
    const r = await refused({ args: ["worktree", "brief", "--template", ESCAPE_LINK] });
    expect(r.ok ? "" : r.error).toContain("plugin or pack root");
  });

  test("agentTempRootFlags does not affect a flag it does not name", async () => {
    const outside = join(realpathSync(homedir()), ".zshrc");
    const calls: { argv: string[]; opts: unknown }[] = [];
    const r = await runRtVerb({ args: ["worktree", "list", "--repo", outside] }, deps(ok("{}"), calls));
    expect(r.ok).toBe(true);
    expect(calls[0]!.argv).toContain(outside);
  });

  test("does not double --json and canonicalizes aliases", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    await runRtVerb({ args: ["wt", "list", "--json", "--repo=x"] }, deps(ok("{}"), calls));
    expect(calls[0]!.argv).toEqual(["/bin/rt", "worktree", "list", "--json", "--repo", "x"]);
  });

  test("refuses --name=value on a boolean flag and a dash-leading value after =", async () => {
    for (const args of [["worktree", "list", "--repo=-x"], ["worktree", "list", "--json=false"]]) {
      const r = await refused({ args });
      expect(r.ok, args.join(" ")).toBe(false);
    }
  });

  test("refuses a leading flag before any lookup", async () => {
    for (const args of [["--post-install", "worktree", "list"], ["--daemon"], ["-V"]]) {
      const r = await refused({ args });
      expect(r.ok ? "" : r.error).toContain("must name a verb, not a flag");
      expect(r.ok ? "" : r.error).toContain("worktree list");
    }
  });

  test("refuses a non-agent-safe leaf, a branch and an unknown verb, naming the allowed set", async () => {
    for (const args of [["worktree", "dispose"], ["worktree"], ["nope"], ["worktree", "--json", "list"]]) {
      const r = await refused({ args });
      expect(r.ok ? "" : r.error).toContain("Agent-safe verbs: worktree list");
    }
  });

  test("refuses an undeclared flag, including a value that starts with a dash", async () => {
    for (const args of [["worktree", "list", "--prune"], ["worktree", "list", "--repo", "-x"], ["worktree", "list", "--"], ["worktree", "list", "-rj"]]) {
      const r = await refused({ args });
      expect(r.ok, args.join(" ")).toBe(false);
    }
  });

  test("refuses a declared text flag with no following value, rather than silently widening scope", async () => {
    for (const args of [["worktree", "list", "--repo"], ["worktree", "list", "--repo", "--json"], ["worktree", "list", "--repo", ""], ["worktree", "list", "--repo="]]) {
      const r = await refused({ args });
      expect(r.ok, args.join(" ")).toBe(false);
    }
  });

  test("refuses an arg carrying a control character before the walk", async () => {
    for (const args of [["worktree", "list", "--repo", "a\u0000b"], ["worktree\u0000", "list"], ["worktree", "list", "--repo", "a\nb"], ["worktree", "list", "--repo", "a\u007fb"]]) {
      const r = await refused({ args });
      expect(r.ok ? "" : r.error, JSON.stringify(args)).toContain("control character");
    }
  });

  test("refuses a bad cwd and bad args", async () => {
    expect((await refused({ args: ["worktree", "list"], cwd: "rel" })).ok).toBe(false);
    expect((await refused({ args: ["worktree", "list"], cwd: "/missing" })).ok).toBe(false);
    expect((await refused({ args: [] })).ok).toBe(false);
    expect((await refused({ args: "worktree list" })).ok).toBe(false);
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
