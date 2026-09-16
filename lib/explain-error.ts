/**
 * Turns a worktree-domain daemon error code into the prose the CLI has
 * always shown for it. Its own module (no lib/repo-arg.ts, lib/tui.ts, or
 * other command-layer imports) so lib/mcp/tools.ts can share it without
 * dragging in the CLI's TUI-adjacent graph: an unrecognized code passes
 * through unchanged, so callers outside the worktree domain (gate, chat)
 * are unaffected.
 */
export function explainError(error: string): string {
  if (error === "busy") return "that worktree is locked by another operation right now — try again shortly";
  if (error === "repo-unknown") return "unknown repo — pass --repo <name> or run from inside a registered repo";
  if (error === "branch-unresolved") return "need --branch <name> or --ticket <id> to name the work branch";
  if (error === "no-target") return "need a tree name or --owner to know what to dispose";
  if (error === "tree-ambiguous") return "that tree name matches worktrees in more than one repo — pass --repo to disambiguate";
  if (error === "branch-duplicated") return "that branch is already checked out in more than one worktree — run `rt worktree adopt`";
  if (error.startsWith("branch-attached:")) {
    return `branch is already checked out in worktree "${error.slice("branch-attached:".length)}"`;
  }
  if (error.startsWith("checkout-failed:")) return `checkout failed: ${error.slice("checkout-failed:".length)}`;
  if (error.startsWith("create-failed:")) return `worktree creation failed at step "${error.slice("create-failed:".length)}"`;
  if (error === "not-found") return "no retained trash entry with that name";
  if (error === "no-manifest") return "that entry has no disposal manifest (disposed before RT-51, or the write failed) and cannot be restored";
  if (error === "branch-elsewhere") return "that branch already exists again... restore refuses to clobber it";
  if (error === "no-head-sha") return "the disposal manifest has no recorded commit to restore from";
  if (error === "path-exists") return "the pool root already has a tree at that name";
  if (error === "worktree-add-failed") return "git worktree add failed while restoring";
  if (error === "copy-failed") {
    return "the worktree was recreated but copying the retained tree's gitignored content back failed... " +
      "the checkout and the retained trash entry are both left in place; a plain retry will refuse " +
      "with \"path-exists\", so recover by hand (copy the entry's content over yourself, or `rt worktree dispose --force` the half-restored tree and retry)";
  }
  if (error === "register-failed") {
    return "the worktree was recreated but the registry write did not land, so rt does not know about it yet... " +
      "the checkout and the retained trash entry are both left in place; a plain retry will refuse " +
      "with \"branch-elsewhere\"/\"path-exists\", so recover by hand (`rt worktree adopt --repo <name>` picks up the checkout, or dispose it and retry)";
  }
  return error;
}
