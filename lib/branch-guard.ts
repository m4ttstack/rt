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
  let containing: WorktreeEntry | undefined;
  for (const w of worktrees) {
    // A listed path can vanish between the list call and here (another
    // process disposing the worktree); that race must fall through to
    // "unverified", never throw out of a guard that other code treats as total.
    let entryReal: string;
    try {
      entryReal = realpathSync(w.path);
    } catch {
      return { verdict: "unverified", detail: `could not resolve worktree path ${w.path}, so branch ownership is unknown` };
    }
    if (cwdReal === entryReal || cwdReal.startsWith(entryReal + sep)) {
      containing = w;
      break;
    }
  }
  const owner = worktrees.find((w) => w !== containing && w.branch === opts.branch);
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
