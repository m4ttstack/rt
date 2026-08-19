import { getMRDashboardProps, getReviewDisplayState, stripDraftPrefix as glanceStripDraftPrefix, type MRDashboardProps, type PullRequest } from "@mattstack/glance";
import type { BoardConfig, Member } from "./config.ts";
import type { DemandDecl } from "@mattstack/rt-client";
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
  /** Draft (unfinished) MR. Only your own drafts reach the board, so this also
      means "yours, and not marked ready yet" -- see buildBoard. */
  isDraft: boolean;
  /** Scoped repo id ("gitlab:42"), for the lazy discussions fetch on hover. */
  repositoryId: string;
  /** rt repo name for daemon reads (config.rtRepos[projectPath]); null when the
      project has no mapping, which surfaces as a fetch error server-side. */
  rtRepo: string | null;
};

export interface Snapshot {
  mrs: BoardMR[];
  fetchedAt: number;
  /** Set when the latest refresh failed and this data is older than it should be. */
  fetchError: string | null;
  /** Oldest per-project `syncedAt` among the daemon reads that fed this
      snapshot; null when none yielded one (every project errored). */
  dataSyncedAt: number | null;
  /** Union of `scope.uncovered` across the daemon reads: authors whose
      window some project's sync didn't reach. */
  scopeUncovered: string[];
  /** Narrowest `scope.windowDays` among the daemon reads; null when no read
      carried a scope. */
  scopeWindowDays: number | null;
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

/** BOARD-17: upstream avatar URLs can embed a GitLab `private_token` query
    param, and /data.json ships to every board viewer. The client never renders
    avatarUrl (Invadr draws avatars from usernames), so null the field wherever
    it appears — author, assignees, reviewers, approvedBy, mergeUser, and any
    user object a future glance version adds — rather than enumerate shapes. */
function scrubAvatarUrls(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) scrubAvatarUrls(v);
    return;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if ("avatarUrl" in rec) rec.avatarUrl = null;
    for (const key of Object.keys(rec)) scrubAvatarUrls(rec[key]);
  }
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
    if (pr.state !== "opened") continue;
    if (!pr.author || !members.has(pr.author.username)) continue;
    // Someone else's draft isn't yours to act on, so it stays off the board;
    // your own show up with a DRAFT chip and a "mark ready" action. With
    // defaultMember "all" there's no single "you", so no drafts are shown.
    if (pr.draft && pr.author.username !== config.defaultMember) continue;
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
    // Mutates the freshly-parsed daemon read, never a cached board: each fetch
    // JSON-parses its own objects, and the snapshot cache holds this output.
    scrubAvatarUrls(props);
    out.push({
      ...props,
      updatedAt: pr.updatedAt,
      createdAt: pr.createdAt,
      // glance >=0.14: unresolvedThreadCount is number | null (null = the
      // provider could not determine it). GitLab always reports a number, and
      // the server refines both fields from discussions for commented MRs, so
      // 0 is a safe floor here rather than a claim that all threads resolved.
      unresolvedThreads: pr.unresolvedThreadCount ?? 0,
      // Coarse fallback; the server refines this from discussions for commented MRs.
      reviewerComments: pr.unresolvedThreadCount ?? 0,
      pipelineState: derivePipelineState(props),
      isDraft: pr.draft === true,
      repositoryId: pr.repositoryId,
      rtRepo: config.rtRepos[path] ?? null,
    });
  }
  return out;
}

/** The legacy WIP spellings, which pre-14.0 self-hosted GitLab still honours.
    glance's stripDraftPrefix owns the modern marker set; only the wip extension
    is this board's own display choice. */
const LEGACY_WIP_PREFIX = /^\s*(?:\[wip\]|\(wip\)|wip:)\s*/i;

/** Drop the draft marker from an MR title, for display only. Writing the marker
    is glance's job (GitLabProvider.updatePullRequest), which also verifies the
    flag landed -- do not reimplement that here. */
export function stripDraftPrefix(title: string): string {
  return glanceStripDraftPrefix(title).replace(LEGACY_WIP_PREFIX, "");
}

/**
 * What the board declares it needs from rt on the full-board fetch: every
 * configured member, including hidden (checked-out) ones -- hidden is a
 * display state, not a demand state, so the daemon still sizes its sync to
 * cover them. Callers must attach this only where the read means "everything
 * this client needs" (fetchTeamMRs); a single-member read declaring demand
 * would tell the daemon the roster is just that one member.
 */
export function boardDemand(config: BoardConfig): DemandDecl {
  return {
    client: `mr-board:${config.port}`,
    authors: config.members.map((m) => m.username),
    declaredAt: Date.now(),
  };
}

/** One project's sync facts, the shape aggregateSyncScope folds across projects. */
export interface SyncScopeRead {
  syncedAt: number;
  scope?: { authors: string[]; windowDays: number; uncovered: string[] };
}

/**
 * Fold the per-project daemon reads that built one snapshot into one
 * board-wide picture. `dataSyncedAt` is the oldest syncedAt (the board is
 * only as fresh as its stalest project); `scopeUncovered` unions every
 * project's uncovered authors; `scopeWindowDays` is the narrowest window
 * (the tightest constraint any project reported). A project that errored
 * before yielding a read is simply absent from `reads`.
 */
export function aggregateSyncScope(
  reads: SyncScopeRead[],
): { dataSyncedAt: number | null; scopeUncovered: string[]; scopeWindowDays: number | null } {
  let dataSyncedAt: number | null = null;
  let scopeWindowDays: number | null = null;
  const uncovered = new Set<string>();
  for (const read of reads) {
    dataSyncedAt = dataSyncedAt === null ? read.syncedAt : Math.min(dataSyncedAt, read.syncedAt);
    if (read.scope) {
      scopeWindowDays = scopeWindowDays === null ? read.scope.windowDays : Math.min(scopeWindowDays, read.scope.windowDays);
      for (const author of read.scope.uncovered) uncovered.add(author);
    }
  }
  return { dataSyncedAt, scopeUncovered: [...uncovered], scopeWindowDays };
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
