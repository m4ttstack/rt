import { getMRDashboardProps, getReviewDisplayState, type MRDashboardProps, type PullRequest } from "@workforge/glance-sdk";
import type { BoardConfig, Member } from "./config.ts";
import { extractTicketId } from "./ticket.ts";

export type PipelineState = "passed" | "running" | "failed" | "none";

/** Dashboard props plus the raw fields the board renders that props omit. */
export type BoardMR = MRDashboardProps & {
  updatedAt: string | null;
  createdAt: string | null;
  unresolvedThreads: number;
  /** Unresolved threads a reviewer (non-author) participated in — excludes the
      author's own solo threads. Starts as unresolvedThreads; the server refines
      it by fetching discussions for commented MRs. Drives the "commented" state. */
  reviewerComments: number;
  /** Per-status counts of the reviewer threads, set by the same discussions
      fetch that refines `reviewerComments`. Drives the row's comment-action dot
      (amber while any thread awaits the author, green once all are handled).
      Undefined when the discussions fetch was skipped or failed. */
  threadSummary?: { awaiting: number; replied: number; resolved: number };
  /** Count of general (non-resolvable) MR comments — the Overview-tab notes that
      aren't resolvable threads. Drives the 💬 token's total and lets a
      general-comment-only MR still be flagged as having comment activity. */
  generalComments?: number;
  pipelineState: PipelineState;
  /** Scoped repo id ("gitlab:42"), for the lazy discussions fetch on hover. */
  repositoryId: string;
};

export interface Snapshot {
  mrs: BoardMR[];
  fetchedAt: number;
  /** Set when the latest refresh failed and this data is older than it should be. */
  fetchError: string | null;
}

/** Parse "group/project" out of a GitLab MR web URL. */
export function projectPathFromWebUrl(webUrl: string, gitlabHost: string): string | null {
  if (!webUrl.startsWith(gitlabHost)) return null;
  const rest = webUrl.slice(gitlabHost.length).replace(/^\//, "");
  const idx = rest.indexOf("/-/");
  return idx === -1 ? null : rest.slice(0, idx);
}

/** Collapse the SDK's pipeline signals into one grouping/sorting key. */
function derivePipelineState(props: MRDashboardProps): PipelineState {
  if (!props.pipeline) return "none";
  if (props.blockers.pipelineFailing) return "failed";
  if (props.blockers.pipelineRunning) return "running";
  return "passed";
}

/**
 * Shape raw MRs into a flat board list: authored by a configured member, open,
 * not draft, in a configured project. Each MR is tagged with its author, created
 * / updated timestamps, unresolved-thread count, and derived pipeline state. The
 * client owns all grouping and sorting, so this list is unsorted.
 */
export function buildBoard(prs: PullRequest[], config: BoardConfig, now: number = Date.now()): BoardMR[] {
  const members = new Set(config.members.map((m) => m.username));
  const projects = new Set(config.projects);
  const staleCutoff = now - config.staleAfterDays * 86_400_000;
  const prefixes = new Set(config.ticketPrefixes);
  const out: BoardMR[] = [];
  for (const pr of prs) {
    if (pr.draft || pr.state !== "opened") continue;
    if (!pr.author || !members.has(pr.author.username)) continue;
    // Drop MRs gone quiet: no activity (last update) within the stale window.
    if (pr.updatedAt && Date.parse(pr.updatedAt) < staleCutoff) continue;
    // Team filter: keep only MRs whose Linear ticket prefix is configured.
    // No prefixes configured → keep everything. Untagged MRs are dropped.
    if (prefixes.size > 0) {
      const ticket = extractTicketId(pr.sourceBranch, pr.title);
      const prefix = ticket ? ticket.slice(0, ticket.indexOf("-")) : null;
      if (!prefix || !prefixes.has(prefix)) continue;
    }
    const path = pr.webUrl ? projectPathFromWebUrl(pr.webUrl, config.gitlabHost) : null;
    if (!path || !projects.has(path)) continue;
    const props = getMRDashboardProps(pr);
    out.push({
      ...props,
      updatedAt: pr.updatedAt,
      createdAt: pr.createdAt,
      unresolvedThreads: pr.unresolvedThreadCount,
      // Coarse fallback; the server refines this from discussions for commented MRs.
      reviewerComments: pr.unresolvedThreadCount,
      pipelineState: derivePipelineState(props),
      repositoryId: pr.repositoryId,
    });
  }
  return out;
}

/** Stable per-MR key for the discussion-fetch memory (survives across refreshes). */
export function mrKey(mr: Pick<BoardMR, "repositoryId" | "iid">): string {
  return `${mr.repositoryId}:${mr.iid}`;
}

/**
 * MRs whose discussions should be fetched to refine review state: those with
 * unresolved threads right now, plus any the caller has already seen carrying
 * reviewer comments (`everCommented`). The second set is what lets an MR whose
 * threads were all resolved keep being fetched, so it can show "comments
 * resolved" instead of silently dropping back to "needs review".
 */
export function discussionFetchTargets(mrs: BoardMR[], everCommented: ReadonlySet<string>): BoardMR[] {
  return mrs.filter((m) => m.unresolvedThreads > 0 || everCommented.has(mrKey(m)));
}

/**
 * Whether any assigned reviewer has formally requested changes — the GitLab
 * "changes requested" review state, distinct from someone merely leaving
 * comments. Comes from `reviews.reviewers[].reviewState`.
 */
export function hasChangesRequested(mr: BoardMR): boolean {
  return mr.reviews.reviewers?.some((r) => getReviewDisplayState(r.reviewState ?? null) === "changes_requested") ?? false;
}

export interface RosterMember {
  username: string;
  name: string | null;
  count: number;
}

/** Members in config order, each with a resolved name and open-MR count. */
export function buildRoster(members: Member[], mrs: BoardMR[], names: Map<string, string | null>): RosterMember[] {
  return members.map((member) => ({
    username: member.username,
    name: names.get(member.username) ?? member.name ?? null,
    count: mrs.filter((mr) => mr.author.username === member.username).length,
  }));
}
