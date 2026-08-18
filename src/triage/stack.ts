import type { OwnMrFacts } from "./edge.ts";

/** BOARD-12: the attendant unit is the stack, not the MR. A child branch
    contains its parent's commits, so a red parent means the child is running
    the same failing code, and a fix landing on the parent restacks every
    descendant out from under whatever is working on them. Both facts are
    invisible to a per-MR view, so the dispatcher reconstructs the chain here.

    Deliberately derived from targetBranch/sourceBranch on the MRs the board
    already fetched: no gitq call, no extra API round trip, no new dependency. */

export interface StackChain {
  /** Nearest parent first, walking toward the default branch. */
  ancestors: OwnMrFacts[];
  /** The branch of the first parent we could NOT resolve to a visible MR --
      the chain runs past the board's scope window (see the SCOPE note in
      bin/triage.ts). Null when the chain is fully resolved. */
  unresolvedParentBranch: string | null;
}

/** Project scope for branch matching. Intentionally NOT attendant.ts's
    leaseFileName slug: that string is a shipped cross-repo contract with
    ci-attendant.sh and must not drift for an internal grouping key. */
function projectKeyOf(mrUrl: string): string {
  try {
    const path = new URL(mrUrl).pathname;
    const [project] = path.split("/-/");
    return (project ?? path).replace(/\/\d+$/, "");
  } catch {
    return mrUrl.replace(/\/\d+$/, "");
  }
}

/** Two projects may each carry a branch of the same name; only a same-project
    match is a stack link. */
function branchKey(mr: OwnMrFacts, branch: string): string {
  return `${projectKeyOf(mr.mrUrl)}::${branch}`;
}

/** The ancestry of one MR within the given set. Pure. */
export function chainOf(mrs: OwnMrFacts[], mrUrl: string): StackChain {
  const byUrl = new Map(mrs.map((m) => [m.mrUrl, m]));
  const bySource = new Map(mrs.map((m) => [branchKey(m, m.sourceBranch), m]));

  const self = byUrl.get(mrUrl);
  if (!self) return { ancestors: [], unresolvedParentBranch: null };

  const ancestors: OwnMrFacts[] = [];
  const seen = new Set([mrUrl]);
  let frontier = self;
  for (;;) {
    // Only a stacked MR has a parent to find; one targeting the default
    // branch is the root, and its targetBranch must never be looked up.
    if (!frontier.isStacked) return { ancestors, unresolvedParentBranch: null };
    const parent = bySource.get(branchKey(frontier, frontier.targetBranch));
    if (!parent) return { ancestors, unresolvedParentBranch: frontier.targetBranch };
    // A branch cycle is malformed data, not a stack. Stop rather than hang.
    if (seen.has(parent.mrUrl)) return { ancestors, unresolvedParentBranch: null };
    seen.add(parent.mrUrl);
    ancestors.push(parent);
    frontier = parent;
  }
}
