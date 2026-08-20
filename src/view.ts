import type { BoardMR } from "./data.ts";
import { hasChangesRequested } from "./data.ts";
import { projectKeyOf } from "./triage/stack.ts";

export type GroupKey = "age" | "author" | "status" | "review";
export type SortKey = "oldest" | "progress";

export const GROUP_KEYS: readonly GroupKey[] = ["age", "author", "status", "review"];
export const SORT_KEYS: readonly SortKey[] = ["oldest", "progress"];

/** Sentinel that sorts after any ISO date, so null timestamps land last. */
const LATEST = "9999";

/** Whether the author has acted on the row's unresolved comment threads, for the
    dot beside "N comments": amber while any thread awaits the author, green once
    they've replied to every one. Resolved threads have already left the count, so
    they never force amber. Null when there's no per-thread breakdown (fetch
    skipped/failed) or nothing unresolved to describe. */
export function commentDot(
  summary: BoardMR["threadSummary"],
): { cls: "ok" | "warn"; title: string } | null {
  if (!summary) return null;
  const { awaiting, replied } = summary;
  if (awaiting + replied === 0) return null;
  if (awaiting > 0) {
    const parts = [`${awaiting} awaiting your reply`];
    if (replied > 0) parts.push(`${replied} you replied to`);
    return { cls: "warn", title: parts.join(" · ") };
  }
  return { cls: "ok", title: "you've replied to every comment" };
}

/** True when every reviewer thread has been resolved and none awaits action — the
    MR was reviewed and its comments are handled, distinct from an untouched "needs
    review". Relies on the `threadSummary` the server attaches; undefined summary
    means the board has no per-thread breakdown (never fetched), so this is false
    and the MR falls back to "needs review". */
export function commentsAllResolved(mr: BoardMR): boolean {
  const s = mr.threadSummary;
  return mr.reviewerComments === 0 && !!s && s.resolved > 0 && s.awaiting + s.replied === 0;
}

/** Board freshness is the daemon's syncedAt, not the board's own poll loop --
    a poll can succeed against data the daemon hasn't refreshed in a while, so
    "just fetched" and "actually fresh" are different claims. Stale past 10
    minutes; unknown (no daemon read reached this board) is treated as stale
    too, since there's nothing to vouch for it. */
export function dataAgeLabel(dataSyncedAt: number | null, now: number): { text: string; stale: boolean } {
  // <= 0 covers a cold shell record's syncedAt (no daemon read has landed
  // yet) -- epoch zero is not a real sync time, and rendering it as
  // "data as of 1:00" (local-timezone midnight) is misleading, not stale-but-honest.
  if (dataSyncedAt === null || dataSyncedAt <= 0) return { text: "data age unknown", stale: true };
  const stale = now - dataSyncedAt > 10 * 60_000;
  const d = new Date(dataSyncedAt);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { text: `data as of ${hh}:${mm}`, stale };
}

/** The three token classes a status flag can carry. Named as a union rather
    than a bare `string` because the client translates each one into a Chip
    intent: with `string` that lookup needed a silent `?? "muted"` fallback,
    which would have quietly greyed out a fourth class instead of failing.
    This module stays DOM-free and knows nothing of the kit's vocabulary — the
    translation is RowView's, the exhaustiveness is this type's. */
export type FlagClass = "t-bad" | "t-warn" | "t-cyan";

/** GitLab-native facts shown as chips above the title: mechanical blockers
    (conflicts / CI), most severe first, plus the stacked marker for MRs
    targeting a parent branch instead of the default branch. */
export function statusFlags(mr: BoardMR, opts?: { nested?: boolean }): { text: string; cls: FlagClass }[] {
  const b = mr.blockers;
  const flags: { text: string; cls: FlagClass }[] = [];
  if (b?.hasConflicts) flags.push({ text: "conflicts", cls: "t-bad" });
  if (b?.pipelineFailing) flags.push({ text: "ci failing", cls: "t-bad" });
  if (b?.pipelineRunning) flags.push({ text: "ci running", cls: "t-warn" });
  // A row nested under its parent already shows the relationship; the chip
  // only earns its place when the parent is not visible above the row.
  if (mr.isStacked && !opts?.nested) flags.push({ text: `stacked → ${mr.targetBranch}`, cls: "t-cyan" });
  return flags;
}

export interface StackNode {
  mr: BoardMR;
  /** Stacked MRs whose parent is `mr`, in the input list's order. */
  children: StackNode[];
}

/** Resolve child -> parent links across a set of MRs: a stacked MR whose
    target branch is another MR's source branch (same project) is that MR's
    child. Same-project matching and cycle handling mirror triage/stack.ts: a
    branch cycle is malformed data, so its members are left parentless rather
    than vanishing into an unwalkable loop. Shared by nestStacks (which draws
    the tree) and groupMRs (which pulls a child into its parent's group), so
    the two can never disagree about who is whose child. */
function stackParents(mrs: BoardMR[]): Map<BoardMR, BoardMR> {
  const branchKey = (mr: BoardMR, branch: string) => `${projectKeyOf(mr.webUrl ?? "")}::${branch}`;
  const bySource = new Map<string, BoardMR>();
  for (const m of mrs) {
    if (m.webUrl) bySource.set(branchKey(m, m.sourceBranch), m);
  }

  const parentOf = new Map<BoardMR, BoardMR>();
  for (const m of mrs) {
    if (!m.isStacked || !m.webUrl) continue;
    const parent = bySource.get(branchKey(m, m.targetBranch));
    if (parent && parent !== m) parentOf.set(m, parent);
  }
  // Sever cycles: every MR whose parent walk revisits a node renders flat.
  // Collected first, deleted after, so one member's severed link can't hide
  // the cycle from the other members' walks.
  const cyclic: BoardMR[] = [];
  for (const m of parentOf.keys()) {
    const seen = new Set<BoardMR>([m]);
    for (let p = parentOf.get(m); p; p = parentOf.get(p)) {
      if (seen.has(p)) {
        cyclic.push(m);
        break;
      }
      seen.add(p);
    }
  }
  for (const m of cyclic) parentOf.delete(m);
  return parentOf;
}

/** Shape one group's (already sorted) list into stack trees: a stacked MR
    whose parent is in the same list nests under it; everything else stays a
    root in input order. Run per group AFTER grouping -- groupMRs has already
    pulled every child into its parent's group, so a stack that spans buckets
    arrives here intact. */
export function nestStacks(mrs: BoardMR[]): StackNode[] {
  const parentOf = stackParents(mrs);

  const nodes = new Map<BoardMR, StackNode>(mrs.map((m) => [m, { mr: m, children: [] }]));
  const roots: StackNode[] = [];
  for (const m of mrs) {
    const parent = parentOf.get(m);
    if (parent) nodes.get(parent)!.children.push(nodes.get(m)!);
    else roots.push(nodes.get(m)!);
  }
  return roots;
}

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
  // Order by last activity (updatedAt) — the same axis the row's age token and
  // the age grouping use — so "oldest" means stalest-first and the visible ages
  // read in order. (Was createdAt, which mismatched the displayed times.)
  const byOldest = (a: BoardMR, b: BoardMR) => (a.updatedAt ?? LATEST).localeCompare(b.updatedAt ?? LATEST);
  const copy = [...mrs];
  switch (sort) {
    case "oldest":
      copy.sort(byOldest);
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

/** Age band by last activity: by day for the first week, then weekly. Uses the
    same date as the row's "last updated" token and the stale gate, so a group
    label always matches the age shown on its rows. */
function ageBucket(lastActivity: string | null, now: number): { label: string; order: number } {
  if (!lastActivity) return { label: "Unknown", order: 1000 };
  const days = Math.floor((now - Date.parse(lastActivity)) / 86_400_000);
  if (days <= 0) return { label: "Today", order: 0 };
  if (days === 1) return { label: "Yesterday", order: 1 };
  if (days <= 6) return { label: `${days} days ago`, order: days };
  if (days <= 13) return { label: "Last week", order: 7 };
  if (days <= 20) return { label: "2 weeks ago", order: 8 };
  return { label: "Older", order: 9 };
}

/** Coarse review-readiness bucket, most-blocking first. Mirrors the row's
    status label: a formal "changes requested" review is distinct from someone
    just leaving comments. Partial approvals fold into "needs review". */
function statusBucket(mr: BoardMR): { label: string; order: number } {
  // Review-state axis only. Mechanical blockers (conflicts / CI) are row flags,
  // not their own groups, so an MR with conflicts still shows under its review
  // state instead of being hidden in a "conflicts" bucket.
  if (hasChangesRequested(mr)) return { label: "changes requested", order: 0 };
  if (mr.reviews.isApproved) return { label: "approved", order: 4 };
  if (mr.reviewerComments > 0) return { label: "commented", order: 1 };
  // Reviewed and all threads resolved, just not formally approved — further along
  // than an untouched MR, so it sits between "needs review" and "approved".
  if (commentsAllResolved(mr)) return { label: "comments resolved", order: 3 };
  return { label: "needs review", order: 2 };
}

/** An MR carrying the app-initiated review status the client attaches at
    render time. Kept as a loose local shape (not imported from review-state.ts)
    so view.ts stays free of that module's `fs` deps and can bundle for the
    browser. */
type ReviewedMR = BoardMR & { review?: { status: "queued" | "reviewing" | "done" | "error" } };

/** Bucket by the review a member kicked off through the board, most-active
    first. MRs with no launched review fall to "not reviewed". Orthogonal to
    `statusBucket`, which reflects GitLab's own review state. */
function reviewBucket(mr: ReviewedMR): { label: string; order: number } {
  switch (mr.review?.status) {
    case "reviewing":
      return { label: "reviewing", order: 0 };
    case "queued":
      return { label: "queued", order: 1 };
    case "done":
      return { label: "review ready", order: 2 };
    case "error":
      return { label: "review failed", order: 3 };
    default:
      return { label: "not reviewed", order: 4 };
  }
}

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

/** Move every stacked child into the group holding the root of its stack, so
    a stack always renders as one nested cluster instead of being scattered
    across buckets by facts (age, CI state, reviewer) that differ per MR while
    the branch chain does not. The root's own bucket decides for the whole
    stack; groups emptied by the move are dropped, and group order and the
    order within each group are otherwise untouched. */
function pullStacksIntoParentGroups(groups: Group[], mrs: BoardMR[]): Group[] {
  const parentOf = stackParents(mrs);
  if (parentOf.size === 0) return groups;

  const groupOf = new Map<BoardMR, number>();
  groups.forEach((g, i) => {
    for (const m of g.mrs) groupOf.set(m, i);
  });
  // Walk to the root, not just the immediate parent: in a 3-deep stack the
  // middle MR may itself be moving, so only the root's bucket is settled.
  // stackParents has already severed cycles, so the walk terminates.
  const rootGroupOf = (mr: BoardMR): number => {
    let cur = mr;
    for (;;) {
      const p = parentOf.get(cur);
      if (!p) return groupOf.get(cur)!;
      cur = p;
    }
  };

  const moved: BoardMR[][] = groups.map(() => []);
  for (const g of groups) {
    for (const m of g.mrs) moved[rootGroupOf(m)]!.push(m);
  }
  return groups.map((g, i) => ({ label: g.label, mrs: moved[i]! })).filter((g) => g.mrs.length > 0);
}

/**
 * Partition MRs into ordered display groups. Groups are ordered naturally for
 * the dimension; ordering WITHIN each group is the caller's job (apply sortMRs
 * to each group's `mrs`).
 */
export function groupMRs(mrs: BoardMR[], group: GroupKey, memberOrder: string[], now: number): Group[] {
  const grouped = (): Group[] => {
    switch (group) {
      case "age":
        return groupBy(mrs, (mr) => ageBucket(mr.updatedAt, now));
      case "author":
        return groupByAuthor(mrs, memberOrder);
      case "status":
        return groupBy(mrs, statusBucket);
      case "review":
        return groupBy(mrs as ReviewedMR[], reviewBucket);
    }
  };
  return pullStacksIntoParentGroups(grouped(), mrs);
}

export interface ViewState {
  member: string;
  group: GroupKey;
  sort: SortKey;
}

export const DEFAULT_VIEW: ViewState = { member: "all", group: "age", sort: "oldest" };

/** URL query params win, then stored localStorage values, then defaults. Invalid values are dropped. */
export function parseViewState(
  search: string,
  stored: Partial<ViewState> | null,
  validMembers: string[],
  defaultMember: string = "all",
): ViewState {
  const params = new URLSearchParams(search);
  const members = ["all", ...validMembers];
  const memberFallback = members.includes(defaultMember) ? defaultMember : "all";

  const resolve = <T extends string>(key: keyof ViewState, valid: readonly T[], fallback: T): T => {
    const fromUrl = params.get(key);
    if (fromUrl && valid.includes(fromUrl as T)) return fromUrl as T;
    const fromStore = stored?.[key];
    if (typeof fromStore === "string" && valid.includes(fromStore as T)) return fromStore as T;
    return fallback;
  };

  return {
    member: resolve("member", members, memberFallback),
    group: resolve("group", GROUP_KEYS, "age"),
    sort: resolve("sort", SORT_KEYS, "oldest"),
  };
}

/** Settings-modal peering state for one roster member. A null peered list means
    the GET /peer/boards fetch hasn't resolved: render nothing rather than a
    wrong "invitable". Comparison is canonical (trimmed, lowercased) so a roster
    handle typed with different case never hides a board that is already peered. */
export function memberPeerState(username: string, peered: string[] | null): "peered" | "invitable" | "unknown" {
  if (peered === null) return "unknown";
  const canonical = username.trim().toLowerCase();
  return peered.some((p) => p.trim().toLowerCase() === canonical) ? "peered" : "invitable";
}

/** What the settings modal's join row should say and whether it starts folded.
    `switchboardConfigured` is the client's read of `data.peering !== null`; a
    configured board whose token is missing also reports null peering, and gets
    the open join row, which is exactly right. */
export function joinRowState(
  switchboardConfigured: boolean,
  peering: "ok" | "unauthorized" | null,
): { label: string; collapsed: boolean; warning?: string } {
  if (peering === "unauthorized") {
    return {
      label: "re-join with a new invite",
      collapsed: false,
      warning: "peering token rejected -- re-join with a new invite",
    };
  }
  if (switchboardConfigured) return { label: "re-join with a new invite", collapsed: true };
  return { label: "join peer boards", collapsed: false };
}

/** Query string (with leading "?") carrying only non-default values; "" when all default. */
export function serializeViewState(v: ViewState): string {
  const params = new URLSearchParams();
  if (v.member !== DEFAULT_VIEW.member) params.set("member", v.member);
  if (v.group !== DEFAULT_VIEW.group) params.set("group", v.group);
  if (v.sort !== DEFAULT_VIEW.sort) params.set("sort", v.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}
