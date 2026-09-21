/**
 * rt-side checkout guard: composes the stack check (lib/stack-guard.ts) with
 * a worktree-ownership check before a branch switch. Order matters: the
 * worktree check is cheap and local, so it runs before the gitq/forge calls.
 */

import { realpathSync } from "node:fs";
import { sep } from "node:path";
import { checkStackMembership, type StackGuardRunners } from "./stack-guard.ts";
import { listWorktreesAsync, type WorktreeEntry } from "./worktree/git-async.ts";

export type BranchGuardVerdict =
  | { verdict: "clear" }
  | { verdict: "refuse"; reason: "stack" | "worktree"; detail: string }
  | { verdict: "unverified"; detail: string };

type WorktreeOwnership =
  | { ok: true; containing: WorktreeEntry | undefined; ownerByBranch: Map<string, WorktreeEntry> }
  | { ok: false; path: string };

/**
 * Finds the worktree containing `cwdReal` (excluded from ownership, since a
 * worktree never guards its own current branch) and maps every OTHER
 * worktree's checked-out branch to the entry holding it. Shared by
 * checkBranchGuard's single-branch enforcement and buildWorktreeGuardMap's
 * batch display lookup so the two never drift on what "owned" means.
 *
 * The containing-worktree search can fail outright (a listed path vanished
 * between the list call and here -- another process disposing a worktree);
 * that race is reported as `ok: false`, never a throw, since both callers
 * treat this as an advisory check. The branch-ownership map itself never
 * needs realpath resolution, so a stale entry elsewhere in the list cannot
 * block it.
 */
function resolveWorktreeOwnership(cwdReal: string, worktrees: WorktreeEntry[]): WorktreeOwnership {
  let containing: WorktreeEntry | undefined;
  for (const w of worktrees) {
    let entryReal: string;
    try {
      entryReal = realpathSync(w.path);
    } catch {
      return { ok: false, path: w.path };
    }
    if (cwdReal === entryReal || cwdReal.startsWith(entryReal + sep)) {
      containing = w;
      break;
    }
  }
  const ownerByBranch = new Map<string, WorktreeEntry>();
  for (const w of worktrees) {
    if (w === containing || w.branch === null) continue;
    if (!ownerByBranch.has(w.branch)) ownerByBranch.set(w.branch, w);
  }
  return { ok: true, containing, ownerByBranch };
}

export async function checkBranchGuard(opts: {
  cwd: string;
  branch: string;
  defaultBranch: string | null;
  runners: StackGuardRunners;
  listWorktrees?: typeof listWorktreesAsync;
}): Promise<BranchGuardVerdict> {
  const listWorktrees = opts.listWorktrees ?? listWorktreesAsync;
  const worktrees = await listWorktrees(opts.cwd);
  if (worktrees === null) {
    return { verdict: "unverified", detail: "could not list worktrees, so branch ownership is unknown" };
  }

  // The caller's cwd is often a subdirectory of its worktree root, not the
  // root itself, so ownership must exclude the worktree that CONTAINS cwd,
  // never just the entry whose path equals cwd exactly.
  let cwdReal: string;
  try {
    cwdReal = realpathSync(opts.cwd);
  } catch {
    return { verdict: "unverified", detail: `could not resolve cwd ${opts.cwd}, so branch ownership is unknown` };
  }
  const ownership = resolveWorktreeOwnership(cwdReal, worktrees);
  if (!ownership.ok) {
    return { verdict: "unverified", detail: `could not resolve worktree path ${ownership.path}, so branch ownership is unknown` };
  }
  const owner = ownership.ownerByBranch.get(opts.branch);
  if (owner) {
    return {
      verdict: "refuse",
      reason: "worktree",
      detail: `${opts.branch} is already checked out in another worktree at ${owner.path}`,
    };
  }

  const stackVerdict = await checkStackMembership({
    cwd: opts.cwd,
    branch: opts.branch,
    defaultBranch: opts.defaultBranch,
    runners: opts.runners,
  });
  if (stackVerdict.verdict === "refuse") {
    return { verdict: "refuse", reason: "stack", detail: stackVerdict.refusal.hint };
  }
  if (stackVerdict.verdict === "unverified") {
    return { verdict: "unverified", detail: stackVerdict.refusal.hint };
  }
  return { verdict: "clear" };
}

/**
 * Batch worktree-ownership lookup for a display badge, not an enforcement
 * gate: mission's branch modal needs every guarded branch's reason up
 * front, not one at a time as the user highlights rows, and unlike
 * checkBranchGuard this never runs checkStackMembership (which can reach
 * the network via the forge) -- listing every branch's guard state must
 * stay cheap enough to call on every refresh. checkBranchGuard remains the
 * sole enforcement point; a branch missing here (an unresolvable worktree
 * path, cwd itself unresolvable, or `git worktree list` failing outright)
 * degrades to an empty map rather than a thrown error, since a display gap
 * must never block the refresh it decorates.
 */
export async function buildWorktreeGuardMap(
  cwd: string,
  listWorktrees: typeof listWorktreesAsync = listWorktreesAsync,
): Promise<Map<string, string>> {
  const guards = new Map<string, string>();
  const worktrees = await listWorktrees(cwd);
  if (worktrees === null) return guards;

  let cwdReal: string;
  try {
    cwdReal = realpathSync(cwd);
  } catch {
    return guards;
  }

  const ownership = resolveWorktreeOwnership(cwdReal, worktrees);
  if (!ownership.ok) return guards;

  for (const [branch, owner] of ownership.ownerByBranch) {
    guards.set(branch, `${branch} is already checked out in another worktree at ${owner.path}`);
  }
  return guards;
}
