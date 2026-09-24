/**
 * When a `disposal: "job"` tree stops being its herd's to end. Until then the
 * merge reactor and the stale-claim sweep leave it alone; after, it takes the
 * same guarded path a merge tree does. Nothing else ever ends a job tree
 * (herd wrap-up only disposes the jobs a shepherd names), so without this a
 * herd's trees outlive it indefinitely.
 */

import { canon } from "../../fs-canon.ts";
import type { HerdStore } from "../herd-store.ts";
import type { TreeRecord } from "../../worktree/registry.ts";

const HERD_OWNER_PREFIX = "herd:";
const ENDED_JOB_STATUSES = new Set(["closed", "crashed"]);

/**
 * Why the tree is still held, or null once it is released. A job counts as
 * ended only when it is closed or crashed, or when its whole herd has wrapped:
 * a `done` job's pane can still pick up a follow-up in the same tree.
 */
export function herdJobTreeHold(store: Pick<HerdStore, "get" | "jobs">, rec: TreeRecord): string | null {
  const owner = rec.owner;
  if (!owner) return "job tree with no owner";
  if (!owner.startsWith(HERD_OWNER_PREFIX)) return `job tree owned by ${owner}`;
  const herdId = owner.slice(HERD_OWNER_PREFIX.length);
  const herd = store.get(herdId);
  if (!herd || herd.status === "wrapped") return null;

  // Pool slot paths are reused across jobs in one herd, and an earlier job's
  // row keeps moving (its pane closing) after the slot changed hands, so match
  // on the branch the tree carries rather than on recency.
  const path = canon(rec.path);
  const jobs = store
    .jobs(herdId)
    .filter((j) => canon(j.worktree) === path && (j.branch === null || j.branch === rec.branch));
  if (jobs.length === 0) return `herd ${herdId} is active`;
  const live = jobs.find((j) => !ENDED_JOB_STATUSES.has(j.status));
  return live ? `herd job ${herdId}/${live.name} is ${live.status}` : null;
}
