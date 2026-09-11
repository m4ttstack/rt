import {
  getMRDashboardProps,
  getReviewDisplayState,
  stripDraftPrefix as glanceStripDraftPrefix,
  type MRDashboardProps,
  type PullRequest,
} from '@mattstack/glance';
import type { DemandDecl, ProjectMRsScope } from '@mattstack/rt-client';
import type { ExecutorState, ExecutorView } from './client/types.ts';
import type { BoardConfig, Member } from './config.ts';
import { extractTicketId } from './ticket.ts';

export type PipelineState = 'passed' | 'running' | 'failed' | 'none';

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
  /** Codeowner sections this row was tagged into that a configured codeowners
      tab also declares. Empty when the row wasn't tag-kept (a member's own
      MR) or its tags matched no configured tab. Display filtering by tab is
      Task 11's job -- buildBoard only stamps the intersection. */
  codeownerSections: string[];
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
  /** Union of `scope.uncoveredSections` across the daemon reads: codeowner
      sections some project's sync hasn't swept yet. */
  scopeUncoveredSections: string[];
  /** Union of `scope.knownSections` across the daemon reads: the section
      headers in each project's default-branch CODEOWNERS. Null when no read
      carried the field (an older rt), which disables the wrong-section alarm
      rather than raising it. */
  scopeKnownSections: string[] | null;
}

/** Parse "group/project" out of a GitLab MR web URL. */
export function projectPathFromWebUrl(
  webUrl: string,
  gitlabHost: string
): string | null {
  if (!webUrl.startsWith(gitlabHost)) return null;
  const rest = webUrl.slice(gitlabHost.length).replace(/^\//, '');
  const idx = rest.indexOf('/-/');
  return idx === -1 ? null : rest.slice(0, idx);
}

/** Collapse the SDK's pipeline signals into one grouping/sorting key. */
function derivePipelineState(props: MRDashboardProps): PipelineState {
  if (!props.pipeline) return 'none';
  if (props.blockers.pipelineFailing) return 'failed';
  if (props.blockers.pipelineRunning) return 'running';
  return 'passed';
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
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if ('avatarUrl' in rec) rec.avatarUrl = null;
    for (const key of Object.keys(rec)) scrubAvatarUrls(rec[key]);
  }
}

/**
 * Shape raw MRs into a flat board list: authored by a configured member (or
 * tagged into a configured codeowners tab's section), open, not draft, in a
 * configured project. Each MR is tagged with its author, created / updated
 * timestamps, unresolved-thread count, derived pipeline state, and its kept
 * codeowner tags. The client owns all grouping and sorting, so this list is
 * unsorted. `tags` (keyed by pr.id) is the per-MR codeowner sections a daemon
 * read reported; omitted entirely for callers that never declare
 * codeownerSections demand (e.g. the single-member fetch).
 */
export function buildBoard(
  prs: PullRequest[],
  config: BoardConfig,
  now: number = Date.now(),
  tags?: Map<string, string[]>
): BoardMR[] {
  const members = new Set(config.members.map(m => m.username));
  const projects = new Set(config.projects);
  const staleCutoff = now - config.staleAfterDays * 86_400_000;
  const prefixes = new Set(config.ticketPrefixes);
  const tabSections = new Set(
    config.tabs.flatMap(t =>
      t.source.kind === 'codeowners' ? [t.source.section] : []
    )
  );
  const out: BoardMR[] = [];
  for (const pr of prs) {
    if (pr.state !== 'opened') continue;
    if (!pr.author) continue;
    const isMember = members.has(pr.author.username);
    // Only tags matching a currently-configured tab count -- a tab removed
    // from config must not keep stale-tagged rows on the board.
    const tagged = (tags?.get(pr.id) ?? []).filter(s => tabSections.has(s));
    // A tagged row is on the board regardless of author; per-tab display
    // filtering by section is Task 11's job, not buildBoard's.
    if (!isMember && tagged.length === 0) continue;
    // Someone else's draft isn't yours to act on, so it stays off the board;
    // your own show up with a DRAFT chip and a "mark ready" action. With
    // defaultMember "all" there's no single "you", so no drafts are shown.
    if (pr.draft && pr.author.username !== config.defaultMember) continue;
    // Drop MRs gone quiet: no activity (last update) within the stale window.
    if (pr.updatedAt && Date.parse(pr.updatedAt) < staleCutoff) continue;
    // Team filter: keep only MRs whose Linear ticket prefix is configured.
    // No prefixes configured → keep everything. Untagged MRs are dropped.
    // Ticket-prefix filtering is a roster-board concept; a row kept by its
    // codeowner tag rides the board regardless of whose ticket it carries.
    if (prefixes.size > 0 && tagged.length === 0) {
      const ticket = extractTicketId(pr.sourceBranch, pr.title);
      const prefix = ticket ? ticket.slice(0, ticket.indexOf('-')) : null;
      if (!prefix || !prefixes.has(prefix)) continue;
    }
    const path = pr.webUrl
      ? projectPathFromWebUrl(pr.webUrl, config.gitlabHost)
      : null;
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
      codeownerSections: tagged,
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
  return glanceStripDraftPrefix(title).replace(LEGACY_WIP_PREFIX, '');
}

/**
 * What the board declares it needs from rt on the full-board fetch: every
 * configured member, including hidden (checked-out) ones -- hidden is a
 * display state, not a demand state, so the daemon still sizes its sync to
 * cover them. Callers must attach this only where the read means "everything
 * this client needs" (fetchTeamMRs); a single-member read declaring demand
 * would tell the daemon the roster is just that one member.
 */
// `port` identifies which board process is declaring -- config.port retired
// (the actual listen port is env/default-derived, not config), so callers
// pass the resolved port explicitly.
export function boardDemand(config: BoardConfig, port: number): DemandDecl {
  const sections = [
    ...new Set(
      config.tabs.flatMap(t =>
        t.source.kind === 'codeowners' ? [t.source.section] : []
      )
    ),
  ];
  return {
    client: `board:${port}`,
    authors: config.members.map(m => m.username),
    ...(sections.length > 0 ? { codeownerSections: sections } : {}),
    declaredAt: Date.now(),
  };
}

/** Which Slack channel an MR's review-request lives in: roster MRs use the
    board channel; a tag-only row uses its codeowners tab's channel (first
    match in tab order), falling back to the board channel when none of its
    tags carry a slackChannel. */
export function channelForMR(
  config: BoardConfig,
  mr: Pick<BoardMR, 'author' | 'codeownerSections'>
): string {
  const isMember = config.members.some(m => m.username === mr.author.username);
  if (!isMember) {
    for (const tab of config.tabs) {
      if (
        tab.source.kind === 'codeowners' &&
        tab.slackChannel &&
        mr.codeownerSections.includes(tab.source.section)
      ) {
        return tab.slackChannel;
      }
    }
  }
  return config.slack.channel;
}

/** Every Slack channel this board's config can route a review-request to:
    the default channel plus every tab-level override, deduped. Used to
    validate a client-supplied channel override. */
export function configuredSlackChannels(
  config: Pick<BoardConfig, 'slack' | 'tabs'>
): string[] {
  const channels = new Set<string>([config.slack.channel]);
  for (const tab of config.tabs) {
    if (tab.slackChannel) channels.add(tab.slackChannel);
  }
  return [...channels];
}

/** One project's sync facts, the shape aggregateSyncScope folds across projects. */
export interface SyncScopeRead {
  syncedAt: number;
  scope?: ProjectMRsScope;
}

/**
 * Fold the per-project daemon reads that built one snapshot into one
 * board-wide picture. `dataSyncedAt` is the oldest syncedAt (the board is
 * only as fresh as its stalest project); `scopeUncovered` unions every
 * project's uncovered authors; `scopeWindowDays` is the narrowest window
 * (the tightest constraint any project reported); `scopeUncoveredSections`
 * unions every project's uncovered codeowner sections; `scopeKnownSections`
 * unions every project's CODEOWNERS headers and is null when none reported
 * them. A project that errored before yielding a read is simply absent from
 * `reads`.
 */
export function aggregateSyncScope(reads: SyncScopeRead[]): {
  dataSyncedAt: number | null;
  scopeUncovered: string[];
  scopeWindowDays: number | null;
  scopeUncoveredSections: string[];
  scopeKnownSections: string[] | null;
} {
  let dataSyncedAt: number | null = null;
  let scopeWindowDays: number | null = null;
  const uncovered = new Set<string>();
  const uncoveredSections = new Set<string>();
  let known: Set<string> | null = null;
  for (const read of reads) {
    dataSyncedAt =
      dataSyncedAt === null
        ? read.syncedAt
        : Math.min(dataSyncedAt, read.syncedAt);
    if (read.scope) {
      scopeWindowDays =
        scopeWindowDays === null
          ? read.scope.windowDays
          : Math.min(scopeWindowDays, read.scope.windowDays);
      for (const author of read.scope.uncovered) uncovered.add(author);
      for (const section of read.scope.uncoveredSections ?? [])
        uncoveredSections.add(section);
      if (read.scope.knownSections) {
        known ??= new Set<string>();
        for (const section of read.scope.knownSections) known.add(section);
      }
    }
  }
  return {
    dataSyncedAt,
    scopeUncovered: [...uncovered],
    scopeWindowDays,
    scopeUncoveredSections: [...uncoveredSections],
    scopeKnownSections: known ? [...known].sort() : null,
  };
}

/**
 * Whether any assigned reviewer has formally requested changes — the GitLab
 * "changes requested" review state, distinct from someone merely leaving
 * comments. Comes from `reviews.reviewers[].reviewState`.
 */
export function hasChangesRequested(mr: BoardMR): boolean {
  return (
    mr.reviews.reviewers?.some(
      r => getReviewDisplayState(r.reviewState ?? null) === 'changes_requested'
    ) ?? false
  );
}

/** Which snapshot MRs the served board keeps: a visible (non-hidden) roster
    member's MR, or any MR carrying at least one codeowner tag. The tag arm is
    what lets a codeowner-tagged stranger -- never a roster member -- reach a
    codeowners tab; without it every tagged row from outside the roster would
    be dropped here before a tab ever saw it. */
export function visibleMrsFor(
  mrs: BoardMR[],
  visibleMembers: Member[]
): BoardMR[] {
  const visibleNames = new Set(visibleMembers.map(m => m.username));
  return mrs.filter(
    mr =>
      visibleNames.has(mr.author.username) || mr.codeownerSections.length > 0
  );
}

export interface RosterMember {
  username: string;
  name: string | null;
  count: number;
}

/** Members in config order, each with a resolved name and open-MR count. */
export function buildRoster(
  members: Member[],
  mrs: BoardMR[],
  names: Map<string, string | null>
): RosterMember[] {
  return members.map(member => ({
    username: member.username,
    name: names.get(member.username) ?? member.name ?? null,
    count: mrs.filter(mr => mr.author.username === member.username).length,
  }));
}

/** A roster derived from the MRs on screen rather than from config: a
    codeowners tab lists other teams' MRs, so the configured roster has nothing
    to drive there, but filtering by author is still useful. Busiest author
    first, then alphabetical, so the list reads as "who is asking for review".
    Bots and hidden members are not special-cased: whoever authored a row in
    view belongs in the roster for that view. */
export function inferRoster(mrs: BoardMR[]): RosterMember[] {
  const byUsername = new Map<string, RosterMember>();
  for (const mr of mrs) {
    const { username, name } = mr.author;
    const existing = byUsername.get(username);
    if (existing) existing.count += 1;
    else byUsername.set(username, { username, name: name ?? null, count: 1 });
  }
  return [...byUsername.values()].sort(
    (a, b) => b.count - a.count || a.username.localeCompare(b.username)
  );
}

/**
 * Tags each gate row with `executor` when the reconciler sweep's
 * `openGateIds` names its id -- the pane state currently blocking on that
 * gate. A gate no executor claims is returned untouched (no `executor` key
 * at all, not `undefined` written in), matching how the rest of the payload
 * only carries fields it has real data for.
 */
export function joinGateExecutors<G extends { gateId: string }>(
  gates: G[],
  executors: ExecutorView[]
): Array<G & { executor?: ExecutorState }> {
  const stateByGateId = new Map<string, ExecutorState>();
  for (const executor of executors) {
    for (const gateId of executor.openGateIds) {
      stateByGateId.set(gateId, executor.state);
    }
  }
  return gates.map((gate): G & { executor?: ExecutorState } => {
    const state = stateByGateId.get(gate.gateId);
    return state ? { ...gate, executor: state } : gate;
  });
}

/**
 * Splits the reconciler sweep's dead/hidden executors: a `gone` or `hidden`
 * one whose subject matches an MR row on this board attaches to that row as
 * `orphan`; a `gone` one matching no row falls through to the top-level
 * `orphans` leftover. A `hidden` executor matching no row has nothing to
 * anchor to and is dropped -- it isn't gone yet, just off this board's
 * radar, so surfacing it board-wide would be noise.
 */
export function joinExecutorOrphans<T extends { webUrl?: string | null }>(
  mrs: T[],
  executors: ExecutorView[]
): { mrs: Array<T & { orphan?: ExecutorView }>; orphans: ExecutorView[] } {
  const bySubject = new Map<string, ExecutorView>();
  for (const executor of executors) {
    if (
      (executor.state === 'gone' || executor.state === 'hidden') &&
      executor.subject
    ) {
      bySubject.set(executor.subject, executor);
    }
  }
  const matchedSubjects = new Set<string>();
  const joinedMrs = mrs.map((mr): T & { orphan?: ExecutorView } => {
    if (!mr.webUrl) return mr;
    const subject = `mr:${mr.webUrl}`;
    const match = bySubject.get(subject);
    if (!match) return mr;
    matchedSubjects.add(subject);
    return { ...mr, orphan: match };
  });
  const orphans = executors.filter(
    e => e.state === 'gone' && (!e.subject || !matchedSubjects.has(e.subject))
  );
  return { mrs: joinedMrs, orphans };
}

export function reviewSkillForTab(
  config: BoardConfig,
  tabId: string | undefined,
  mrUrl: string,
  fallback: (kind: 'review', mrUrl: string) => string
): string {
  const tab = tabId ? config.tabs.find(t => t.id === tabId) : undefined;
  if (tab?.reviewSkill) {
    console.log(`review skill: ${tab.reviewSkill} (tab ${tab.id})`);
    return tab.reviewSkill;
  }
  return fallback('review', mrUrl);
}
