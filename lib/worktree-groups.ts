/**
 * Recency grouping for the worktree pickers: the lead (main) tree stays
 * ungrouped on top, every other tree lands under "today", "this week" or
 * "idle 7d+", and trees the daemon has marked disposable are left out.
 */

import { readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { canon } from "./fs-canon.ts";
import { hasRegistry, loadRegistry, type TreeRecord } from "./worktree/registry.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECENCY_GROUPS = ["today", "this week", "idle 7d+"] as const;
export type RecencyGroup = (typeof RECENCY_GROUPS)[number];

export interface WorktreeGroupSeams {
  registry(repoName: string): TreeRecord[];
  headMovedMs(treePath: string): number;
  now(): number;
}

/**
 * HEAD's reflog is appended on every commit, checkout, reset and pull, so its
 * mtime is when the tree last moved, including trees rt never registered.
 */
function headReflogMs(treePath: string): number {
  try {
    let gitDir = join(treePath, ".git");
    if (statSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, "utf8"));
      if (!m) return NaN;
      gitDir = resolve(treePath, m[1]!.trim());
    }
    return statSync(join(gitDir, "logs", "HEAD")).mtimeMs;
  } catch {
    return NaN;
  }
}

/** Only a present registry is read: loadRegistry on a missing one imports a legacy file, a write the cd path must not make. */
function readRegistry(repoName: string): TreeRecord[] {
  return hasRegistry(repoName) ? loadRegistry(repoName) : [];
}

export function defaultWorktreeGroupSeams(): WorktreeGroupSeams {
  return { registry: readRegistry, headMovedMs: headReflogMs, now: Date.now };
}

export function recencyGroup(activeMs: number, now: number): RecencyGroup {
  if (Number.isNaN(activeMs)) return "idle 7d+";
  if (new Date(activeMs).toDateString() === new Date(now).toDateString()) return "today";
  return now - activeMs < 7 * DAY_MS ? "this week" : "idle 7d+";
}

function lastActiveMs(rec: TreeRecord | undefined, headMs: number): number {
  const candidates = [headMs, Date.parse(rec?.claimedAt ?? ""), Date.parse(rec?.lastActiveAt ?? "")];
  const finite = candidates.filter((ms) => !Number.isNaN(ms));
  return finite.length > 0 ? Math.max(...finite) : NaN;
}

/**
 * `worktrees` is pickerWorktrees order (lead first). The result keeps the lead
 * ungrouped at index 0, then each recency group in RECENCY_GROUPS order with
 * the caller's order preserved inside it.
 */
export function groupWorktrees<T extends { path: string }>(
  repoName: string,
  worktrees: T[],
  seams: WorktreeGroupSeams = defaultWorktreeGroupSeams(),
): { worktrees: T[]; groupOf: Map<string, RecencyGroup> } {
  const groupOf = new Map<string, RecencyGroup>();
  const [lead, ...rest] = worktrees;
  if (!lead) return { worktrees: [], groupOf };

  const records = new Map<string, TreeRecord>();
  for (const rec of seams.registry(repoName)) records.set(canon(rec.path), rec);

  const now = seams.now();
  const buckets = new Map<RecencyGroup, T[]>(RECENCY_GROUPS.map((g) => [g, []]));
  for (const wt of rest) {
    const rec = records.get(canon(wt.path));
    if (rec?.state === "disposable") continue;
    const group = recencyGroup(lastActiveMs(rec, seams.headMovedMs(wt.path)), now);
    groupOf.set(wt.path, group);
    buckets.get(group)!.push(wt);
  }
  return { worktrees: [lead, ...RECENCY_GROUPS.flatMap((g) => buckets.get(g)!)], groupOf };
}
