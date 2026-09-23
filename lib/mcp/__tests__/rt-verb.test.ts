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
    expect(calls[0]!.argv).toEqual(["/bin/rt", "worktree", "list", "--json", "--repo", "x"]);
  });

  test("refuses --name=value on a boolean flag and a dash-leading value after =", async () => {
    for (const args of [["worktree", "list", "--repo=-x"], ["worktree", "list", "--json=false"]]) {
      const calls: { argv: string[]; opts: unknown }[] = [];
      const r = await runRtVerb({ args }, deps(ok("{}"), calls));
      expect(r.ok, args.join(" ")).toBe(false);
      expect(calls).toEqual([]);
    }
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
