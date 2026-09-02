import type { NormMr } from "../pipeline/model.js";
import { REVERT_TITLE_RE } from "../../shared/reverts.js";

/**
 * Revert detection (spec 4.7) ... heuristic, free-tier only.
 *
 * A merged MR is considered "reverted" when a later MR either:
 *  - has the auto-generated title `Revert "<original title>"`, or
 *  - carries a `revert` label and names the original in its title.
 *
 * We collect the set of original titles that some revert MR targets, then mark
 * any MR whose own title is in that set as reverted. This undercounts
 * fix-forward fixes (a fresh MR that isn't a formal revert) ... label the metric
 * "detected reverts only" in the UI.
 */

/** Extract the original title a revert MR points at, or null if it isn't a revert. */
export function revertTarget(mr: NormMr): string | null {
  const m = mr.title.match(REVERT_TITLE_RE);
  if (m) return normalizeTitle(m[1]!);
  // Fallback: a `revert` label + quoted original anywhere in the title.
  if (mr.labels.some((l) => l.toLowerCase() === "revert")) {
    const q = mr.title.match(/"(.+)"/);
    if (q) return normalizeTitle(q[1]!);
  }
  return null;
}

/** Build the set of original titles that were reverted by some MR in the corpus. */
export function buildRevertedTitleSet(mrs: readonly NormMr[]): Set<string> {
  const set = new Set<string>();
  for (const mr of mrs) {
    const target = revertTarget(mr);
    if (target) set.add(target);
  }
  return set;
}

export function isReverted(mr: NormMr, revertedTitles: Set<string>): boolean {
  return revertedTitles.has(normalizeTitle(mr.title));
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}
