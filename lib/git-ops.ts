/**
 * Portable git operations shared by rt's daemon and CLI surfaces.
 *
 * Ported from worktree-context's git.ts — no VS Code dependencies.
 * Uses child_process for all git commands.
 */

import { execSync } from "child_process";

/**
 * Get the current branch name (or null if detached HEAD).
 */
export function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync("git symbolic-ref --quiet --short HEAD", {
      cwd, encoding: "utf8", stdio: "pipe",
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if working tree has uncommitted changes.
 */
export function hasUncommittedChanges(cwd: string): boolean {
  try {
    const stdout = execSync("git status --porcelain", {
      cwd, encoding: "utf8", stdio: "pipe",
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve `remote`'s actual default branch (CodeRabbit finding on PR #353:
 * probing only origin/main and origin/master resolved a repo whose remote
 * defaults to anything else -- develop, trunk, a non-"origin" remote -- to
 * null, silently dropping mission's whole "default branch" section).
 *
 * Three steps, each a fallback for the one before it:
 * 1. `refs/remotes/<remote>/HEAD`, the local remote-tracking symref a
 *    `clone` or `remote set-head` sets, and (verified empirically against
 *    the git on this machine) a plain `fetch` sets too when the server
 *    advertises HEAD -- the common case, no network round trip.
 * 2. `ls-remote --symref <remote> HEAD` asks the remote directly, for a
 *    remote added without ever fetching, or an older git that never wrote
 *    the local symref. Bounded by a timeout so an unreachable remote can't
 *    hang the caller indefinitely.
 * 3. The original origin/main and origin/master probes, verified as local
 *    refs, as the last resort.
 *
 * `remote` defaults to "origin" -- RT-219 tracks resolving the actual
 * remote name generically; this function takes it as a parameter so that
 * lands as a one-line call-site change, not a rewrite here.
 */
export function getRemoteDefaultBranch(cwd: string, remote = "origin"): string | null {
  try {
    const ref = execSync(`git symbolic-ref --quiet --short refs/remotes/${remote}/HEAD`, {
      cwd, encoding: "utf8", stdio: "pipe",
    }).trim();
    if (ref) return ref;
  } catch { /* refs/remotes/<remote>/HEAD not set locally */ }

  try {
    const out = execSync(`git ls-remote --symref ${remote} HEAD`, {
      cwd, encoding: "utf8", stdio: "pipe", timeout: 5000,
    });
    const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
    if (match) return `${remote}/${match[1]}`;
  } catch { /* remote unreachable, or no such remote */ }

  for (const candidate of [`${remote}/main`, `${remote}/master`]) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd, stdio: "pipe" });
      return candidate;
    } catch { /* doesn't exist */ }
  }
  return null;
}
