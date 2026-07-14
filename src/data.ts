import { getMRDashboardProps, getReviewDisplayState, type MRDashboardProps, type PullRequest } from "@workforge/glance-sdk";
import type { BoardConfig, Member } from "./config.ts";

export type PipelineState = "passed" | "running" | "failed" | "none";

/** Dashboard props plus the raw fields the board renders that props omit. */
export type BoardMR = MRDashboardProps & {
  updatedAt: string | null;
  createdAt: string | null;
  unresolvedThreads: number;
  pipelineState: PipelineState;
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
  const out: BoardMR[] = [];
  for (const pr of prs) {
    if (pr.draft || pr.state !== "opened") continue;
    if (!pr.author || !members.has(pr.author.username)) continue;
    // Drop MRs gone quiet: no activity (last update) within the stale window.
    if (pr.updatedAt && Date.parse(pr.updatedAt) < staleCutoff) continue;
    const path = pr.webUrl ? projectPathFromWebUrl(pr.webUrl, config.gitlabHost) : null;
    if (!path || !projects.has(path)) continue;
    const props = getMRDashboardProps(pr);
    out.push({
      ...props,
      updatedAt: pr.updatedAt,
      createdAt: pr.createdAt,
      unresolvedThreads: pr.unresolvedThreadCount,
      pipelineState: derivePipelineState(props),
    });
  }
  return out;
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
