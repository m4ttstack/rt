import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { machineSettingsPath } from "../../rt-paths.ts";
import { deriveRepoIdentity } from "../../settings/identity.ts";
import { closeStateDb } from "../../state/index.ts";
import { loadRegistry, type TreeRecord } from "../registry.ts";
import { listWorktreesAsync } from "../git-async.ts";
import { createTree, type CreateDeps } from "../create.ts";
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
 * it doesn't itself normalize — exactly the fork/local-remote mechanism
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

/** Seeds `rt.worktrees` for `repoPath` in the machine store — the store-only replacement for the old per-repo config.json fixture. */
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
    await declareWorktrees(repo, repoName, { onDeck: 1, root: join(repo, ".worktrees"), ready: [] });
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
    const head = execSync("git rev-parse HEAD", { cwd: t.path, encoding: "utf8" }).trim();
    expect(head).toBe(golden.readyStamp!);
    const wt = (await listWorktreesAsync(repo))!.find((w) => w.path === t.path);
    expect(wt?.branch).toBe(`on-deck/${t.name}`);
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(1);
    expect(events.some((e) => e.type === "worktree:created")).toBe(true);
  });

  test("clone exit 3 reports hydrate-unavailable and scraps the half-built tree", async () => {
    const exdev: CloneRunner = async () => ({ exitCode: 3, stderr: "clonefile: Cross-device link" });
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden, clone: exdev });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "clonefile: Cross-device link" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
    const wts = (await listWorktreesAsync(repo))!;
    expect(wts.some((w) => w.branch?.startsWith("on-deck/"))).toBe(false);
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

  test("a golden without readyStamp is refused before any git mutation", async () => {
    const result = await hydrateTree({ ...makeDeps(repoName, repo, events), golden: { ...golden, readyStamp: undefined }, clone: inProcessClone });
    expect(result).toEqual({ ok: false, error: "hydrate-unavailable", detail: "golden has no readyStamp" });
    expect(loadRegistry(repoName).filter((r) => r.kind === "ephemeral")).toHaveLength(0);
  });
});
