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

import { canon } from "../../fs-canon.ts";
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
 * Every process's current working directory, per lsof. Throws on a spawn
 * failure or non-zero exit — an empty set from a broken lsof would read as
 * "nothing is live" and let the sweep dispose a tree an active session sits
 * in, so the caller must fail closed instead. `argv` is injectable for the
 * failure-path tests (Bun.spawn resolves PATH at process start, so a PATH
 * shim cannot substitute the binary).
 */
export async function liveProcessCwds(argv: string[] = ["lsof", "-d", "cwd", "-Fn"]): Promise<Set<string>> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${argv[0]} exited ${exitCode}`);
  const cwds = new Set<string>();
  for (const line of out.split("\n")) {
    if (line.startsWith("n/")) cwds.add(line.slice(1));
  }
  return cwds;
}

function insideTree(cwd: string, treePath: string): boolean {
  return cwd === treePath || cwd.startsWith(treePath + "/");
}

/**
 * lsof reports kernel-resolved realpaths while the registry stores the
 * configured spelling, so the tree side must be canonicalized or a symlink
 * anywhere in the root (macOS /tmp, a linked volume) hides every live
 * session from the compare. Shared with the reactor's unwitnessed catch-up.
 */
export function hasLiveCwdInside(cwds: Set<string>, treePath: string): boolean {
  const tree = canon(treePath);
  return [...cwds].some((cwd) => insideTree(cwd, tree));
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

  let cwds: Set<string>;
  try {
    cwds = await (deps.liveCwds ?? liveProcessCwds)();
  } catch (err) {
    // Fail closed: without liveness ground truth, a dispose could kill an
    // active session's processes. Skip the pass; the next one retries.
    deps.log.warn({ err, repo: deps.repoName }, "stale-claim sweep skipped: live-cwd snapshot failed");
    return;
  }

  for (const rec of candidates) {
    if (hasLiveCwdInside(cwds, rec.path)) {
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
