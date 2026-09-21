/**
 * Portable git operations shared by rt's daemon and CLI surfaces.
 *
 * Ported from worktree-context's git.ts — no VS Code dependencies.
 * Uses child_process for all git commands.
 */

import { execFileSync, execSync } from "child_process";

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

/** `refs/remotes/<remote>/HEAD`, the local remote-tracking symref a `clone`
 *  or `remote set-head` writes. A plain `fetch` does NOT refresh it once
 *  set, so it can go stale after the server's default branch is renamed --
 *  see `getRemoteDefaultBranch`'s own doc comment. */
function localDefaultBranchSymref(cwd: string, remote: string): string | null {
  try {
    const ref = execSync(`git symbolic-ref --quiet --short refs/remotes/${remote}/HEAD`, {
      cwd, encoding: "utf8", stdio: "pipe",
    }).trim();
    return ref || null;
  } catch {
    return null; // refs/remotes/<remote>/HEAD not set locally
  }
}

/** Asks the remote directly, for a remote added without ever fetching, or a
 *  stale/missing local symref. Bounded by a timeout so an unreachable
 *  remote can't hang the caller indefinitely. */
function remoteDefaultBranchSymref(cwd: string, remote: string): string | null {
  try {
    const out = execSync(`git ls-remote --symref ${remote} HEAD`, {
      cwd, encoding: "utf8", stdio: "pipe", timeout: 5000,
    });
    const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
    return match ? `${remote}/${match[1]}` : null;
  } catch {
    return null; // remote unreachable, or no such remote
  }
}

/**
 * Resolve `remote`'s actual default branch (CodeRabbit finding on PR #353:
 * probing only origin/main and origin/master resolved a repo whose remote
 * defaults to anything else -- develop, trunk, a non-"origin" remote -- to
 * null, silently dropping mission's whole "default branch" section).
 *
 * Two symref probes, ordered by `opts.preferRemote`, each a fallback for the
 * other, then the original origin/main and origin/master probes (verified as
 * local refs) as the last resort:
 *
 * - Default (`preferRemote` unset/false): local symref first, remote
 *   `ls-remote` as fallback. Fast and offline-safe -- for a path that reads
 *   this on every refresh (mission's interactive glitter board), a network
 *   round trip on every keystroke-adjacent redraw would make the TUI
 *   network-bound. Consequence, accepted deliberately: this ordering can
 *   return a stale branch name if the server's default changed since the
 *   local symref was last written (see `remote set-head`'s self-heal below).
 * - `preferRemote: true`: remote `ls-remote` first, local symref as
 *   fallback if the remote is unreachable. Every mutation call site that
 *   acts on the answer (sync, rebase --origin-detection, reset --origin,
 *   the amend/undo history-rewrite guard) passes this, since correctness
 *   there outranks latency and the network is already in play for those
 *   flows.
 *
 * Callers on the fast, local-first path aren't stuck with a stale symref
 * forever, either: `runAction` in `lib/mission/git-actions.ts` re-runs
 * `git remote set-head <remote> -a` after every fetch/pull/pull-rebase, so
 * the local symref self-heals on the actions users already run constantly.
 *
 * `remote` defaults to "origin" -- RT-219 tracks resolving the actual
 * remote name generically; this function takes it as a parameter so that
 * lands as a one-line call-site change, not a rewrite here.
 */
export function getRemoteDefaultBranch(
  cwd: string,
  remote = "origin",
  opts: { preferRemote?: boolean } = {},
): string | null {
  const probes = opts.preferRemote
    ? [() => remoteDefaultBranchSymref(cwd, remote), () => localDefaultBranchSymref(cwd, remote)]
    : [() => localDefaultBranchSymref(cwd, remote), () => remoteDefaultBranchSymref(cwd, remote)];
  for (const probe of probes) {
    const ref = probe();
    if (ref) return ref;
  }

  for (const candidate of [`${remote}/main`, `${remote}/master`]) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd, stdio: "pipe" });
      return candidate;
    } catch { /* doesn't exist */ }
  }
  return null;
}

/**
 * Reads the effective `pull.rebase` config (local, global, or system,
 * whichever `git config --get` resolves), argv-only since the caller never
 * builds a command string here. Any set, non-"false" value (true,
 * interactive, merges, preserve) means a plain `pull` rebases; unset or
 * "false" means it merges.
 */
export function getPullRebase(cwd: string): boolean {
  try {
    const out = execFileSync("git", ["config", "--get", "pull.rebase"], {
      cwd, encoding: "utf8", stdio: "pipe",
    }).trim();
    return out !== "" && out !== "false";
  } catch {
    return false; // unset, or git config exited non-zero
  }
}
