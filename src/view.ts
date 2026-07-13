import type { BoardMR, PipelineState } from "./data.ts";

export type GroupKey = "age" | "author" | "status" | "pipeline";
export type SortKey = "oldest" | "pipeline" | "progress";

export const GROUP_KEYS: readonly GroupKey[] = ["age", "author", "status", "pipeline"];
export const SORT_KEYS: readonly SortKey[] = ["oldest", "pipeline", "progress"];

/** Sentinel that sorts after any ISO date, so null timestamps land last. */
const LATEST = "9999";

const PIPELINE_RANK: Record<PipelineState, number> = { failed: 0, running: 1, none: 2, passed: 3 };

/** Approval ratio in [0,1]; used by the "progress" sort. */
function progress(mr: BoardMR): number {
  const req = mr.reviews.required;
  if (req > 0) return mr.reviews.given / req;
  return mr.reviews.given > 0 ? 1 : 0;
}

export function filterByMember(mrs: BoardMR[], member: string): BoardMR[] {
  return member === "all" ? mrs : mrs.filter((m) => m.author.username === member);
}

/** Return a new array ordered by the chosen sort. Never mutates the input. */
export function sortMRs(mrs: BoardMR[], sort: SortKey): BoardMR[] {
  const byOldest = (a: BoardMR, b: BoardMR) => (a.createdAt ?? LATEST).localeCompare(b.createdAt ?? LATEST);
  const copy = [...mrs];
  switch (sort) {
    case "oldest":
      copy.sort(byOldest);
      break;
    case "pipeline":
      copy.sort((a, b) => PIPELINE_RANK[a.pipelineState] - PIPELINE_RANK[b.pipelineState] || byOldest(a, b));
      break;
    case "progress":
      copy.sort((a, b) => progress(b) - progress(a) || byOldest(a, b));
      break;
  }
  return copy;
}
