/**
 * The worktree CLI is the SENDER side of the identity re-key — it must
 * serialize identities into daemon payloads and reverse-resolve `--repo`
 * (name/path/identity) the same way, or the daemon's now identity-only
 * handlers silently stop matching anything this CLI sends.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { repoLabel, worktreeAwaitReady, worktreeDispose, worktreeFreshen, worktreeList, worktreeProvision, worktreeTriage } from "../worktree.ts";
import { getRepoIdentity } from "../../lib/repo.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";

// mock.module mutates the live "../../lib/daemon-client.ts" namespace object
// IN PLACE, so `realDaemonClient.daemonQuery` itself becomes the mock the
// moment one is installed — restoring with `() => realDaemonClient` would
// restore the mock to itself. Capture the individual real bindings BEFORE
// any mock.module call in this file, and restore with THOSE.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realLastQueryTimedOut = realDaemonClient.lastQueryTimedOut;

interface Captured {
  cmd: string;
  payload?: Record<string, unknown>;
}

function installFakeDaemon(response: DaemonResponse): Captured[] {
  const calls: Captured[] = [];
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
      calls.push({ cmd, payload });
      return response;
    },
    lastQueryTimedOut: () => false,
  }));
  return calls;
}

describe("worktree CLI identity plumbing", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let reposRoot: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-cli-home-")));
    reposRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-cli-repos-")));
    process.env.HOME = home;
    closeStateDb();
    process.chdir(home); // neutral cwd: no repo directory lives under here
  });

  afterEach(() => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: realDaemonQuery,
      lastQueryTimedOut: realLastQueryTimedOut,
    }));
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  function makeGitRepo(name: string): string {
    const dir = realpathSync(mkdtempSync(join(reposRoot, `${name}-`)));
    execSync("git init -q -b main", { cwd: dir });
    return dir;
  }

  test("in-repo default sends the SERIALIZED IDENTITY to the daemon, not a bare basename", async () => {
    const repoPath = makeGitRepo("provision-repo");
    process.chdir(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "t", path: "p", branch: "b", branchState: "new" },
    });

    await worktreeProvision(["--ticket", "RT-1", "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:provision");
    expect(call).toBeDefined();
    expect(call!.payload!.repoName).toMatch(/^(remote|path):/);
    expect(call!.payload!.repoName).toBe(identity);
    // Never the plain directory basename — that's the display name, not the key.
    expect(call!.payload!.repoName).not.toBe(basename(repoPath));
  });

  test("--repo <name> reverse-resolves to the identity for a repo registered under an identity key", async () => {
    const repoPath = makeGitRepo("named-repo");
    // Visiting the repo once (as any rt command would) is what populates the
    // identity-keyed index resolveRepoArg's name-lookup branch reads.
    process.chdir(repoPath);
    const identity = getRepoIdentity()!.identity;
    process.chdir(home); // leave the repo — --repo must do the resolving, not cwd

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", basename(repoPath), "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("--repo <path> derives the identity from the directory", async () => {
    const repoPath = makeGitRepo("path-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", repoPath, "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("--repo <already-serialized-identity> passes through unchanged", async () => {
    const repoPath = makeGitRepo("identity-arg-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", identity, "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("provision --wait sends wait:true; without the flag the payload carries no wait", async () => {
    const repoPath = makeGitRepo("provision-wait-repo");
    process.chdir(repoPath);
    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "t", path: "p", branch: "b", branchState: "new" },
    });

    await worktreeProvision(["--branch", "rt-96-x", "--wait", "--json"], {});
    await worktreeProvision(["--branch", "rt-96-y", "--json"], {});

    const [withWait, withoutWait] = calls.filter((c) => c.cmd === "worktree:provision");
    expect(withWait!.payload!.wait).toBe(true);
    expect(withoutWait!.payload!.wait).toBeUndefined();
  });

  test("await-ready sends the serialized identity and tree name to worktree:await-ready", async () => {
    const repoPath = makeGitRepo("await-repo");
    process.chdir(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "p", ready: true, readyAt: "2026-09-01T00:00:00.000Z" },
    });

    await worktreeAwaitReady(["alpha", "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:await-ready");
    expect(call).toBeDefined();
    expect(call!.payload!.repoName).toBe(identity);
    expect(call!.payload!.tree).toBe("alpha");
  });

  test("await-ready reports unfinished readiness without printing an undefined step name", async () => {
    const repoPath = makeGitRepo("await-pending-repo");
    process.chdir(repoPath);
    // Not-ready with no failedStep is the still-pending case (the settle never
    // got the tree lock), not a failed step.
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "p", ready: false, readyAt: null },
    });

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await worktreeAwaitReady(["alpha"], {});
    } finally {
      console.log = origLog;
      process.exitCode = 0;
    }

    const out = lines.join("\n");
    expect(out).not.toContain("undefined");
    expect(out).toContain("alpha");
  });

  test("await-ready picker carries the rt worktree await-ready in-card breadcrumb (dispatcher header stays suppressed)", async () => {
    const { installFakePick } = await import("../../lib/ui/pick-fake.ts");
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async (cmd: string) => {
        if (cmd === "worktree:list") {
          return {
            ok: true,
            data: { trees: [{ name: "alpha", path: "/p/alpha", kind: "ephemeral", state: "claimed", branch: null, repoName: "r1" }] },
          };
        }
        return { ok: true, data: { tree: "alpha", path: "/p/alpha", ready: true, readyAt: "2026-09-01T00:00:00.000Z" } };
      },
      lastQueryTimedOut: () => false,
    }));

    const fake = installFakePick([{ kind: "result", result: { action: "select", value: "/p/alpha", query: "" } }]);
    try {
      await worktreeAwaitReady([], {});
    } finally {
      fake.restore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.request.breadcrumb).toEqual(["rt", "worktree", "await-ready"]);
  });

  test("an unresolvable --repo exits with a clear message instead of sending a bogus key to the daemon", async () => {
    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = mock(() => {
      throw new Error("process.exit sentinel");
    });
    const originalExit = process.exit;
    process.exit = exitSpy as unknown as typeof process.exit;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); };

    try {
      await expect(worktreeList(["--repo", "no-such-repo-anywhere", "--json"], {})).rejects.toThrow();
    } finally {
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(calls.find((c) => c.cmd === "worktree:list")).toBeUndefined();
    expect(logs.some((l) => l.includes("no-such-repo-anywhere"))).toBe(true);
  });

  test("JSON output includes readyHeldRepos alongside trees", async () => {
    installFakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/foo"] } });
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); };

    try {
      await worktreeList(["--json"], {});
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.readyHeldRepos).toEqual(["path:/foo"]);
  });

  test("held-repo notice prints even when there are no worktrees", async () => {
    installFakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/foo"] } });
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); };

    try {
      await worktreeList([], {});
    } finally {
      console.log = originalLog;
    }

    expect(logs.some((l) => l.includes("held pending approval"))).toBe(true);
  });

  test("a running-run dispose refusal prints the run id and abandon pointer", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        disposed: [],
        refused: [{ tree: "tree-a", reason: "running-run", detail: "running run run-1 at implement; rt runs abandon run-1" }],
        recoverable: [],
      },
    });
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); };

    try {
      await worktreeDispose(["tree-a"], {});
    } finally {
      console.log = originalLog;
    }

    expect(logs.some((l) =>
      l.includes("tree-a") &&
      l.includes("running-run") &&
      l.includes("running run run-1 at implement; rt runs abandon run-1"),
    )).toBe(true);
  });

  test("list labels the golden row by kind, not its on-deck state", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/nonexistent/golden", kind: "golden", state: "on-deck", branch: null, repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await worktreeList([], {});
    } finally {
      console.log = origLog;
    }
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    const row = plain.find((l) => l.includes("/golden "));
    expect(row).toBeDefined();
    expect(row).toMatch(/\/golden\s+golden\s+\(detached\)/);
    expect(row).not.toContain("on-deck");
  });

  test("list names why a disposable tree stayed and why a merged claim is held", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "beacon", path: "/nonexistent/beacon", kind: "ephemeral", state: "disposable", disposableReason: "dirty", branch: "team-step-cards", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "smaug", path: "/nonexistent/smaug", kind: "ephemeral", state: "claimed", heldReason: "pid 75703 (xctest) has its cwd inside", branch: "daemon-restart-truth", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z", mr: { iid: 361, state: "merged", title: "t" } },
          { name: "gollum", path: "/nonexistent/gollum", kind: "ephemeral", state: "claimed", heldReason: "left over from an evicted MR", branch: "recut", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z", mr: null },
        ],
      },
    });
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await worktreeList([], {});
    } finally {
      console.log = origLog;
    }
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain.find((l) => l.includes("/beacon "))).toContain("disposable (dirty)");
    expect(plain.find((l) => l.includes("/smaug "))).toContain("held: pid 75703 (xctest) has its cwd inside");
    expect(plain.find((l) => l.includes("/gollum "))).not.toContain("held:");
  });

  test("freshen's picker offers the golden alongside on-deck members", async () => {
    const { installFakePick } = await import("../../lib/ui/pick-fake.ts");
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "lupin", path: "/l", kind: "ephemeral", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "hedwig", path: "/h", kind: "ephemeral", state: "claimed", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await worktreeFreshen([], {});
    } finally {
      fake.restore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
    expect(fake.calls).toHaveLength(1);
    const values = fake.calls[0]!.request.rows.map((r) => r.value);
    expect(values).toContain("/g");
    expect(values).toContain("/l");
    expect(values).not.toContain("/h");
  });

  test("triage prints one line per row with its group and verdict, and --json passes the payload through", async () => {
    const data = {
      rows: [{ repo: "github.com/acme/app", tree: "olive", path: "/x", branch: "b", mr: { iid: 47, state: "merged", title: "sync button", at: null }, ticket: null,
        push: { kind: "in-main" }, containment: "in-default", dirt: { kind: "junk", files: [".visual/a.png"] }, group: "safe",
        verdict: "Every commit is in main. Only generated files are left.", actions: ["dispose"], fingerprint: { headSha: "h", dirtHash: "d", mrState: "merged" } }],
      banners: [], counts: { needsDecision: 1, safe: 1, waiting: 0, kept: 0 },
    };
    installFakeDaemon({ ok: true, data });
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { await worktreeTriage([], {}); await worktreeTriage(["--json"], {}); } finally { console.log = orig; }
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain.some((l) => l.includes("olive") && l.includes("safe") && l.includes("Every commit is in main."))).toBe(true);
    expect(plain.some((l) => l.includes("1 worktree needs a decision"))).toBe(true);
    expect(plain.some((l) => l.includes("#47 merged"))).toBe(true);
    expect(JSON.parse(plain[plain.length - 1]!).counts.needsDecision).toBe(1);
  });
});

describe("repoLabel", () => {
  test("decodes a remote identity to its trailing path segment", () => {
    expect(repoLabel("remote:gitlab.com%2Fg%2Frepo")).toBe("repo");
  });

  test("decodes a path identity to its basename", () => {
    expect(repoLabel(`path:${encodeURIComponent("/Users/matt/repo-tools")}`)).toBe("repo-tools");
  });

  test("a value that isn't a serialized identity passes through unchanged", () => {
    expect(repoLabel("not-an-identity")).toBe("not-an-identity");
  });
});
