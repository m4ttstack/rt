export interface MrMapRow {
  ref: string;
  title: string;
  sourceBranch: string;
  worktree: string | null;
  mrState: string;
  ciStatus: string | null;
}

export function joinMrsToWorktrees(
  mrs: Array<{ iid: number; title: string; sourceBranch: string; state: string; pipelineStatus: string | null }>,
  trees: Array<{ path: string; branch: string | null }>,
): MrMapRow[] {
  // Last write wins for duplicates.
  const branchToPath = new Map<string, string>();
  for (const tree of trees) {
    if (tree.branch !== null) {
      branchToPath.set(tree.branch, tree.path);
    }
  }

  return mrs.map((mr) => ({
    ref: `!${mr.iid}`,
    title: mr.title,
    sourceBranch: mr.sourceBranch,
    worktree: branchToPath.get(mr.sourceBranch) ?? null,
    mrState: mr.state,
    ciStatus: mr.pipelineStatus,
  }));
}
