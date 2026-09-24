import type { GitWorktreeBadge } from "../packages/rt-client/src/commands.ts";
import type { FetchState, RepoSnapshot } from "../packages/git-core/src/index.ts";

/** One worktree's badge from a local git read: the daemon's sweep and glitter's live current-worktree row share it. */
export function toBadge(
  worktree: string,
  snap: RepoSnapshot,
  fetch: FetchState,
  updatedAt: string,
): GitWorktreeBadge {
  const files = snap.files;
  return {
    worktree,
    branch: snap.branch,
    detached: snap.detached,
    staged: files.filter((f) => f.staged).length,
    unstaged: files.filter((f) => f.unstaged && f.kind !== "untracked").length,
    untracked: files.filter((f) => f.kind === "untracked").length,
    conflicted: files.filter((f) => f.kind === "conflicted").length,
    clean: snap.clean,
    ahead: snap.ahead,
    behind: snap.behind,
    upstream: snap.upstream,
    lastFetchedAt: fetch.lastFetchedAt,
    updatedAt,
  };
}
