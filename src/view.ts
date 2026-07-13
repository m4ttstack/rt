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

export interface Group {
  label: string;
  mrs: BoardMR[];
}

/** Age band for an MR by creation date: by day for the first week, then weekly. */
function ageBucket(createdAt: string | null, now: number): { label: string; order: number } {
  if (!createdAt) return { label: "Unknown", order: 1000 };
  const days = Math.floor((now - Date.parse(createdAt)) / 86_400_000);
  if (days <= 0) return { label: "Today", order: 0 };
  if (days === 1) return { label: "Yesterday", order: 1 };
  if (days <= 6) return { label: `${days} days ago`, order: days };
  if (days <= 13) return { label: "Last week", order: 7 };
  if (days <= 20) return { label: "2 weeks ago", order: 8 };
  return { label: "Older", order: 9 };
}

/** Coarse review-readiness bucket, most-blocking first. */
function statusBucket(mr: BoardMR): { label: string; order: number } {
  const b = mr.blockers;
  if (b.hasConflicts) return { label: "conflicts", order: 0 };
  if (b.pipelineFailing) return { label: "ci failing", order: 1 };
  if (mr.reviews.isApproved) return { label: "approved", order: 4 };
  if (mr.reviews.given > 0) return { label: "in review", order: 3 };
  return { label: "needs review", order: 2 };
}

const PIPELINE_LABEL: Record<PipelineState, string> = {
  failed: "pipeline failed",
  running: "pipeline running",
  none: "no pipeline",
  passed: "pipeline passed",
};

/** Group by a keyed bucket, ordering groups by the bucket's `order`. */
function groupBy(mrs: BoardMR[], bucket: (mr: BoardMR) => { label: string; order: number }): Group[] {
  const map = new Map<string, { order: number; mrs: BoardMR[] }>();
  for (const mr of mrs) {
    const b = bucket(mr);
    const entry = map.get(b.label) ?? { order: b.order, mrs: [] };
    entry.mrs.push(mr);
    map.set(b.label, entry);
  }
  return [...map.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([label, entry]) => ({ label, mrs: entry.mrs }));
}

/** One group per member, in config order; members with no MRs are skipped. */
function groupByAuthor(mrs: BoardMR[], memberOrder: string[]): Group[] {
  const rank = new Map(memberOrder.map((u, i) => [u, i]));
  const byUser = new Map<string, BoardMR[]>();
  for (const mr of mrs) {
    const u = mr.author.username;
    const list = byUser.get(u) ?? [];
    list.push(mr);
    byUser.set(u, list);
  }
  return [...byUser.entries()]
    .sort((a, b) => (rank.get(a[0]) ?? 999) - (rank.get(b[0]) ?? 999))
    .map(([username, list]) => ({ label: list[0]!.author.name || username, mrs: list }));
}

/**
 * Partition MRs into ordered display groups. Groups are ordered naturally for
 * the dimension; ordering WITHIN each group is the caller's job (apply sortMRs
 * to each group's `mrs`).
 */
export function groupMRs(mrs: BoardMR[], group: GroupKey, memberOrder: string[], now: number): Group[] {
  switch (group) {
    case "age":
      return groupBy(mrs, (mr) => ageBucket(mr.createdAt, now));
    case "author":
      return groupByAuthor(mrs, memberOrder);
    case "status":
      return groupBy(mrs, statusBucket);
    case "pipeline":
      return groupBy(mrs, (mr) => ({
        label: PIPELINE_LABEL[mr.pipelineState],
        order: PIPELINE_RANK[mr.pipelineState],
      }));
  }
}
