/**
 * Replenish / shrink duty (spec §6.4): grows a repo's on-deck pool toward its
 * declared size, then disposes the stalest ready entries once it's over.
 * Shrink co-locates with replenish in this one function rather than a
 * separate module: both read the same `poolCounts` snapshot and share the
 * same per-repo pass, so splitting them would just duplicate that read.
 */

import { existsSync, statfsSync, statSync } from "fs";
import { dirname, resolve } from "path";
import {
  findByPath,
  isRtOwnedBranch,
  loadRegistry,
  type TreeRecord,
} from "../../worktree/registry.ts";
import { withTreeLock } from "../../worktree/locks.ts";
import { createTree, scrapTree, type CreateResult } from "../../worktree/create.ts";
import { hydrateTree, type CloneRunner, type HydrateResult } from "../../worktree/hydrate.ts";
import { disposeTree } from "../../worktree/dispose.ts";
import { loadWorktreeRepoConfig, type WorktreeAppConfig } from "../../worktree/config.ts";
import { backoffDelayMs, type FreshenDeps } from "./freshen.ts";
import { goldenRoot } from "../../rt-paths.ts";
import type { RunningRunScan } from "../../runs/store.ts";

// Machine-side clamp (S077): no team declaration builds more than this on one laptop.
export const WORKTREE_ONDECK_CEILING = 5;
// Room for one tree plus a multi-GB monorepo install's transient peak (2026-08-21 wedge profile).
export const WORKTREE_MIN_FREE_DISK_GB = 5;

/**
 * S089: a provision's cold `createTree` (handlers/worktree.ts) and this
 * reconciler's own replenish `createTree` can run concurrently for the same
 * repo, both `git fetch origin <branch>` against the same repoPath... the
 * loser fails to lock refs/remotes/origin/<branch>, and that failure gets
 * charged to createBackoff (a 5-to-30-minute replenish hold) for what was
 * really just contention, not a genuine failure. Chained per repoPath so
 * concurrent callers queue instead of racing; a rejected holder still
 * releases the lock for the next one.
 */
const createLocks = new Map<string, Promise<void>>();

export function withCreateLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const prior = createLocks.get(repoPath) ?? Promise.resolve();
  const ready = prior.catch(() => {}); // a previous holder's rejection must not block the next one
  const result = ready.then(fn);
  const tracked: Promise<void> = result.then(() => undefined, () => undefined);
  createLocks.set(repoPath, tracked);
  void tracked.finally(() => {
    if (createLocks.get(repoPath) === tracked) createLocks.delete(repoPath);
  });
  return result;
}

/** Per-repo create-backoff state: failure count and the next retry deadline. */
export type CreateBackoffMap = Map<string, { failures: number; nextRetryAt: string }>;

/**
 * Default create backoff (spec §6.4): failure N waits one pass doubled N-1
 * times, capped at 30 minutes.
 *
 * A failed `createTree` scraps its own registry row, so there is no on-disk row
 * left to hang retry bookkeeping off... without this, a persistently failing
 * ready step (a broken install costing minutes per attempt) is retried on every
 * cache tick, forever. The state is in-memory, same as the create-lock map
 * above it: a daemon restart clearing the backoff costs one wasted attempt,
 * which is cheaper than persisting a transient.
 *
 * A reconciler instance threads its OWN map through `deps.backoff` so two
 * instances never charge each other's failures; this module-scope map is the
 * fallback for a caller that omits one.
 */
export const createBackoff: CreateBackoffMap = new Map();

/**
 * Free disk under `path`, in gigabytes, via statfs. A probe failure (path not
 * yet resolvable, permission) degrades to "enough disk" rather than blocking
 * replenish on a signal that was never meant to gate anything on its own.
 */
export async function hasFreeDiskGb(path: string, gb: number): Promise<boolean> {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize >= gb * 1024 ** 3;
  } catch {
    return true;
  }
}

/** The active backoff deadline for a repo, or null when creates may run now. */
function createBlockedUntil(backoff: CreateBackoffMap, repoName: string): string | null {
  const entry = backoff.get(repoName);
  if (!entry) return null;
  return Date.parse(entry.nextRetryAt) > Date.now() ? entry.nextRetryAt : null;
}

function noteCreateFailure(backoff: CreateBackoffMap, repoName: string): { failures: number; nextRetryAt: string } {
  const failures = (backoff.get(repoName)?.failures ?? 0) + 1;
  const entry = {
    failures,
    nextRetryAt: new Date(Date.now() + backoffDelayMs(failures)).toISOString(),
  };
  backoff.set(repoName, entry);
  return entry;
}

export function findGolden(trees: TreeRecord[]): TreeRecord | undefined {
  return trees.find((t) => t.kind === "golden");
}

export type CreateMode = { mode: "hydrate"; golden: TreeRecord } | { mode: "cold"; why: string };

/** Pure: whether the next member build can be a hydration. Every "no" is a cold create, never a skipped build. */
export function chooseCreateMode(
  trees: TreeRecord[],
  cfgRoot: string,
  now: number,
  sameVolume: (a: string, b: string) => boolean,
): CreateMode {
  const golden = findGolden(trees);
  if (!golden) return { mode: "cold", why: "no golden" };
  if (golden.state !== "on-deck") return { mode: "cold", why: `golden is ${golden.state ?? "unstated"}` };
  if (golden.nextRetryAt && Date.parse(golden.nextRetryAt) > now) return { mode: "cold", why: "golden in backoff" };
  // retryFailures outlives nextRetryAt, so a golden whose ready ladder died is
  // refused as a donor even when its deadline has since passed and nothing has
  // re-freshened it. Without this the predicate would depend on the caller
  // running freshen first, which only the reconciler pass guarantees.
  if ((golden.retryFailures ?? 0) > 0) return { mode: "cold", why: "golden has recorded failures" };
  if (!golden.readyStamp) return { mode: "cold", why: "golden has no readyStamp" };
  if (!sameVolume(golden.path, cfgRoot)) return { mode: "cold", why: "golden and pool root are on different volumes" };
  return { mode: "hydrate", golden };
}

/** The nearest ancestor of `p` that exists: a not-yet-created path always lands on this ancestor's device. */
function nearestExisting(p: string): string {
  let cur = resolve(p);
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
  return cur;
}

// The probe must never create the pool root: an existing pool root is what
// tells reconcile's isHeldByUnreadableMount (reconcile.ts) that the mount is
// live, so materializing it here would make a genuinely vanished mount look
// present, un-hold its rows, and let them accrue misses toward pruning.
function sameDev(a: string, b: string): boolean {
  try {
    return statSync(nearestExisting(a)).dev === statSync(nearestExisting(b)).dev;
  } catch {
    return false;
  }
}

/** On-deck / creating counts used to decide whether to grow or shrink the pool. */
export function poolCounts(repoName: string): {
  ready: number;
  totalUnclaimed: number;
  onDeckEntries: TreeRecord[];
} {
  const trees = loadRegistry(repoName);
  const now = Date.now();
  const onDeckEntries = trees.filter((t) => t.kind === "ephemeral" && t.state === "on-deck");
  const creatingEntries = trees.filter((t) => t.kind === "ephemeral" && t.state === "creating");
  const ready = onDeckEntries.filter((t) => !t.nextRetryAt || Date.parse(t.nextRetryAt) <= now).length;
  return { ready, totalUnclaimed: onDeckEntries.length + creatingEntries.length, onDeckEntries };
}

/**
 * Grow the on-deck pool toward `onDeck` (serially... one `createTree` in
 * flight at a time, which `runOnce` awaiting each pass makes natural), then
 * shrink it back down by disposing the stalest ready entries when it's over.
 *
 * Replenish is bounded on both axes. Within a pass it is bounded to the deficit
 * measured once at the start, not re-derived from live state on every
 * iteration: `createTree` scraps its own registry row on failure, so an
 * always-failing config would otherwise re-read "still short" forever and spin
 * this pass indefinitely. Across passes it is bounded by `createBackoff`... the
 * first failure of a pass ends replenish for that repo and holds it off for the
 * doubling backoff window, so a broken ready step costs one multi-minute
 * attempt per window instead of `onDeck` attempts per cache tick.
 */
export async function replenishAndShrink(
  deps: FreshenDeps & {
    backoff?: CreateBackoffMap;
    /** Threaded into the shrink path's disposeTree call; wired from `findRunningRunByWorktree` in lib/runs/store.ts. */
    findRunningRun: (worktree: string) => RunningRunScan;
    /** Test seam for the artifact-clone step of hydration; production omits it. */
    clone?: CloneRunner;
    /** Test seam for the golden/pool-root volume check; default is a real statSync. */
    sameVolume?: (a: string, b: string) => boolean;
  },
  creationPromises: Map<string, Promise<void>>,
  appConfig: WorktreeAppConfig,
): Promise<void> {
  const { repoName, repoPath, emit, log } = deps;
  // The reconciler instance threads its own map; a direct caller that omits
  // one lands on the module-scope default.
  const backoff = deps.backoff ?? createBackoff;
  const cfg = await loadWorktreeRepoConfig(repoName, repoPath);
  // A store rung's onDeck is a team declaration; the ceiling is this machine's
  // own limit and always wins, so it clamps here rather than in the sanitizer.
  const onDeck = Math.min(cfg.onDeck, WORKTREE_ONDECK_CEILING);
  if (onDeck <= 0) {
    const golden = findGolden(loadRegistry(repoName));
    if (golden) {
      // The branch goes with it: a left-behind rt/golden makes the next
      // golden's `git worktree add -b` fail for as long as it exists.
      const result = await withCreateLock(repoPath, () =>
        withTreeLock(golden.path, () =>
          scrapTree({ repoName, repoPath, emit, log }, golden, { deleteBranch: isRtOwnedBranch(golden.branch) }),
        ),
      );
      if (result !== "busy") {
        log.info({ repo: repoName }, "replenish: onDeck is 0; scrapped the golden");
      }
    }
    return;
  }

  // Lazy and memoized once per pass, not eagerly: the golden root does not
  // exist on disk until the ensure block below has run, and `sameVolume`
  // degrades to false on a missing path, so evaluating this before the
  // golden exists would cold-create every member of a repo's first pass.
  // `chooseCreateMode` only reaches this once it has a golden in hand, so
  // the first call always lands after the ensure block.
  let volumeOk: boolean | undefined;
  const sameVolumeForPass = (a: string, b: string): boolean => {
    volumeOk ??= (deps.sameVolume ?? sameDev)(a, b);
    return volumeOk;
  };

  // The golden gets its own backoff key so a broken donor build never blocks
  // member creates, which stay on the cold path for the rest of this pass.
  const goldenKey = `${repoName}#golden`;
  if (!findGolden(loadRegistry(repoName)) && !createBlockedUntil(backoff, goldenKey)) {
    if (await hasFreeDiskGb(goldenRoot(repoName), WORKTREE_MIN_FREE_DISK_GB)) {
      const g = await withCreateLock(repoPath, () => createTree({ repoName, repoPath, emit, log, target: "golden" }));
      if (g.ok) {
        backoff.delete(goldenKey);
      } else if (g.error !== "busy") {
        const { failures, nextRetryAt } = noteCreateFailure(backoff, goldenKey);
        log.warn(
          { repo: repoName, error: g.error, failedStep: g.failedStep, failures, nextRetryAt },
          "worktree reconciler: golden create failed",
        );
      }
    }
  }

  let { ready, totalUnclaimed } = poolCounts(repoName);
  let budget = Math.max(0, onDeck - totalUnclaimed);
  while (budget > 0 && ready < onDeck && totalUnclaimed < onDeck) {
    // Checked per iteration, not once per pass: a failure recorded by the
    // attempt above must end this pass's replenish too, or the pass still
    // burns `onDeck` full builds on the same broken step.
    const blockedUntil = createBlockedUntil(backoff, repoName);
    if (blockedUntil) {
      log.debug?.(
        { repo: repoName, nextRetryAt: blockedUntil },
        "replenish: skipped... create backoff in effect",
      );
      break;
    }
    // cfg.root, not repoPath: createTree writes under cfg.root, and the RT-52
    // default root lives off-repo (~/.mattstack/rt/worktrees/<identity>), which
    // can be a different volume than the repo's own filesystem.
    if (!(await hasFreeDiskGb(cfg.root, WORKTREE_MIN_FREE_DISK_GB))) {
      log.warn({ repo: repoName }, "replenish: skipped, free disk below threshold");
      break;
    }
    budget--;
    const p: Promise<void> = withCreateLock(repoPath, async () => {
      const chosen = chooseCreateMode(loadRegistry(repoName), cfg.root, Date.now(), sameVolumeForPass);
      if (chosen.mode === "hydrate") {
        const h = await hydrateTree({ repoName, repoPath, emit, log, golden: chosen.golden, clone: deps.clone });
        if (h.ok || h.error === "busy") return h;
        if (h.error !== "hydrate-unavailable") return h;
        log.warn({ repo: repoName, detail: h.detail }, "replenish: hydration unavailable; cold create");
      } else {
        log.debug?.({ repo: repoName, why: chosen.why }, "replenish: cold create");
      }
      return createTree({ repoName, repoPath, emit, log });
    })
      .then((result: CreateResult | HydrateResult) => {
        if (result.ok) {
          backoff.delete(repoName);
          return;
        }
        // "busy" is another holder of the tree lock, not a failing build: it
        // neither earns a backoff nor clears one.
        if (result.error === "busy") return;
        const failedStep = "failedStep" in result ? result.failedStep : undefined;
        const { failures, nextRetryAt } = noteCreateFailure(backoff, repoName);
        log.warn(
          { repo: repoName, error: result.error, failedStep, failures, nextRetryAt },
          "worktree reconciler: replenish create failed",
        );
      })
      .catch((err) => {
        const { failures, nextRetryAt } = noteCreateFailure(backoff, repoName);
        log.warn(
          { err, repo: repoName, failures, nextRetryAt },
          "worktree reconciler: replenish create threw",
        );
      })
      .finally(() => {
        if (creationPromises.get(repoName) === p) creationPromises.delete(repoName);
      });
    creationPromises.set(repoName, p);
    await p;
    ({ ready, totalUnclaimed } = poolCounts(repoName));
  }

  // `attempted` guards against spinning forever on an entry disposeTree keeps
  // refusing (e.g. a guard failure)... each path gets one shrink attempt per
  // pass; a refusal just leaves it for the next pass rather than looping here.
  let counts = poolCounts(repoName);
  const attempted = new Set<string>();
  while (counts.ready > onDeck) {
    const now = Date.now();
    const eligible = counts.onDeckEntries.filter(
      (t) => !attempted.has(t.path) && (!t.nextRetryAt || Date.parse(t.nextRetryAt) <= now),
    );
    if (eligible.length === 0) break;
    const stalest = eligible.reduce((a, b) =>
      Date.parse(a.readyAt ?? a.createdAt) <= Date.parse(b.readyAt ?? b.createdAt) ? a : b,
    );
    attempted.add(stalest.path);
    await withTreeLock(stalest.path, async () => {
      // Same revalidation as freshen: `stalest` is a snapshot from this
      // iteration's `poolCounts()` read; re-check it under the lock before
      // disposing so a claim that landed since (no grace guard applies here...
      // auto is false) can't get its tree deleted out from under it.
      const fresh = findByPath(loadRegistry(repoName), stalest.path);
      if (!fresh || fresh.kind !== "ephemeral" || fresh.state !== "on-deck") {
        log.debug?.(
          { repo: repoName, tree: stalest.name, path: stalest.path },
          "shrink: skipping... tree changed since candidacy was decided",
        );
        return;
      }
      await disposeTree(
        { repoName, repoPath, cacheEntries: {}, emit, log, killProcesses: appConfig.killProcesses, findRunningRun: deps.findRunningRun },
        fresh,
        { auto: false },
      );
    });
    counts = poolCounts(repoName);
  }
}

export const __test__ = {
  withCreateLock,
  replenishAndShrink,
  poolCounts,
  createBackoff,
  hasFreeDiskGb,
  WORKTREE_ONDECK_CEILING,
  WORKTREE_MIN_FREE_DISK_GB,
};
