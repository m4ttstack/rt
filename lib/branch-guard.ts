/**
 * rt-side checkout guard: composes the stack check (lib/stack-guard.ts) with
 * a worktree-ownership check before a branch switch. Order matters: the
 * worktree check is cheap and local, so it runs before the gitq/forge calls.
 */

import { realpathSync } from "node:fs";
import { checkStackMembership, type StackGuardRunners } from "./stack-guard.ts";
import { listWorktreesAsync } from "./worktree/git-async.ts";

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

  const cwdReal = realpathSync(opts.cwd);
  const owner = worktrees.find((w) => w.branch === opts.branch && realpathSync(w.path) !== cwdReal);
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
