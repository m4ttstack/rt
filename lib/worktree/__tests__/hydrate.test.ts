import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { machineSettingsPath } from "../../rt-paths.ts";
import { deriveRepoIdentity } from "../../settings/identity.ts";
import { closeStateDb } from "../../state/index.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../registry.ts";
import { listWorktreesAsync, branchExistsLocalAsync } from "../git-async.ts";
import * as gitAsync from "../git-async.ts";
import { createTree, type CreateDeps } from "../create.ts";
import { isTreeLocked, tryLockTree } from "../locks.ts";
import { hydrateTree, parseIgnoredPaths, listIgnoredPaths, type CloneRunner } from "../hydrate.ts";
import { clonePath, cloneExitCode } from "../clonefile.ts";

function readMachineStore(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(machineSettingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeMachineStore(obj: Record<string, unknown>): void {
  mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
  writeFileSync(machineSettingsPath(), JSON.stringify(obj));
}

/**
 * Gives `repoPath` a resolvable settings identity, pinning its (local
 * bare-clone) origin via the machine store's `rt.repoIdentityOverrides` when
 * it doesn't itself normalize... exactly the fork/local-remote mechanism
 * production uses.
 */
async function ensureIdentity(repoPath: string, repoName: string): Promise<string> {
  const remote = execSync("git config --get remote.origin.url", { cwd: repoPath, encoding: "utf8" }).trim();
  const direct = await deriveRepoIdentity(repoPath);
  if (direct.kind === "remote") return direct.id;

  const identity = `rttest.local/${repoName}`;
  const store = readMachineStore();
  const overrides = { ...(store["rt.repoIdentityOverrides"] as Record<string, string> ?? {}), [remote]: identity };
  writeMachineStore({ ...store, "rt.repoIdentityOverrides": overrides });
  return identity;
}

/** Seeds `rt.worktrees` for `repoPath` in the machine store... the store-only replacement for the old per-repo config.json fixture. */
async function declareWorktrees(repoPath: string, repoName: string, declared: unknown): Promise<void> {
  const identity = await ensureIdentity(repoPath, repoName);
  const store = readMachineStore();
  const repos = { ...(store.repos as Record<string, unknown> ?? {}), [identity]: { "rt.worktrees": declared } };
  writeMachineStore({ ...store, repos });
}

function makeRepo(): string {
  // realpathSync: git canonicalizes /var -> /private/var on macOS (Global Constraints)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtcreate-")));
  execSync(
    "git init -b main && git -c user.email=t@t -c user.name=t commit --allow-empty -m init",
    { cwd: dir, shell: "/bin/zsh" }
  );
  return dir;
}

/** Bare-clone `repo` as its own "origin" and fetch, so remoteDefaultRef resolves origin/main. */
function addBareOrigin(repo: string): void {
  const bare = mkdtempSync(join(tmpdir(), "rtcreate-bare-"));
  execSync(
    `git clone --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch origin`,
    { shell: "/bin/zsh" }
  );
}

function makeDeps(repoName: string, repoPath: string, events: Array<{ type: string; data: unknown }>): CreateDeps {
  return {
    repoName,
    repoPath,
    emit: (type, data) => events.push({ type, data }),
    log: { info: () => {}, warn: () => {} },
  };
}

const inProcessClone: CloneRunner = async (src, dst) => {
  const r = clonePath(src, dst);
  return { exitCode: cloneExitCode(r), stderr: r.ok ? "" : `clonefile: ${r.message}` };
};

describe("parseIgnoredPaths", () => {
  test("keeps !! records, strips trailing slash, drops logs and .git", () => {
    const out = [
      "!! node_modules/",
      "!! apps/backend/generated/",
      "!! apps/backend/newrelic_agent.log",
      "!! packages/x/tsconfig.tsbuildinfo",
      "?? untracked.txt",
      " M tracked.ts",
      "!! .git/hooks-cache/",
    ].join("\0") + "\0";
    expect(parseIgnoredPaths(out)).toEqual([
      "node_modules",
      "apps/backend/generated",
      "packages/x/tsconfig.tsbuildinfo",
    ]);
  });

  test("a path with a space survives verbatim (porcelain v1 would C-quote it)", () => {
    expect(parseIgnoredPaths("!! apps/my app/generated/\0")).toEqual(["apps/my app/generated"]);
  });
});

describe("hydrateTree", () => {
  let repo: string;
  let repoName: string;
  let events: Array<{ type: string; data: unknown }>;
  let golden: TreeRecord;

  beforeEach(async () => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rthydrate-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    repoName = "acme";
    events = [];
    writeFileSync(join(repo, ".gitignore"), "node_modules/\ngenerated/\n*.log\n");
    execSync("git add .gitignore && git -c user.email=t@t -c user.name=t commit -qm gitignore && git push -q origin HEAD", { cwd: repo, shell: "/bin/zsh" });
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [{ run: "touch .ready-ran" }] });
    const made = await createTree({ ...makeDeps(repoName, repo, events), target: "golden" });
    if (!made.ok) throw new Error("golden create failed");
    golden = made.tree;
    mkdirSync(join(golden.path, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(golden.path, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    mkdirSync(join(golden.path, "generated"));
    writeFileSync(join(golden.path, "generated", "types.ts"), "export type T = 1;\n");
    writeFileSync(join(golden.path, "debug.log"), "noise\n");
  });

  test("listIgnoredPaths on the golden returns its artifact set", async () => {
    const paths = await listIgnoredPaths(golden.path);
    expect(paths).toEqual(["generated", "node_modules"]);
  });

  test("the golden's own create ran its ready ladder (sentinel mechanism sanity check)", () => {
    expect(existsSync(join(golden.path, ".ready-ran"))).toBe(true);
  });

  test("happy path: member at golden sha, artifacts cloned, stamps inherited, no ready step run", async () => {
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: inProcessClone });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = result.tree;
    expect(t.kind).toBe("ephemeral");
    expect(t.state).toBe("on-deck");
    expect(t.branch).toBe(`on-deck/${t.name}`);
    expect(t.readyStamp).toBe(golden.readyStamp);
    expect(t.readyAt).toBe(golden.readyAt);
    expect(readFileSync(join(t.path, "node_modules", "pkg", "index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(readFileSync(join(t.path, "generated", "types.ts"), "utf8")).toBe("export type T = 1;\n");
    expect(existsSync(join(t.path, "debug.log"))).toBe(false);
    expect(existsSync(join(t.path, ".ready-ran"))).toBe(false);
    const head = execSync("git rev-parse HEAD", { cwd: t.path, encoding: "utf8" }).trim();
    expect(head).toBe(golden.readyStamp!);
    const wt = (await listWorktreesAsync(repo))!.find((w) => w.path === t.path);
    expect(wt?.branch).toBe(`on-deck/${t.name}`);
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(1);
    expect(
      events.some((e) => e.type === "worktree:created" && (e.data as { hydratedFrom?: string }).hydratedFrom === golden.name),
    ).toBe(true);
  });

  test("clone exit 3 reports hydrate-unavailable and scraps the half-built tree", async () => {
    // A fixed namePool makes the branch name deterministic: `git worktree
    // list` (used below) only shows branches still attached to a live
    // worktree, so it cannot tell a deleted branch from one whose ref
    // survived the scrap. Only a direct ref check can.
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [{ run: "touch .ready-ran" }], namePool: ["fixedname"] });
    const exdev: CloneRunner = async () => ({ exitCode: 3, stderr: "clonefile: Cross-device link" });
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: exdev });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "clonefile: Cross-device link" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
    const wts = (await listWorktreesAsync(repo))!;
    expect(wts.some((w) => w.branch?.startsWith("on-deck/"))).toBe(false);
    expect(await branchExistsLocalAsync(repo, "on-deck/fixedname")).toBe(false);
  });

  test("clone exit 1 is create-failed with the step named and scraps", async () => {
    const boom: CloneRunner = async () => ({ exitCode: 1, stderr: "clonefile: Input/output error" });
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: boom });
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "create-failed") throw new Error("wrong shape");
    expect(result.failedStep).toBe("hydrate-clone generated");
    expect(result.output).toContain("Input/output error");
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });

  test("the donor is enumerated and cloned under the donor's own tree lock", async () => {
    const seen: boolean[] = [];
    const watching: CloneRunner = async (src, dst) => {
      seen.push(isTreeLocked(golden.path));
      return inProcessClone(src, dst);
    };
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: watching });
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  test("the enumeration step itself runs under the donor lock, not just the clone loop after it", async () => {
    // The prior test only watches the clone runner, so a lock scoped to just
    // the clone loop (enumeration run before withTreeLock) would still pass
    // it. Watch the enumeration's own git call (`status --ignored`) instead.
    const realRunGit = gitAsync.runGit;
    const observed: { enumerationWasLocked: boolean | null } = { enumerationWasLocked: null };
    const spy = spyOn(gitAsync, "runGit").mockImplementation(async (cwd, args, opts) => {
      if (args[0] === "status" && args.includes("--ignored")) {
        observed.enumerationWasLocked = isTreeLocked(golden.path);
      }
      return realRunGit(cwd, args, opts);
    });
    try {
      const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: inProcessClone });
      expect(result.ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(observed.enumerationWasLocked).toBe(true);
  });

  test("a donor already locked by another pass is a hydrate failure, not a torn clone", async () => {
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [{ run: "touch .ready-ran" }], namePool: ["fixedname"] });
    const release = tryLockTree(golden.path);
    expect(release).not.toBeNull();
    let result;
    try {
      result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: inProcessClone });
    } finally {
      release!();
    }
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "hydrate-unavailable") throw new Error("expected hydrate-unavailable");
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
    const wts = (await listWorktreesAsync(repo))!;
    expect(wts.some((w) => w.branch?.startsWith("on-deck/"))).toBe(false);
    // `git worktree add -b` now runs inside the donor lock, so a busy lock
    // means the branch was never created at all; the direct ref check (not
    // `git worktree list`, which only sees branches still attached to a
    // live worktree) is what proves that rather than assumes it.
    expect(await branchExistsLocalAsync(repo, "on-deck/fixedname")).toBe(false);
  });

  test("a golden without readyStamp is refused before any git mutation", async () => {
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: { ...golden, readyStamp: undefined }, clone: inProcessClone });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "golden has no readyStamp" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });

  test("a donor that advances after the caller's read is not used stale: the member gets the fresh commit and fresh artifacts, not the caller's snapshot", async () => {
    // Simulates the race: `deps.golden` here plays the role of a registry row
    // a reconciler pass read before this hydrate started; the donor keeps
    // moving (freshen fast-forwards it) before the donor lock is acquired.
    const staleGolden = { ...golden };

    writeFileSync(join(golden.path, "node_modules", "pkg", "index.js"), "module.exports = 2;\n");
    execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m advance", { cwd: golden.path, shell: "/bin/zsh" });
    const advancedSha = execSync("git rev-parse HEAD", { cwd: golden.path, encoding: "utf8" }).trim();
    expect(advancedSha).not.toBe(staleGolden.readyStamp);
    const advancedAt = new Date(Date.now() + 1000).toISOString();
    saveRegistry(repoName, loadRegistry(repoName).map((t) =>
      t.path === golden.path ? { ...t, readyStamp: advancedSha, readyAt: advancedAt } : t,
    ));

    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: staleGolden, clone: inProcessClone });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = result.tree;
    expect(t.readyStamp).toBe(advancedSha);
    expect(t.readyAt).toBe(advancedAt);
    const head = execSync("git rev-parse HEAD", { cwd: t.path, encoding: "utf8" }).trim();
    expect(head).toBe(advancedSha);
    expect(readFileSync(join(t.path, "node_modules", "pkg", "index.js"), "utf8")).toBe("module.exports = 2;\n");
  });

  test("a golden that disappears from the registry between the caller's read and the donor lock is hydrate-unavailable", async () => {
    const staleGolden = { ...golden };
    saveRegistry(repoName, loadRegistry(repoName).filter((t) => t.path !== golden.path));

    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: staleGolden, clone: inProcessClone });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "golden is gone or has no readyStamp" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });

  test("a golden marked inconsistent between the caller's read and the donor lock is hydrate-unavailable", async () => {
    const staleGolden = { ...golden };
    saveRegistry(repoName, loadRegistry(repoName).map((t) =>
      t.path === golden.path ? { ...t, treeMayBeInconsistent: true } : t,
    ));

    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: staleGolden, clone: inProcessClone });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "golden may be inconsistent with its readyStamp" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });
});
