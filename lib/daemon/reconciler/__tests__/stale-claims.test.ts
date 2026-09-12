import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import type { Logger } from "pino";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../../worktree/registry.ts";
import type { WorktreeRepoConfig } from "../../../worktree/config.ts";
import { closeStateDb } from "../../../state/index.ts";
import { liveProcessCwds, sweepStaleClaims } from "../stale-claims.ts";

const GIT_ID = "-c user.email=t@t -c user.name=t";
const DAY_MS = 24 * 60 * 60 * 1000;

function sh(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, shell: "/bin/zsh", stdio: "pipe" });
}

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rtstale-")));
  sh(`git init -q -b main ${dir}`);
  sh(`git ${GIT_ID} commit -q --allow-empty -m init`, dir);
  const bare = mkdtempSync(join(tmpdir(), "rtstale-bare-"));
  sh(`git clone --bare -q ${dir} ${bare}/o.git && git -C ${dir} remote add origin ${bare}/o.git && git -C ${dir} fetch -q origin`);
  return dir;
}

function fakeLog(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
}

/** Ephemeral claimed tree, branch pushed unless `push: false`. */
function claimedTree(
  repo: string,
  repoName: string,
  name: string,
  branch: string,
  opts: { claimedAgoMs: number; push?: boolean },
): TreeRecord {
  const path = join(repo, ".worktrees", name);
  sh(`git -C ${repo} worktree add -q -b ${branch} ${path} origin/main`);
  writeFileSync(join(path, `${name}.txt`), "work\n");
  sh(`git add -A && git ${GIT_ID} commit -q -m work`, path);
  if (opts.push !== false) sh(`git push -q origin ${branch}`, path);

  const stamp = new Date(Date.now() - opts.claimedAgoMs).toISOString();
  const rec: TreeRecord = {
    name,
    path,
    kind: "ephemeral",
    state: "claimed",
    branch,
    disposal: "merge",
    createdAt: stamp,
    claimedAt: stamp,
  };
  saveRegistry(repoName, [...loadRegistry(repoName), rec]);
  return rec;
}

function cfgWith(staleClaimDays: number): WorktreeRepoConfig {
  return { onDeck: 0, root: "/unused", branchFormat: "<ticket>-<slug>", ready: [], staleClaimDays };
}

describe("stale-claim sweep", () => {
  const repoName = "acme";
  let repo: string;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rtstale-home-")));
    closeStateDb();
    repo = makeRepo();
  });

  function sweep(
    cfg: WorktreeRepoConfig,
    opts: { liveCwds?: () => Promise<Set<string>>; cacheEntries?: Record<string, { mr: { iid?: number; state?: string | null } | null }> } = {},
  ): Promise<void> {
    return sweepStaleClaims(
      {
        repoName,
        repoPath: repo,
        cacheEntries: opts.cacheEntries ?? {},
        emit: () => {},
        log: fakeLog(),
        killProcesses: false,
        findRunningRun: () => ({ kind: "none" as const }),
        ...(opts.liveCwds ? { liveCwds: opts.liveCwds } : {}),
      },
      cfg,
    );
  }

  test("a claim older than the threshold with a pushed branch is disposed", async () => {
    const rec = claimedTree(repo, repoName, "alpha", "feat-alpha", { claimedAgoMs: 8 * DAY_MS });

    await sweep(cfgWith(7));

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)).toBeUndefined();
  });

  test("a claim younger than the threshold is untouched", async () => {
    const rec = claimedTree(repo, repoName, "bravo", "feat-bravo", { claimedAgoMs: 2 * DAY_MS });

    await sweep(cfgWith(7));

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("a stale claim with a live process cwd inside the tree is untouched", async () => {
    const rec = claimedTree(repo, repoName, "charlie", "feat-charlie", { claimedAgoMs: 8 * DAY_MS });

    await sweep(cfgWith(7), { liveCwds: async () => new Set([join(rec.path, "node_modules")]) });

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("a live cwd is still detected when the registry stores the tree path through a symlink", async () => {
    const rec = claimedTree(repo, repoName, "golf", "feat-golf", { claimedAgoMs: 8 * DAY_MS });
    // A symlinked pool root (macOS /tmp -> /private/tmp, a linked volume)
    // registers the tree under the symlink spelling, while lsof reports
    // kernel-resolved realpaths.
    const linkRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "rtstale-link-"))), "trees");
    symlinkSync(dirname(rec.path), linkRoot);
    const linkedPath = join(linkRoot, basename(rec.path));
    saveRegistry(repoName, loadRegistry(repoName).map((t) => (t.path === rec.path ? { ...t, path: linkedPath } : t)));

    await sweep(cfgWith(7), { liveCwds: async () => new Set([join(rec.path, "src")]) });

    expect(loadRegistry(repoName).find((t) => t.path === linkedPath)?.state).toBe("claimed");
  });

  test("a stale claim with unpushed commits is refused and stays claimed", async () => {
    const rec = claimedTree(repo, repoName, "delta", "feat-delta", { claimedAgoMs: 8 * DAY_MS, push: false });

    await sweep(cfgWith(7));

    const after = loadRegistry(repoName).find((t) => t.path === rec.path);
    expect(after?.state).toBe("claimed");
    expect(after?.disposableReason).toBeUndefined();
  });

  test("a stale claim whose branch has an open MR is skipped, even though every dispose guard would pass", async () => {
    const rec = claimedTree(repo, repoName, "hotel", "feat-hotel", { claimedAgoMs: 8 * DAY_MS });

    await sweep(cfgWith(7), { cacheEntries: { "feat-hotel": { mr: { iid: 1, state: "opened" } } } });

    const after = loadRegistry(repoName).find((t) => t.path === rec.path);
    expect(after?.state).toBe("claimed");
    expect(after?.disposableReason).toBeUndefined();
  });

  test("a stale claim whose branch's MR merged is not protected by the open-MR guard", async () => {
    const rec = claimedTree(repo, repoName, "india", "feat-india", { claimedAgoMs: 8 * DAY_MS });

    await sweep(cfgWith(7), { cacheEntries: { "feat-india": { mr: { iid: 2, state: "closed" } } } });

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)).toBeUndefined();
  });

  test("a claim past claimedAt but active more recently (lastActiveAt) is untouched", async () => {
    const rec = claimedTree(repo, repoName, "juliet", "feat-juliet", { claimedAgoMs: 8 * DAY_MS });
    saveRegistry(
      repoName,
      loadRegistry(repoName).map((t) =>
        t.path === rec.path ? { ...t, lastActiveAt: new Date(Date.now() - 1 * DAY_MS).toISOString() } : t,
      ),
    );

    await sweep(cfgWith(7));

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("a claim stale by both claimedAt and lastActiveAt is disposed", async () => {
    const rec = claimedTree(repo, repoName, "kilo", "feat-kilo", { claimedAgoMs: 30 * DAY_MS });
    saveRegistry(
      repoName,
      loadRegistry(repoName).map((t) =>
        t.path === rec.path ? { ...t, lastActiveAt: new Date(Date.now() - 10 * DAY_MS).toISOString() } : t,
      ),
    );

    await sweep(cfgWith(7));

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)).toBeUndefined();
  });

  test("staleClaimDays 0 disables the sweep entirely", async () => {
    const rec = claimedTree(repo, repoName, "echo", "feat-echo", { claimedAgoMs: 90 * DAY_MS });

    await sweep(cfgWith(0));

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("liveProcessCwds sees this very process's cwd", async () => {
    const cwds = await liveProcessCwds();
    expect(cwds.has(realpathSync(process.cwd()))).toBe(true);
  });

  test("a failed live-cwd snapshot aborts the sweep — fail closed, never dispose blind", async () => {
    const rec = claimedTree(repo, repoName, "foxtrot", "feat-foxtrot", { claimedAgoMs: 8 * DAY_MS });

    await sweep(cfgWith(7), {
      liveCwds: async () => {
        throw new Error("lsof unavailable");
      },
    });

    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  // 2026-09-10: sweepStaleClaims crashed with `deps.findRunningRun is not a
  // function` because a construction site handed it the wrong field name.
  // This mirrors worktree-reconciler.ts's processRepo object literal (same
  // field set, findRunningRun sourced the same way
  // ReconcilerDeps.findRunningRunByWorktree is) and exercises guard 4 through
  // it, so a future drift between the two construction sites fails here
  // instead of on a live daemon.
  test("stale-claims deps built the way the daemon builds them reach guard 4 without a wiring crash", async () => {
    const rec = claimedTree(repo, repoName, "lima", "feat-lima", { claimedAgoMs: 8 * DAY_MS });
    let calls = 0;
    const warnCalls: unknown[] = [];
    const log = {
      info: () => {},
      warn: (...args: unknown[]) => {
        warnCalls.push(args);
      },
      debug: () => {},
    } as unknown as Logger;

    await sweepStaleClaims(
      {
        repoName,
        repoPath: repo,
        cacheEntries: {},
        emit: () => {},
        log,
        killProcesses: false,
        findRunningRun: (worktree: string) => {
          calls++;
          return worktree === rec.path
            ? { kind: "match" as const, run: { id: "run-1", currentStage: "review" } }
            : { kind: "none" as const };
        },
      },
      cfgWith(7),
    );

    // A wiring crash (findRunningRun undefined/misnamed) would be swallowed by
    // sweepStaleClaims' per-tree try/catch and leave the claim untouched too,
    // so state alone can't tell success from a silent crash: the call count
    // and the absence of a warn prove disposeTree actually reached guard 4.
    expect(calls).toBeGreaterThan(0);
    expect(warnCalls).toEqual([]);
    expect(loadRegistry(repoName).find((t) => t.path === rec.path)?.state).toBe("claimed");
  });

  test("liveProcessCwds throws on a non-zero exit and on a spawn failure", async () => {
    expect(liveProcessCwds(["false"])).rejects.toThrow();
    expect(liveProcessCwds(["/nonexistent-rtstale-binary"])).rejects.toThrow();
  });
});
