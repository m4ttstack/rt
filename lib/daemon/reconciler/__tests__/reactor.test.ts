import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Logger } from "pino";
import { writeJson } from "../../../json-store.ts";
import { closeStateDb } from "../../../state/index.ts";
import { rtDir } from "../../../rt-paths.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../../worktree/registry.ts";
import { detectTransitions, __test__ } from "../reactor.ts";
import type { RunningRunScan } from "../../../runs/store.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";

function sh(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" });
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtreactorgc-")));
  sh(`git init -q -b main ${dir}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, dir);
  return dir;
}

function addBareOrigin(repo: string): void {
  const bare = mkdtempSync(join(tmpdir(), "rtreactorgc-bare-"));
  execSync(
    `git clone --bare ${repo} ${bare}/o.git && git -C ${repo} remote add origin ${bare}/o.git && git -C ${repo} fetch origin`,
    { shell: "/bin/zsh" },
  );
}

function fakeLog(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
}

/** Ephemeral worktree on a pushed feature branch, registered as claimed. */
function ephemeralTree(repo: string, repoName: string, name: string, branch: string): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -b ${branch} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "work\n");
  sh(`git add -A && git ${GIT_ID} commit -m work`, path);
  sh(`git push -q origin ${branch}`, path);

  const old = new Date(Date.now() - 3600_000).toISOString();
  const rec: TreeRecord = {
    name,
    path,
    kind: "ephemeral",
    state: "claimed",
    branch,
    disposal: "merge",
    createdAt: old,
    claimedAt: old,
  };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}

describe("terminal-state catch-up (missed edges)", () => {
  const repoName = "acme";
  let repo: string;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtreactorcu-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    writeJson(join(rtDir(), "worktrees.json"), { enabled: true, killProcesses: false });
  });

  function detect(entries: Record<string, unknown>): Promise<void> {
    return detectTransitions({
      repoName,
      repoPath: repo,
      cacheEntries: entries as any,
      emit: () => {},
      log: fakeLog(),
      findRunningRun: () => ({ kind: "none" as const }),
    });
  }

  test("a cold boot on an already-merged MR with a claimed tree disposes it", async () => {
    // No prior reactor state at all: the merge happened while the daemon was
    // down, so no pass ever saw the MR "opened".
    const rec = ephemeralTree(repo, repoName, "golf", "feat-golf");

    await detect({ "feat-golf": { repoName, mr: { iid: 41, state: "merged" } } });

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)).toBeUndefined();
    expect(__test__.loadReactorState().fired).toContain(`disposed:${repoName}:41:merged`);
  });

  test("an unwitnessed terminal state with no actionable tree is spent — a later recut claim survives", async () => {
    // Pass 1: merged MR in the cache, no tree on the branch at all. The
    // observation must be recorded as fired even though nothing was done.
    await detect({ "feat-recut": { repoName, mr: { iid: 55, state: "merged" } } });
    expect(__test__.loadReactorState().fired).toContain(`disposed:${repoName}:55:merged`);

    // A new claimed tree reuses the branch with new pushed work; the stale
    // merged entry must not reap it.
    const rec = ephemeralTree(repo, repoName, "india", "feat-recut");
    await detect({ "feat-recut": { repoName, mr: { iid: 55, state: "merged" } } });
    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("catch-up never touches a main tree — auto-return stays edge-only", async () => {
    sh(`git -C ${repo} checkout -q -b feat-hotel`);
    sh(`git -C ${repo} push -q origin feat-hotel`);
    const rec: TreeRecord = {
      name: "main",
      path: repo,
      kind: "main",
      branch: "feat-hotel",
      createdAt: new Date().toISOString(),
    };
    saveRegistry(repoName, [...loadRegistry(repoName), rec]);

    await detect({ "feat-hotel": { repoName, mr: { iid: 42, state: "merged" } } });

    expect(execSync(`git -C ${repo} branch --show-current`, { encoding: "utf8" }).trim()).toBe("feat-hotel");
  });
});

describe("R049: fired-ledger GC", () => {
  const repoName = "acme";
  let repo: string;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtreactorgc-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    writeJson(join(rtDir(), "worktrees.json"), { enabled: true, killProcesses: false });
  });

  function detect(entries: Record<string, unknown>, findRunningRun: (worktree: string) => RunningRunScan = () => ({ kind: "none" })): Promise<void> {
    return detectTransitions({
      repoName,
      repoPath: repo,
      cacheEntries: entries as any,
      emit: () => {},
      log: fakeLog(),
      findRunningRun,
    });
  }

  test("a disposed key whose MR has no cache entry left is dropped, and a returning MR re-notifies", async () => {
    __test__.saveReactorState(
      { mrState: {}, fired: [`disposed:${repoName}:99:merged`] },
      fakeLog(),
    );

    // MR 99 no longer has any cache entry for this repo at all (its
    // branch-cache row aged out) -- the pass sees nothing about it.
    await detect({});

    expect(__test__.loadReactorState().fired).not.toContain(`disposed:${repoName}:99:merged`);

    // MR 99 comes back (recut, or the cache simply re-enriched it) and runs
    // its normal opened -> merged cycle. Since the GC cleared its old fired
    // key, the reactor must act on it again rather than treating it as
    // already-handled.
    const rec = ephemeralTree(repo, repoName, "echo", "feat-echo");
    await detect({ "feat-echo": { repoName, mr: { iid: 99, state: "opened" } } });
    await detect({ "feat-echo": { repoName, mr: { iid: 99, state: "merged" } } });

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)).toBeUndefined();
    expect(__test__.loadReactorState().fired).toContain(`disposed:${repoName}:99:merged`);
  });

  test("a disposed key whose MR still has a live cache entry survives GC", async () => {
    __test__.saveReactorState(
      { mrState: { [`${repoName}:feat-foxtrot`]: "merged" }, fired: [`disposed:${repoName}:7:merged`] },
      fakeLog(),
    );

    // MR 7's cache entry is still present (just not "opened"), so its fired
    // key must not be treated as abandoned.
    await detect({ "feat-foxtrot": { repoName, mr: { iid: 7, state: "merged" } } });

    expect(__test__.loadReactorState().fired).toContain(`disposed:${repoName}:7:merged`);
  });

  test("another repo's fired keys are never touched by this repo's GC", async () => {
    __test__.saveReactorState(
      { mrState: {}, fired: ["disposed:otherrepo:9:merged"] },
      fakeLog(),
    );

    await detect({});

    expect(__test__.loadReactorState().fired).toContain("disposed:otherrepo:9:merged");
  });
});

describe("auto-dispose refuses a tree with a live pipeline run", () => {
  const repoName = "acme";
  let repo: string;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtreactorgc-home-")));
    closeStateDb();
    repo = makeRepo();
    addBareOrigin(repo);
    writeJson(join(rtDir(), "worktrees.json"), { enabled: true, killProcesses: false });
  });

  test("a merged branch whose worktree has a running run is marked disposable, not deleted", async () => {
    const rec = ephemeralTree(repo, repoName, "hotel", "feat-hotel");

    await detectTransitions({
      repoName,
      repoPath: repo,
      cacheEntries: { "feat-hotel": { repoName, mr: { iid: 55, state: "opened" } } } as any,
      emit: () => {},
      log: fakeLog(),
      findRunningRun: () => ({ kind: "none" }),
    });
    await detectTransitions({
      repoName,
      repoPath: repo,
      cacheEntries: { "feat-hotel": { repoName, mr: { iid: 55, state: "merged" } } } as any,
      emit: () => {},
      log: fakeLog(),
      findRunningRun: (worktree) =>
        worktree === rec.path ? { kind: "match", run: { id: "run-1", currentStage: "implement" } } : { kind: "none" },
    });

    const after = loadRegistry(repoName).find((t) => t.path === rec.path);
    expect(after).toBeDefined();
    expect(after!.state).toBe("disposable");
    expect(after!.disposableReason).toBe("running-run");
    expect(existsSync(rec.path)).toBe(true);
  });
});
