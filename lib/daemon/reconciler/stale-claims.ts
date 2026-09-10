/**
 * Stale-claim sweep duty: the exit path for claimed trees whose session ended
 * without disposing them and whose branch never grew an MR — the merge
 * reactor's only trigger is MR state, so without this they accumulate until
 * someone sweeps by hand (2026-09-10: 26 of them in one repo's cd picker).
 *
 * A claim older than `staleClaimDays` (rt.worktrees, per repo; 0 disables)
 * goes through the same guarded disposeTree the reactor uses: dirty and
 * unpushed trees refuse and stay claimed — an old claim holding real work is
 * live work, not litter — and everything disposed lands in the retention
 * trash, restorable for the window. The one guard dispose cannot provide is
 * liveness: killProcesses would terminate an active session's processes
 * before any refusal could save it, so a tree holding any live process cwd
 * is skipped BEFORE dispose. The lsof snapshot is taken once per sweep and
 * only when a candidate qualifies, so quiet passes never spawn it.
 */

import { withTreeLock } from "../../worktree/locks.ts";
import { loadRegistry, type TreeRecord } from "../../worktree/registry.ts";
import { disposeTree, type DisposeDeps } from "../../worktree/dispose.ts";
import type { WorktreeRepoConfig } from "../../worktree/config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StaleClaimSweepDeps extends DisposeDeps {
  /** Injectable for tests; defaults to one lsof snapshot of every process cwd. */
  liveCwds?: () => Promise<Set<string>>;
  now?: number;
}

/**
 * Every process's current working directory, per lsof. Best-effort: an lsof
 * failure returns the empty set, which the caller must treat as "nothing
 * proven live" only because the age threshold already bounds how recently a
 * session can have been using the tree.
 */
export async function liveProcessCwds(): Promise<Set<string>> {
  try {
    const proc = Bun.spawn(["lsof", "-d", "cwd", "-Fn"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const cwds = new Set<string>();
    for (const line of out.split("\n")) {
      if (line.startsWith("n/")) cwds.add(line.slice(1));
    }
    return cwds;
  } catch {
    return new Set();
  }
}

function insideTree(cwd: string, treePath: string): boolean {
  return cwd === treePath || cwd.startsWith(treePath + "/");
}

function staleClaims(repoName: string, days: number, now: number): TreeRecord[] {
  return loadRegistry(repoName).filter((rec) => {
    if (rec.kind !== "ephemeral" || rec.state !== "claimed") return false;
    // Job trees are the caller's to end, same as in the reactor.
    if (rec.disposal === "job") return false;
    if (!rec.claimedAt) return false;
    const claimedMs = Date.parse(rec.claimedAt);
    return !Number.isNaN(claimedMs) && now - claimedMs > days * DAY_MS;
  });
}

/** Sweep one repo's stale claims through guarded dispose. Never throws past a tree. */
export async function sweepStaleClaims(deps: StaleClaimSweepDeps, cfg: WorktreeRepoConfig): Promise<void> {
  const days = cfg.staleClaimDays;
  if (days === 0) return;
  const now = deps.now ?? Date.now();

  const candidates = staleClaims(deps.repoName, days, now);
  if (candidates.length === 0) return;

  const cwds = await (deps.liveCwds ?? liveProcessCwds)();

  for (const rec of candidates) {
    if ([...cwds].some((cwd) => insideTree(cwd, rec.path))) {
      deps.log.debug?.(
        { repo: deps.repoName, tree: rec.name },
        "stale-claim sweep: live process cwd inside the tree, skipping",
      );
      continue;
    }
    const ageDays = Math.floor((now - Date.parse(rec.claimedAt!)) / DAY_MS);
    try {
      const outcome = await withTreeLock(rec.path, () => disposeTree(deps, rec, { auto: true }));
      if (outcome === "busy") continue;
      if (outcome.disposed) {
        deps.log.info(
          { repo: deps.repoName, tree: rec.name, branch: rec.branch, ageDays },
          "stale claim disposed",
        );
      }
      // A refusal (dirty/unpushed/attended/…) leaves the tree claimed on
      // purpose: an old claim holding real work is live work. disposeTree
      // already logged the reason at debug.
    } catch (err) {
      deps.log.warn({ err, repo: deps.repoName, tree: rec.name }, "stale-claim sweep: dispose failed");
    }
  }
}
