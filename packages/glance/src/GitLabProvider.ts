import { Gitlab, GitbeakerRequestError, GitbeakerRetryError } from '@gitbeaker/rest';
import type { CreateMergeRequestOptions, EditMergeRequestOptions } from '@gitbeaker/rest';
import type { GitProvider, FetchPullRequestsOptions, MRState } from './GitProvider.ts';
import { parseUpdatedAfter, requireProjectPath } from './GitProvider.ts';
import type {
  BranchProtectionRule,
  CreatePullRequestInput,
  DiffStats,
  InvalidationBatch,
  JobDetail,
  MergeabilityCheck,
  MergePullRequestInput,
  MRDetail,
  Pipeline,
  PipelineJob,
  ProviderCapabilities,
  PullRequest,
  Reviewer,
  UpdatePullRequestInput,
  UserRef,
  WatchEventsOptions,
} from './types.ts';
import { isTransitionalMergeStatus } from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';
import { MRDetailFetcher } from './MRDetailFetcher.ts';
import { ActionCableClient } from './ActionCableClient.ts';
import { createRealtimeWatcher, type RealtimeWatcherOptions } from './RealtimeWatcher.ts';
import { startEventsWatcher } from './EventsWatcher.ts';
import type { FetchEvents, GitLabEvent } from './EventsPoller.ts';
import { safeEmit, instrumentGitbeaker, type OnRequestHook, type RequestInfo } from './instrumentation.ts';

// ---------------------------------------------------------------------------
// Repository ID helpers
// ---------------------------------------------------------------------------

/**
 * Strips the provider prefix from a scoped repositoryId and returns the
 * numeric GitLab project ID needed for REST API calls.
 * e.g. "gitlab:42" → 42
 */
export function parseGitLabRepoId(repositoryId: string): number {
  const parts = repositoryId.split(':');
  return parseInt(parts.at(-1) ?? '0', 10);
}

// ---------------------------------------------------------------------------
// GraphQL query (same fragment as GraphQLQueries.swift mrDashboardFieldsFragment)
// ---------------------------------------------------------------------------

export const MR_DASHBOARD_FRAGMENT = `
  fragment MRDashboardFields on MergeRequest {
    id iid projectId title description state draft
    sourceBranch targetBranch webUrl
    targetProject { repository { rootRef } }
    diffHeadSha
    updatedAt createdAt
    conflicts
    detailedMergeStatus
    approved
    approvalsRequired
    diffStatsSummary { additions deletions fileCount }
    author { id username name avatarUrl }
    assignees(first: 20) { nodes { id username name avatarUrl } }
    reviewers(first: 20) { nodes { id username name avatarUrl mergeRequestInteraction { reviewState } } }
    approvedBy(first: 20) { nodes { id username name avatarUrl } }
    approvalsLeft
    resolvableDiscussionsCount
    resolvedDiscussionsCount
    autoMergeEnabled
    autoMergeStrategy
    mergeUser { id username name avatarUrl }
    mergeAfter
    rebaseInProgress
    mergeOngoing
    inProgressMergeCommitSha
    mergeError
    shouldBeRebased
    squash
    squashOnMerge
    mergeTrainIndex
    mergeabilityChecks { identifier status }
    blockingMergeRequests { totalCount }
    headPipeline {
      id iid status
      createdAt
      path
      stages(first: 20) { nodes {
        name
        jobs(first: 50) { nodes {
          id name status
          duration
          allowFailure
          webPath
          stage { name }
        }}
      }}
    }
  }
`;

/**
 * List-weight twin of MR_DASHBOARD_FRAGMENT: identical fields except
 * `headPipeline` drops the `stages/jobs` trees down to `{ id status }`.
 * ~10x cheaper per page on large projects and immune to GitLab's resolver
 * timeouts on CI job trees (section 5.7 of the typed-stores design). Per-MR
 * job detail stays available via fetchSingleMR, which always uses the full
 * MRDashboardFields fragment.
 */
export const MR_LIST_FRAGMENT = `
  fragment MRListFields on MergeRequest {
    id iid projectId title description state draft
    sourceBranch targetBranch webUrl
    targetProject { repository { rootRef } }
    diffHeadSha
    updatedAt createdAt
    conflicts
    detailedMergeStatus
    approved
    approvalsRequired
    diffStatsSummary { additions deletions fileCount }
    author { id username name avatarUrl }
    assignees(first: 20) { nodes { id username name avatarUrl } }
    reviewers(first: 20) { nodes { id username name avatarUrl mergeRequestInteraction { reviewState } } }
    approvedBy(first: 20) { nodes { id username name avatarUrl } }
    approvalsLeft
    resolvableDiscussionsCount
    resolvedDiscussionsCount
    autoMergeEnabled
    autoMergeStrategy
    mergeUser { id username name avatarUrl }
    mergeAfter
    rebaseInProgress
    mergeOngoing
    inProgressMergeCommitSha
    mergeError
    shouldBeRebased
    squash
    squashOnMerge
    mergeTrainIndex
    mergeabilityChecks { identifier status }
    blockingMergeRequests { totalCount }
    headPipeline {
      id status
    }
  }
`;

const AUTHORED_QUERY = `
  query GlanceDashboardAuthored($state: MergeRequestState!) {
    currentUser {
      authoredMergeRequests(state: $state, first: 100) {
        nodes { ...MRDashboardFields }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

const REVIEWING_QUERY = `
  query GlanceDashboardReviewing($state: MergeRequestState!) {
    currentUser {
      reviewRequestedMergeRequests(state: $state, first: 100) {
        nodes { ...MRDashboardFields }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

const ASSIGNED_QUERY = `
  query GlanceDashboardAssigned($state: MergeRequestState!) {
    currentUser {
      assignedMergeRequests(state: $state, first: 100) {
        nodes { ...MRDashboardFields }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

// ---------------------------------------------------------------------------
// Raw GQL response shapes (only the fields we use)
// ---------------------------------------------------------------------------

interface GQLUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** Reviewer node — GQLUser + the per-reviewer interaction state. */
interface GQLReviewerNode extends GQLUser {
  mergeRequestInteraction: { reviewState: string | null } | null;
}

interface GQLJob {
  id: string;
  name: string;
  status: string;
  duration: number | null;
  allowFailure: boolean;
  webPath: string | null;
  stage: { name: string };
  downstreamPipeline?: GQLPipeline | null;
}

interface GQLStage {
  name: string;
  jobs: { nodes: GQLJob[] };
}

interface GQLPipeline {
  id: string;
  status: string;
  createdAt: string | null;
  path: string | null;
  /** Absent on list-weight fragment responses (no stages/jobs trees). */
  stages?: { nodes: GQLStage[] };
}

interface GQLDiffStats {
  additions: number;
  deletions: number;
  fileCount: number;
}

interface GQLMR {
  id: string;
  iid: string;
  projectId: number;
  title: string;
  description: string | null;
  state: string;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  targetProject?: { repository?: { rootRef: string | null } | null } | null;
  diffHeadSha: string | null;
  updatedAt: string;
  createdAt: string;
  conflicts: boolean;
  detailedMergeStatus: string | null;
  approved: boolean;
  diffStatsSummary: GQLDiffStats | null;
  author: GQLUser;
  assignees: { nodes: GQLUser[] };
  reviewers: { nodes: GQLReviewerNode[] };
  approvedBy: { nodes: GQLUser[] };
  approvalsLeft: number | null;
  resolvableDiscussionsCount: number | null;
  resolvedDiscussionsCount: number | null;
  autoMergeEnabled: boolean;
  autoMergeStrategy: string | null;
  mergeUser: GQLUser | null;
  mergeAfter: string | null;
  rebaseInProgress: boolean;
  mergeOngoing: boolean;
  inProgressMergeCommitSha: string | null;
  mergeError: string | null;
  shouldBeRebased: boolean;
  squash: boolean;
  squashOnMerge: boolean;
  mergeTrainIndex: number | null;
  mergeabilityChecks: Array<{ identifier: string; status: string }>;
  blockingMergeRequests: { totalCount: number } | null;
  approvalsRequired: number | null;
  headPipeline: GQLPipeline | null;
}

interface AuthoredResponse {
  currentUser: { authoredMergeRequests: { nodes: GQLMR[] } };
}
interface ReviewingResponse {
  currentUser: { reviewRequestedMergeRequests: { nodes: GQLMR[] } };
}
interface AssignedResponse {
  currentUser: { assignedMergeRequests: { nodes: GQLMR[] } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract numeric ID from a GQL global ID like "gid://gitlab/MergeRequest/12345". */
function numericId(gid: string): number {
  const parts = gid.split('/');
  return parseInt(parts[parts.length - 1] ?? '0', 10);
}

/** Build a scoped domain ID from a GitLab numeric integer. */
function domainId(type: string, id: number | string): string {
  return `gitlab:${type}:${id}`;
}

function toUserRef(u: GQLUser, baseURL?: string, token?: string): UserRef {
  let avatarUrl = u.avatarUrl;
  if (avatarUrl) {
    // GitLab GraphQL returns relative avatar paths — make them absolute
    if (baseURL && avatarUrl.startsWith('/')) {
      avatarUrl = `${baseURL}${avatarUrl}`;
    }
    if (token) {
      const sep = avatarUrl.includes('?') ? '&' : '?';
      avatarUrl = `${avatarUrl}${sep}private_token=${token}`;
    }
  }
  return {
    id: `gitlab:user:${numericId(u.id)}`,
    username: u.username,
    name: u.name,
    avatarUrl,
  };
}

function toReviewer(u: GQLReviewerNode, baseURL?: string, token?: string): Reviewer {
  return {
    ...toUserRef(u, baseURL, token),
    reviewState: (u.mergeRequestInteraction?.reviewState ?? null) as Reviewer['reviewState'],
  };
}

function toPipeline(p: GQLPipeline, baseURL: string): Pipeline {
  const allJobs: PipelineJob[] = (p.stages?.nodes ?? []).flatMap((stage) =>
    stage.jobs.nodes.map((job) => ({
      id: `gitlab:job:${numericId(job.id)}`,
      name: job.name,
      stage: job.stage.name,
      status: job.status.toLowerCase(),
      allowFailure: job.allowFailure,
      duration: job.duration,
      webUrl: job.webPath ? `${baseURL}${job.webPath}` : null,
      downstreamPipeline: job.downstreamPipeline ? toPipeline(job.downstreamPipeline, baseURL) : null,
    })),
  );

  return {
    id: domainId('pipeline', numericId(p.id)),
    status: normalizePipelineStatus(p),
    createdAt: p.createdAt,
    webUrl: p.path ? `${baseURL}${p.path}` : null,
    jobs: allJobs,
  };
}

/**
 * Mirrors PipelineStatus.successWithWarnings logic from Swift:
 * if any non-allow-failure job failed → "failed"
 * if any allow-failure job failed but overall status is success → "success_with_warnings"
 */
function normalizePipelineStatus(p: GQLPipeline): string {
  const allJobs = (p.stages?.nodes ?? []).flatMap((s) => s.jobs.nodes);
  const status = p.status.toLowerCase();
  const hasAllowFailFailed = allJobs.some((j) => j.allowFailure && j.status.toLowerCase() === 'failed');
  if (status === 'success' && hasAllowFailFailed) {
    return 'success_with_warnings';
  }
  return status;
}

/**
 * GitLab's own draft-title patterns: `Draft:`, `[Draft]`, `(Draft)`, any case.
 * Draft state is a function of the title, not a field you can set.
 */
const DRAFT_TITLE_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:)\s*/i;

/** The title without its draft marker. Titles that carry none are unchanged. */
export function stripDraftPrefix(title: string): string {
  return title.replace(DRAFT_TITLE_PREFIX, '');
}

/**
 * The wire title for an MR that should be in `draft` state.
 *
 * The prefix is GitLab's only mechanism for this: the REST API has no `draft`
 * parameter on create or edit (MAT-15). It is applied here, at the wire
 * boundary, and stripped again in `toMR`, so a caller's stored title never
 * grows a "Draft:" it did not write.
 *
 * Exported for consumers composing a title to pass through
 * `updatePullRequest` alongside `draft` (MAT-157); without it they would
 * have to copy the marker set and track it by hand.
 */
export function draftTitle(title: string, draft: boolean): string {
  const base = stripDraftPrefix(title);
  return draft ? `Draft: ${base}` : base;
}

function toMR(
  gql: GQLMR,
  role: string,
  baseURL: string,
  divergedCommitsCount: number | null = null,
  token?: string,
): PullRequest {
  const resolvable = gql.resolvableDiscussionsCount ?? 0;
  const resolved = gql.resolvedDiscussionsCount ?? 0;
  const unresolvedThreadCount = Math.max(0, resolvable - resolved);

  const diffStats: DiffStats | null = gql.diffStatsSummary
    ? {
        additions: gql.diffStatsSummary.additions,
        deletions: gql.diffStatsSummary.deletions,
        filesChanged: gql.diffStatsSummary.fileCount,
      }
    : null;

  // GitLab GraphQL returns detailedMergeStatus as an uppercase enum (e.g. MERGEABLE).
  // Downstream code compares against lowercase values, so normalize at the boundary.
  const detailedMergeStatus = gql.detailedMergeStatus?.toLowerCase() ?? null;

  const rootRef = gql.targetProject?.repository?.rootRef ?? null;

  return {
    id: `gitlab:mr:${numericId(gql.id)}`,
    iid: parseInt(gql.iid, 10),
    repositoryId: `gitlab:${gql.projectId}`,
    // The "Draft:" prefix is GitLab's transport for `draft`, not part of the
    // title the author wrote. Consumers persist and render this string, and
    // `draft` below already carries the state.
    title: gql.draft ? stripDraftPrefix(gql.title) : gql.title,
    description: gql.description ?? null,
    state: gql.state,
    draft: gql.draft,
    // GitLab's `conflicts` boolean is async — it can briefly return false
    // while the conflict check re-runs (e.g. after a pipeline update).
    // `detailedMergeStatus === 'conflict'` only helps when CONFLICT is the
    // sole blocker; with multiple blockers GitLab surfaces a different status.
    // The dedicated CONFLICT mergeability check is stable regardless of how
    // many other blockers are present.
    conflicts:
      gql.conflicts ||
      detailedMergeStatus === 'conflict' ||
      (gql.mergeabilityChecks ?? []).some((c) => c.identifier === 'CONFLICT' && c.status === 'FAILED'),

    webUrl: gql.webUrl,
    sourceBranch: gql.sourceBranch,
    targetBranch: gql.targetBranch,
    isStacked: !!rootRef && gql.targetBranch !== rootRef,
    createdAt: gql.createdAt,
    updatedAt: gql.updatedAt,
    sha: gql.diffHeadSha,
    author: toUserRef(gql.author, baseURL, token),
    assignees: gql.assignees.nodes.map((u) => toUserRef(u, baseURL, token)),
    reviewers: gql.reviewers.nodes.map((u) => toReviewer(u, baseURL, token)),
    roles: [role],
    pipeline: gql.headPipeline ? toPipeline(gql.headPipeline, baseURL) : null,
    unresolvedThreadCount,
    approvalsLeft: gql.approvalsLeft ?? 0,
    approved: gql.approved ?? false,
    approvedBy: gql.approvedBy.nodes.map((u) => toUserRef(u, baseURL, token)),
    diffStats,
    detailedMergeStatus,
    autoMergeEnabled: gql.autoMergeEnabled ?? false,
    autoMergeStrategy: gql.autoMergeStrategy ?? null,
    mergeUser: gql.mergeUser ? toUserRef(gql.mergeUser, baseURL, token) : null,
    mergeAfter: gql.mergeAfter ?? null,
    divergedCommitsCount,
    rebaseInProgress: gql.rebaseInProgress ?? false,
    mergeOngoing: gql.mergeOngoing ?? false,
    inProgressMergeCommitSha: gql.inProgressMergeCommitSha ?? null,
    mergeError: gql.mergeError ?? null,
    shouldBeRebased: gql.shouldBeRebased ?? false,
    mergeabilityChecks: (gql.mergeabilityChecks ?? []).map(
      (c): MergeabilityCheck => ({ identifier: c.identifier, status: c.status }),
    ),
    blockingMergeRequestsCount: gql.blockingMergeRequests?.totalCount ?? 0,
    approvalsRequired: gql.approvalsRequired ?? 0,
    squash: gql.squash ?? false,
    squashOnMerge: gql.squashOnMerge ?? false,
    mergeTrainIndex: gql.mergeTrainIndex ?? null,
  };
}

// ---------------------------------------------------------------------------
// Single-MR detail query (used by SubscriptionManager on userMergeRequestUpdated)
// ---------------------------------------------------------------------------

const MR_DETAIL_QUERY = `
  query GlanceMRDetail($projectPath: ID!, $iid: String!) {
    project(fullPath: $projectPath) {
      mergeRequest(iid: $iid) {
        ...MRDashboardFields
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

interface MRDetailResponse {
  project: { mergeRequest: GQLMR | null } | null;
}

const MR_BATCH_QUERY = `
  query GlanceMRBatch($projectPath: ID!, $iids: [String!], $state: MergeRequestState) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, state: $state, first: 100) {
        nodes {
          ...MRDashboardFields
        }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

interface MRBatchResponse {
  project: { mergeRequests: { nodes: GQLMR[] } } | null;
}

/** Variant without the state filter — returns MRs in any state when queried by IID. */
const MR_BATCH_QUERY_NO_STATE = `
  query GlanceMRBatchAll($projectPath: ID!, $iids: [String!]) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, first: 100) {
        nodes {
          ...MRDashboardFields
        }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

/** All MRs in a project by a single author, with full dashboard fields. */
const MR_BY_AUTHOR_QUERY = `
  query GlanceMRByAuthor($projectPath: ID!, $author: String!, $state: MergeRequestState) {
    project(fullPath: $projectPath) {
      mergeRequests(authorUsername: $author, state: $state, first: 100) {
        nodes {
          ...MRDashboardFields
        }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

/** All MRs in a project, cursor-paginated (member-blind team/project view). */
const MR_PROJECT_QUERY = `
  query GlanceMRProject($projectPath: ID!, $state: MergeRequestState, $ua: Time, $after: String) {
    project(fullPath: $projectPath) {
      mergeRequests(state: $state, updatedAfter: $ua, first: 50, after: $after, sort: UPDATED_DESC) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ...MRDashboardFields
        }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

/** Variant without the state filter, for multi-state requests. */
const MR_PROJECT_QUERY_NO_STATE = `
  query GlanceMRProjectAll($projectPath: ID!, $ua: Time, $after: String) {
    project(fullPath: $projectPath) {
      mergeRequests(updatedAfter: $ua, first: 50, after: $after, sort: UPDATED_DESC) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ...MRDashboardFields
        }
      }
    }
  }
  ${MR_DASHBOARD_FRAGMENT}
`;

/** List-weight twin of MR_PROJECT_QUERY: same shape, ...MRListFields instead. */
const MR_PROJECT_LIST_QUERY = `
  query GlanceMRProjectList($projectPath: ID!, $state: MergeRequestState, $ua: Time, $after: String) {
    project(fullPath: $projectPath) {
      mergeRequests(state: $state, updatedAfter: $ua, first: 50, after: $after, sort: UPDATED_DESC) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ...MRListFields
        }
      }
    }
  }
  ${MR_LIST_FRAGMENT}
`;

/** List-weight twin of MR_PROJECT_QUERY_NO_STATE. */
const MR_PROJECT_LIST_QUERY_NO_STATE = `
  query GlanceMRProjectListAll($projectPath: ID!, $ua: Time, $after: String) {
    project(fullPath: $projectPath) {
      mergeRequests(updatedAfter: $ua, first: 50, after: $after, sort: UPDATED_DESC) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ...MRListFields
        }
      }
    }
  }
  ${MR_LIST_FRAGMENT}
`;

interface MRProjectResponse {
  project: {
    mergeRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GQLMR[];
    };
  } | null;
}

// ---------------------------------------------------------------------------
// GitLabProvider
// ---------------------------------------------------------------------------

export class GitLabProvider implements GitProvider {
  readonly providerName = 'gitlab' as const;
  readonly baseURL: string;
  private readonly token: string;
  private readonly log: ForgeLogger;
  private readonly mrDetailFetcher: MRDetailFetcher;
  /** Typed REST client. All non-GraphQL API calls go through this. */
  private readonly gb: InstanceType<typeof Gitlab>;
  private readonly onRequest?: OnRequestHook;

  // ── Shared ActionCable connection ────────────────────────────────────
  // All watchMR calls multiplex over one WebSocket instead of N.
  private sharedCable: ActionCableClient | null = null;
  private cableWatcherCount = 0;
  // Maps subscription identifier → per-watcher onEvent callback
  private readonly cableEventHandlers = new Map<string, () => void>();
  // Per-watcher onConnected callbacks — called on reconnect so each can resubscribe
  private readonly cableConnectHandlers = new Set<() => void>();
  // Per-watcher onDisconnected callbacks
  private readonly cableDisconnectHandlers = new Set<() => void>();

  constructor(baseURL: string, token: string, options: { logger?: ForgeLogger; onRequest?: OnRequestHook } = {}) {
    // Strip trailing slash for consistent URL building
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;
    this.onRequest = options.onRequest;
    const gb = new Gitlab({ host: this.baseURL, token });
    // Zero-cost when unset: no Proxy layer unless a hook is attached.
    this.gb = options.onRequest ? instrumentGitbeaker(gb, (info) => safeEmit(this.onRequest, info)) : gb;
    this.mrDetailFetcher = new MRDetailFetcher(this.baseURL, token, {
      logger: this.log,
      onRequest: (info) => safeEmit(this.onRequest, info),
    });
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  readonly capabilities: ProviderCapabilities = {
    canMerge: true,
    canApprove: true,
    canUnapprove: true,
    canRebase: true,
    canAutoMerge: true,
    canResolveDiscussions: true,
    canRetryPipeline: true,
    canRequestReReview: true,
    canWatchEvents: true,
  };

  // MARK: - GitProvider

  async validateToken(): Promise<UserRef> {
    let user: { id: number; username: string; name: string; avatar_url: string | null };
    try {
      user = (await this.gb.Users.showCurrentUser()) as unknown as typeof user;
    } catch (err) {
      throw this.legacyError('Token validation', err);
    }
    return {
      id: `gitlab:user:${user.id}`,
      username: user.username,
      name: user.name,
      avatarUrl: this.normalizeAvatarUrl(user.avatar_url),
    };
  }

  /**
   * GitLab avatar URLs on private instances need the caller's token to
   * render, and self-hosted instances can return instance-relative paths.
   * Absolute-izes and appends `private_token` so the URL works in an <img>
   * exactly as `validateToken` has always returned it.
   */
  private normalizeAvatarUrl(avatarUrl: string | null): string | null {
    if (!avatarUrl) return null;
    const absolute = avatarUrl.startsWith('/') ? `${this.baseURL}${avatarUrl}` : avatarUrl;
    const sep = absolute.includes('?') ? '&' : '?';
    return `${absolute}${sep}private_token=${this.token}`;
  }

  async fetchUser(username: string): Promise<UserRef | null> {
    type GLUser = { id: number; username: string; name: string; avatar_url: string | null };
    let matches: GLUser[];
    try {
      // GET /users?username= is an exact-match filter, the same call
      // resolveUserIds leans on, so the first element is the user or the
      // array is empty.
      matches = (await this.gb.Users.all({ username })) as unknown as GLUser[];
    } catch (err) {
      throw this.legacyError('fetchUser', err);
    }
    const user = matches[0];
    if (!user) return null;
    return {
      id: `gitlab:user:${user.id}`,
      username: user.username,
      name: user.name,
      avatarUrl: this.normalizeAvatarUrl(user.avatar_url),
    };
  }

  /**
   * Fetch a single MR by project path and IID.
   * Used by SubscriptionManager when `userMergeRequestUpdated` fires.
   * Returns null if the project or MR doesn't exist.
   *
   * Roles are computed by matching `currentUserNumericId` against the MR's
   * author, assignees, and reviewers.
   */
  async fetchSingleMR(
    projectPath: string,
    mrIid: number,
    currentUserNumericId: number | null,
  ): Promise<PullRequest | null> {
    // Run GraphQL detail query and REST diverged_commits_count fetch in parallel.
    let resp: MRDetailResponse;
    let divergedCommitsCount: number | null = null;
    try {
      [resp] = await Promise.all([
        this.runQuery<MRDetailResponse>('fetchSingleMR', MR_DETAIL_QUERY, {
          projectPath,
          iid: String(mrIid),
        }),
        this.gb.MergeRequests.show(projectPath, mrIid, { includeDivergedCommitsCount: true } as never)
          .then((data) => {
            divergedCommitsCount = (data as unknown as { diverged_commits_count?: number }).diverged_commits_count ?? null;
          })
          .catch(() => {
            // Non-fatal: leave divergedCommitsCount null.
          }),
      ] as unknown as [MRDetailResponse, void]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn('fetchSingleMR failed', { projectPath, mrIid, message });
      return null;
    }

    const gql = resp.project?.mergeRequest;
    if (!gql) return null;

    // Compute roles from the fresh response.
    const roles: string[] = [];
    if (currentUserNumericId !== null) {
      const userGqlId = `gid://gitlab/User/${currentUserNumericId}`;
      if (gql.author.id === userGqlId) roles.push('author');
      if (gql.assignees.nodes.some((u) => u.id === userGqlId)) roles.push('assignee');
      if (gql.reviewers.nodes.some((u) => u.id === userGqlId)) roles.push('reviewer');
    }

    // Use "author" as the primary role for toMR, then overwrite with full computed roles.
    const pr = toMR(gql, roles[0] ?? 'author', this.baseURL, divergedCommitsCount, this.token);
    pr.roles = roles.length > 0 ? roles : pr.roles;
    return pr;
  }

  /**
   * See `GitProvider.fetchPullRequests` for the cross-provider contract.
   *
   * GitLab specifics: `updatedAfter` and `listWeight` are honored by the
   * `projectPath`-alone mode only, and every mode returns full dashboard
   * fields, so there is no per-MR enrichment pass and no page cap to report
   * through `onWarning`.
   */
  async fetchPullRequests(options?: FetchPullRequestsOptions): Promise<PullRequest[]> {
    const stateInput = options?.state;
    const states: MRState[] = stateInput ? (Array.isArray(stateInput) ? stateInput : [stateInput]) : ['opened'];

    // Validated in every mode even though only the project mode applies it:
    // a caller passing a bound this provider cannot parse should hear about
    // it, and should hear about it the same way on either provider.
    parseUpdatedAfter(options?.updatedAfter);

    // Determine the single GitLab API state enum to use.
    // GitLab only accepts one state; if multiple are requested, use 'all' + client filter.
    const ALL_STATES: MRState[] = ['opened', 'merged', 'closed'];
    const needsAllStates = states.length > 1 || states.length === ALL_STATES.length;
    const apiState = needsAllStates ? 'all' : (states[0] ?? 'opened');
    const filterSet = needsAllStates ? new Set(states) : null;

    // IID batch path — use batch query for specific MRs.
    // Keyed off the field being present, not non-empty: an empty `iids` list
    // asks for no MRs, not for the role-based involvement set.
    if (options?.iids) {
      const projectPath = requireProjectPath(options.projectPath, 'iids');
      // When fetching all states, omit the state filter entirely so
      // GitLab returns MRs regardless of state (the default is 'opened').
      const useStateFilter = !needsAllStates;
      const query = useStateFilter ? MR_BATCH_QUERY : MR_BATCH_QUERY_NO_STATE;
      const vars: Record<string, unknown> = {
        projectPath,
        iids: options.iids.map(String),
      };
      if (useStateFilter) {
        vars.state = apiState;
      }
      const resp = await this.runQuery<MRBatchResponse>('fetchPullRequests.iids', query, vars);
      const nodes = resp.project?.mergeRequests?.nodes ?? [];
      const results = nodes.map((gql) => toMR(gql, 'author', this.baseURL, null, this.token));
      return filterSet ? results.filter((pr) => filterSet.has(pr.state as MRState)) : results;
    }

    // Author batch path — one query per author, deduped by MR global ID.
    // Fetches full dashboard fields directly, so callers building a team board
    // need no separate REST discovery pass.
    if (options?.authorUsernames) {
      const projectPath = requireProjectPath(options.projectPath, 'authorUsernames');
      const perAuthor = await Promise.all(
        options.authorUsernames.map((author) =>
          this.runQuery<MRBatchResponse>('fetchPullRequests.byAuthor', MR_BY_AUTHOR_QUERY, {
            projectPath,
            author,
            state: apiState,
          }),
        ),
      );
      const byId = new Map<string, PullRequest>();
      for (const resp of perAuthor) {
        for (const gql of resp.project?.mergeRequests?.nodes ?? []) {
          const pr = toMR(gql, 'author', this.baseURL, null, this.token);
          if (filterSet && !filterSet.has(pr.state as MRState)) continue;
          byId.set(pr.id, pr);
        }
      }
      return [...byId.values()];
    }

    // Project path alone — every MR in the project (member-blind), paginated.
    // Pages are fetched sequentially: GitLab's GraphQL resolvers time out under
    // concurrent dashboard-field queries, and order does not matter here.
    if (options?.projectPath) {
      const projectPath = options.projectPath;
      const useStateFilter = !needsAllStates;
      const query = options.listWeight
        ? useStateFilter
          ? MR_PROJECT_LIST_QUERY
          : MR_PROJECT_LIST_QUERY_NO_STATE
        : useStateFilter
          ? MR_PROJECT_QUERY
          : MR_PROJECT_QUERY_NO_STATE;
      const out: PullRequest[] = [];
      let after: string | null = null;
      do {
        const vars: Record<string, unknown> = { projectPath, after, ua: options.updatedAfter ?? null };
        if (useStateFilter) vars.state = apiState;
        const resp: MRProjectResponse = await this.runQuery<MRProjectResponse>('fetchPullRequests.project', query, vars);
        const conn = resp.project?.mergeRequests;
        for (const gql of conn?.nodes ?? []) {
          const pr = toMR(gql, 'author', this.baseURL, null, this.token);
          if (filterSet && !filterSet.has(pr.state as MRState)) continue;
          out.push(pr);
        }
        const next = conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null;
        if (next !== null && next === after) {
          throw new Error(`fetchPullRequests.project: non-advancing cursor '${next}' for ${projectPath}`);
        }
        after = next;
      } while (after);
      return out;
    }

    // Role-based path — 3 queries (authored + reviewing + assigned)
    const stateVar = { state: apiState };
    const [authored, reviewing, assigned] = await Promise.all([
      this.runQuery<AuthoredResponse>('fetchPullRequests.authored', AUTHORED_QUERY, stateVar),
      this.runQuery<ReviewingResponse>('fetchPullRequests.reviewing', REVIEWING_QUERY, stateVar),
      this.runQuery<AssignedResponse>('fetchPullRequests.assigned', ASSIGNED_QUERY, stateVar),
    ]);

    // Merge all three sets, deduplicating by MR global ID.
    // For duplicates, accumulate all roles (a user can be both author and assignee).
    const byId = new Map<string, PullRequest>();

    const addAll = (mrs: GQLMR[], role: string) => {
      for (const gql of mrs) {
        const existing = byId.get(gql.id);
        if (existing) {
          if (!existing.roles.includes(role)) {
            existing.roles.push(role);
          }
        } else {
          byId.set(gql.id, toMR(gql, role, this.baseURL, null, this.token));
        }
      }
    };

    addAll(authored.currentUser.authoredMergeRequests.nodes, 'author');
    addAll(reviewing.currentUser.reviewRequestedMergeRequests.nodes, 'reviewer');
    addAll(assigned.currentUser.assignedMergeRequests.nodes, 'assignee');

    const prs = [...byId.values()];

    // Fetch diverged_commits_count for all MRs in parallel via gitbeaker's
    // MergeRequests.show. We need the project path per MR, which we derive
    // from webUrl.
    await Promise.all(
      prs.map(async (pr) => {
        const match = pr.webUrl?.match(/\/([^/]+\/[^/]+)\/-\/merge_requests/);
        if (!match) return;
        const projectPath = match[1]!;
        try {
          const data = (await this.gb.MergeRequests.show(projectPath, pr.iid, {
            includeDivergedCommitsCount: true,
          } as never)) as unknown as { diverged_commits_count?: number };
          pr.divergedCommitsCount = data.diverged_commits_count ?? null;
        } catch {
          // Non-fatal: leave as null
        }
      }),
    );

    this.log.debug('fetchPullRequests', { count: prs.length });
    return filterSet ? prs.filter((pr) => filterSet.has(pr.state as MRState)) : prs;
  }

  async fetchMRDiscussions(repositoryId: string, mrIid: number): Promise<MRDetail> {
    const projectId = parseGitLabRepoId(repositoryId);
    return this.mrDetailFetcher.fetchDetail(projectId, mrIid);
  }

  /**
   * GitLab has no per-branch protection detail endpoint the way GitHub does,
   * so `requireStatusChecks` and `requiredApprovals` are read from *project*
   * settings rather than the branch itself: `only_allow_merge_if_pipeline_succeeds`
   * and the project's approval configuration (`approvals_before_merge`). Every
   * rule returned here therefore carries the same project-wide value; this is
   * not a per-branch measurement, only the closest verifiable one available.
   * (GitLab's approval rules *can* be scoped to individual protected branches
   * via each rule's `protected_branches`, and multiple rules can apply to one
   * branch at once, but there is no documented, verifiable way to collapse
   * that into a single per-branch number without guessing at GitLab's
   * approval-stacking semantics -- so the project default is used for every
   * rule instead of inventing a mapping.)
   *
   * `requiredApprovals` has a second imprecision, separate from "which
   * branch": `approvals_before_merge` is GitLab's legacy project-wide scalar,
   * not a readout of the named approval-rules feature (Premium/Ultimate).
   * A project relying on named rules for its actual requirement can have
   * `approvals_before_merge` sit at 0, or at some other number the rules
   * don't match, while the rules themselves demand more. This method reports
   * the scalar as-is rather than reading the rules, for the same
   * can't-cleanly-determine reason as the branch-scoping limitation above.
   * A caller that needs the exact requirement on such a project must read
   * the approval rules directly; this field is not that.
   *
   * `allowDeletion: false` is not part of that limitation: it is unconditionally
   * correct, not a placeholder. A protected branch cannot be deleted while
   * protected, and GitLab exposes no per-branch deletion toggle to read.
   *
   * `requiredApprovals` is read from the Merge Request Approvals configuration
   * endpoint (`MergeRequestApprovals.showConfiguration`), which is a Merge
   * Request Approvals feature and may not exist on self-managed GitLab
   * Community Edition. This method does not catch that case: an instance
   * without the feature surfaces an error from this method rather than a
   * fabricated value. That is deliberate, for the same reason the rest of
   * this docstring refuses to guess at values it cannot verify -- it has not
   * been confirmed against a CE instance, and a plausible-looking fallback
   * here (0, or silently omitting the field) is exactly the kind of
   * unverified claim this method exists to avoid shipping.
   */
  async fetchBranchProtectionRules(projectPath: string): Promise<BranchProtectionRule[]> {
    let branches: Array<{
      name: string;
      allow_force_push: boolean;
      push_access_levels: Array<{ access_level: number }>;
      merge_access_levels: Array<{ access_level: number }>;
      code_owner_approval_required?: boolean;
    }>;
    try {
      branches = (await this.gb.ProtectedBranches.all(projectPath, {
        perPage: 100,
        page: 1,
      } as never)) as unknown as typeof branches;
    } catch (err) {
      throw this.legacyError('fetchBranchProtectionRules', err);
    }

    // Fetched once per call, not once per branch below: neither setting
    // varies by branch, so reading them inside the `map` would turn one
    // protected-branches read into 1 + 2N requests for N branches.
    let requireStatusChecks: boolean;
    let requiredApprovals: number;
    try {
      const [project, approvalConfig] = await Promise.all([
        this.gb.Projects.show(projectPath) as unknown as Promise<{
          only_allow_merge_if_pipeline_succeeds: boolean;
        }>,
        this.gb.MergeRequestApprovals.showConfiguration(projectPath) as unknown as Promise<{
          approvals_before_merge: number;
        }>,
      ]);
      requireStatusChecks = project.only_allow_merge_if_pipeline_succeeds;
      requiredApprovals = approvalConfig.approvals_before_merge;
    } catch (err) {
      // Falling back to 0/false here would recreate the exact bug this
      // method exists to fix, just with error handling as its disguise.
      throw this.legacyError('fetchBranchProtectionRules', err);
    }

    return branches.map((b) => ({
      pattern: b.name,
      allowForcePush: b.allow_force_push,
      // Not a placeholder like the two fields below: a real, measured
      // answer. See the docstring above this method.
      allowDeletion: false,
      requiredApprovals,
      requireStatusChecks,
      raw: b as unknown as Record<string, unknown>,
    }));
  }

  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    try {
      await this.gb.Branches.remove(projectPath, branch);
    } catch (err) {
      throw this.legacyError('deleteBranch', err);
    }
  }

  async fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state: MRState | 'all' = 'opened',
  ): Promise<PullRequest | null> {
    let mrs: Array<{ iid: number }>;
    try {
      mrs = (await this.gb.MergeRequests.all({
        projectId: projectPath,
        sourceBranch,
        ...(state === 'all' ? {} : { state }),
        perPage: 1,
        page: 1,
      } as never)) as unknown as Array<{ iid: number }>;
    } catch (err) {
      this.log.warn('fetchPullRequestByBranch failed', {
        projectPath,
        sourceBranch,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!mrs[0]) return null;
    return this.fetchSingleMR(projectPath, mrs[0].iid, null);
  }

  async fetchPullRequestsByBranches(
    projectPath: string,
    branches: string[],
    state: 'opened' | 'merged' | 'closed' | 'all' = 'opened',
  ): Promise<Map<string, PullRequest | null>> {
    // Single GraphQL query using sourceBranches array filter
    const MR_BY_BRANCHES_QUERY = `
      query GlanceMRByBranches($projectPath: ID!, $branches: [String!], $state: MergeRequestState) {
        project(fullPath: $projectPath) {
          mergeRequests(sourceBranches: $branches, state: $state, first: 100) {
            nodes {
              ...MRDashboardFields
            }
          }
        }
      }
      ${MR_DASHBOARD_FRAGMENT}
    `;

    const resp = await this.runQuery<MRBatchResponse>('fetchPullRequestsByBranches', MR_BY_BRANCHES_QUERY, {
      projectPath,
      branches,
      state: state === 'all' ? undefined : state,
    });

    const nodes = resp.project?.mergeRequests?.nodes ?? [];
    const prsByBranch = new Map<string, PullRequest>();
    for (const gql of nodes) {
      const pr = toMR(gql, 'author', this.baseURL, null, this.token);
      prsByBranch.set(pr.sourceBranch, pr);
    }

    // Assemble result map — null for branches with no MR
    const result = new Map<string, PullRequest | null>();
    for (const branch of branches) {
      result.set(branch, prsByBranch.get(branch) ?? null);
    }
    return result;
  }

  /**
   * `input.draft` is applied through the title, the only mechanism GitLab has:
   * neither the create nor the edit endpoint takes a `draft` parameter, so the
   * flag the previous code forwarded was dropped on the floor and every MR
   * landed ready for review (MAT-15). `toMR` strips the prefix back off, so
   * the returned `title` is the one the caller passed.
   *
   * An omitted `draft` leaves the title exactly as given. Treating it as
   * `false` stripped a caller's literal `"Draft: notes"` down to `"notes"` and
   * published an MR GitLab itself would have opened as a draft.
   */
  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const opts: CreateMergeRequestOptions = {};
    if (input.description != null) opts.description = input.description;
    if (input.labels?.length) opts.labels = input.labels.join(',');
    if (input.assignees?.length) opts.assigneeIds = await this.resolveUserIds('createPullRequest', input.assignees);
    if (input.reviewers?.length) opts.reviewerIds = await this.resolveUserIds('createPullRequest', input.reviewers);

    let created: { iid: number };
    try {
      created = (await this.gb.MergeRequests.create(
        input.projectPath,
        input.sourceBranch,
        input.targetBranch,
        input.draft == null ? input.title : draftTitle(input.title, input.draft),
        opts,
      )) as unknown as { iid: number };
    } catch (err) {
      throw this.legacyError('createPullRequest', err);
    }
    return this.fetchSingleMRWithRetry(input.projectPath, created.iid, 'Created MR but failed to fetch it back');
  }

  /**
   * Draft transitions go through the title, as on create.
   *
   * Because draft state and title are the same field on GitLab, this reads the
   * MR first when it is given one without the other: changing a draft MR's
   * title must not quietly publish it, and toggling `draft` must not need the
   * caller to re-send a title. Supplying both skips that read.
   *
   * That read-then-write is not atomic: a title edited between the read and
   * the write is overwritten by the title this method computed from the older
   * one. GitLab offers no compare-and-set on the field, so the window is
   * inherent, not an oversight. Passing `title` alongside `draft` skips the
   * read, but that is for callers already editing the title: a pure draft
   * toggle has no title of its own to pass, and reading one first just moves
   * the same window up a level. For a toggle the window cannot be closed,
   * only kept short, which this method's single immediate read-then-write
   * already does.
   *
   * When `draft` is requested, the MR read back afterwards must agree. A title
   * whose draft marker this SDK does not recognise (a pre-14.0 `WIP:`, say)
   * survives `draftTitle`, and GitLab keeps treating the MR as a draft: the
   * edit succeeds and the flag does not land. That throws rather than
   * reporting a transition that did not happen.
   */
  async updatePullRequest(projectPath: string, mrIid: number, input: UpdatePullRequestInput): Promise<PullRequest> {
    const opts: EditMergeRequestOptions = {};
    if (input.description != null) opts.description = input.description;
    if (input.targetBranch != null) opts.targetBranch = input.targetBranch;
    if (input.labels) opts.labels = input.labels.join(',');
    if (input.assignees) opts.assigneeIds = await this.resolveUserIds('updatePullRequest', input.assignees);
    if (input.reviewers) opts.reviewerIds = await this.resolveUserIds('updatePullRequest', input.reviewers);
    if (input.stateEvent) opts.stateEvent = input.stateEvent;

    if (input.title != null || input.draft != null) {
      const current =
        input.title != null && input.draft != null ? null : await this.showMRTitle(projectPath, mrIid);
      opts.title = draftTitle(input.title ?? current?.title ?? '', input.draft ?? current?.draft ?? false);
    }

    try {
      await this.gb.MergeRequests.edit(projectPath, mrIid, opts);
    } catch (err) {
      throw this.legacyError('updatePullRequest', err);
    }
    const updated = await this.fetchSingleMRWithRetry(
      projectPath,
      mrIid,
      'Updated MR but failed to fetch it back',
    );
    if (input.draft != null && updated.draft !== input.draft) {
      throw new Error(
        `updatePullRequest failed: !${mrIid} is ${updated.draft ? 'still a draft' : 'not a draft'} ` +
          `after requesting draft=${input.draft}. GitLab derives draft state from the title, and the ` +
          `title "${updated.title}" did not produce it.`,
      );
    }
    return updated;
  }

  /** The MR's current title and draft state, for resolving a partial update. */
  private async showMRTitle(projectPath: string, mrIid: number): Promise<{ title: string; draft: boolean }> {
    try {
      const mr = await this.gb.MergeRequests.show(projectPath, mrIid);
      return { title: mr.title, draft: mr.draft };
    } catch (err) {
      throw this.legacyError('updatePullRequest', err);
    }
  }

  async restRequest(method: string, path: string, body?: unknown, op = 'restRequest'): Promise<Response> {
    // GitProvider.restRequest documents the path as provider-relative, the
    // same shape a GitHub caller passes. This used to concatenate
    // baseURL + path verbatim, so every existing GitLab caller learned to
    // pass `/api/v4/...` itself -- the opposite of portable, which is the
    // one thing this method exists to be (MAT-130). Tolerating both shapes
    // here would let that ambiguity survive forever with no way for a
    // caller to learn which form is correct; throwing forces a caller
    // upgrading past the fix to change the one line that needs it, with an
    // error that names exactly what to remove.
    if (path === '/api/v4' || path.startsWith('/api/v4/')) {
      throw new Error(
        `restRequest: path "${path}" already starts with "/api/v4" -- GitLabProvider prefixes that itself now. ` +
          `Pass the provider-relative path instead, e.g. "${path.slice('/api/v4'.length) || '/'}".`,
      );
    }
    const url = `${this.baseURL}/api/v4${path}`;
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': this.token,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const started = performance.now();
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    safeEmit(this.onRequest, {
      op,
      transport: 'rest',
      method,
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });
    return res;
  }

  watchMR(
    projectPath: string,
    mrIid: number,
    currentUserNumericId: number | null,
    onUpdate: (pr: PullRequest) => void,
    options?: RealtimeWatcherOptions,
  ): () => void {
    // Step 1 — initial fetch + subscription is bootstrapped by createRealtimeWatcher.
    // We need the MR's global GID for GitLab's subscription API, so we obtain
    // it lazily inside the subscribe callback (first call is guaranteed after init fetch).
    let mrGid: string | null = null;

    return createRealtimeWatcher({
      // fetch — called on init, every push event, every poll tick, and on reconnect.
      // Uses fetchSingleMRWithRetry so eventual-consistency retries are included.
      fetch: async () => {
        const mr = await this.fetchSingleMRWithRetry(projectPath, mrIid, 'watchMR');
        if (mr && !mrGid) {
          // Cache the GID from the first successful fetch.
          const numId = mr.id.split(':').pop();
          mrGid = `gid://gitlab/MergeRequest/${numId}`;
        }
        return mr;
      },

      // subscribe — wires GitLab's ActionCable GraphQL subscriptions.
      // All watchers share a single WebSocket via this.sharedCable.
      // Three channels per MR cover all merge-widget state changes:
      //   mergeRequestMergeStatusUpdated  → pipeline, rebase, merge status, merge error
      //   mergeRequestApprovalStateUpdated → approvals, mergeabilityChecks
      //   mergeRequestReviewersUpdated     → reviewers list
      subscribe: ({ onConnected, onDisconnected, onEvent }) => {
        const subscriptionIds: string[] = [];

        // Build a subscribe-on-connect callback for this watcher.
        // Called on initial connect and on every reconnect.
        const doSubscribe = () => {
          if (!mrGid || !this.sharedCable) return;
          const queries = [
            `subscription { mergeRequestMergeStatusUpdated(issuableId: "${mrGid}") { iid } }`,
            `subscription { mergeRequestApprovalStateUpdated(issuableId: "${mrGid}") { iid } }`,
            `subscription { mergeRequestReviewersUpdated(issuableId: "${mrGid}") { iid } }`,
          ];
          for (const query of queries) {
            const id = JSON.stringify({ channel: 'GraphqlChannel', query });
            subscriptionIds.push(id);
            this.cableEventHandlers.set(id, onEvent);
            this.sharedCable.subscribe(id);
          }
        };

        // Wrap onConnected to also subscribe this MR's channels
        const wrappedOnConnected = () => {
          doSubscribe();
          onConnected();
        };

        // Register this watcher's callbacks
        this.cableConnectHandlers.add(wrappedOnConnected);
        this.cableDisconnectHandlers.add(onDisconnected);
        this.cableWatcherCount++;

        // Lazy-init: create and connect the shared cable on first watcher
        if (this.cableWatcherCount === 1) {
          this.sharedCable = new ActionCableClient(
            this.baseURL,
            this.token,
            {
              onConnected: () => {
                // Fan out to all registered watchers
                for (const handler of this.cableConnectHandlers) handler();
              },
              onMessage: (id: string, _msg: unknown) => {
                // Route message to the watcher that owns this subscription
                this.cableEventHandlers.get(id)?.();
              },
              onConfirm: () => {},
              onReject: (id: string) => {
                this.log.warn('watchMR: subscription rejected', { id });
              },
              onDisconnected: (intentional: boolean, reason: string) => {
                if (!intentional) {
                  for (const handler of this.cableDisconnectHandlers) handler();
                } else {
                  this.log.debug('watchMR: WS disconnected intentionally', { reason });
                }
              },
            },
            { logger: this.log, logContext: 'watchMR:shared' },
          );
          this.sharedCable.connect();
        } else if (this.sharedCable) {
          // Cable already connected — subscribe immediately
          doSubscribe();
          onConnected();
        }

        // Return dispose for this watcher only
        return () => {
          // Unsubscribe this MR's channels
          for (const id of subscriptionIds) {
            this.sharedCable?.unsubscribe(id);
            this.cableEventHandlers.delete(id);
          }
          this.cableConnectHandlers.delete(wrappedOnConnected);
          this.cableDisconnectHandlers.delete(onDisconnected);
          this.cableWatcherCount--;

          // Last watcher gone — tear down the shared connection
          if (this.cableWatcherCount === 0 && this.sharedCable) {
            this.sharedCable.disconnect();
            this.sharedCable = null;
          }
        };
      },

      onUpdate,
      options: {
        ...options,
        logger: this.log,
        logContext: `watchMR:${projectPath}!${mrIid}`,
      },
    });
  }

  watchEvents(
    projectPath: string,
    options: WatchEventsOptions,
    onInvalidations: (batch: InvalidationBatch) => void,
  ): () => void {
    const fetchEvents: FetchEvents = ({ after, perPage, page }) =>
      this.gb.Events.all({
        projectId: projectPath,
        after,
        perPage,
        page,
      }) as unknown as Promise<GitLabEvent[]>;
    return startEventsWatcher(fetchEvents, options, onInvalidations, this.log);
  }

  // ── MR lifecycle mutations ──────────────────────────────────────────────

  async mergePullRequest(projectPath: string, mrIid: number, input?: MergePullRequestInput): Promise<PullRequest> {
    const opts: Record<string, unknown> = {};
    if (input?.commitMessage != null) opts.mergeCommitMessage = input.commitMessage;
    if (input?.squashCommitMessage != null) opts.squashCommitMessage = input.squashCommitMessage;
    if (input?.squash != null) opts.squash = input.squash;
    if (input?.shouldRemoveSourceBranch != null) opts.shouldRemoveSourceBranch = input.shouldRemoveSourceBranch;
    if (input?.sha != null) opts.sha = input.sha;
    // The merge REST API has no merge_method param; it honours the project
    // setting. mergeMethod: 'squash' is treated as a squash hint, as before.
    if (input?.mergeMethod === 'squash' && input?.squash == null) opts.squash = true;

    try {
      await this.gb.MergeRequests.merge(projectPath, mrIid, opts);
    } catch (err) {
      throw await this.mergeRefusalError(projectPath, mrIid, err);
    }
    return this.fetchSingleMRWithRetry(projectPath, mrIid, 'Merged MR but failed to fetch it back');
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.gb.MergeRequestApprovals.approve(projectPath, mrIid);
    } catch (err) {
      throw this.legacyError('approvePullRequest', err);
    }
  }

  async unapprovePullRequest(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.gb.MergeRequestApprovals.unapprove(projectPath, mrIid);
    } catch (err) {
      throw this.legacyError('unapprovePullRequest', err);
    }
  }

  async rebasePullRequest(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.gb.MergeRequests.rebase(projectPath, mrIid);
    } catch (err) {
      throw this.legacyError('rebasePullRequest', err);
    }
  }

  async setAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    // PUT /merge with merge_when_pipeline_succeeds=true, same wire call as before.
    try {
      await this.gb.MergeRequests.merge(projectPath, mrIid, { mergeWhenPipelineSucceeds: true });
    } catch (err) {
      throw this.legacyError('setAutoMerge', err);
    }
  }

  async cancelAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.gb.MergeRequests.cancelOnPipelineSuccess(projectPath, mrIid);
    } catch (err) {
      throw this.legacyError('cancelAutoMerge', err);
    }
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void> {
    try {
      await this.gb.MergeRequestDiscussions.resolve(projectPath, mrIid, discussionId, true);
    } catch (err) {
      throw this.legacyError('resolveDiscussion', err);
    }
  }

  async unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void> {
    try {
      await this.gb.MergeRequestDiscussions.resolve(projectPath, mrIid, discussionId, false);
    } catch (err) {
      throw this.legacyError('unresolveDiscussion', err);
    }
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    try {
      await this.gb.Pipelines.retry(projectPath, pipelineId);
    } catch (err) {
      throw this.legacyError('retryPipeline', err);
    }
  }

  async retryJob(projectPath: string, jobId: number): Promise<void> {
    try {
      await this.gb.Jobs.retry(projectPath, jobId);
    } catch (err) {
      throw this.legacyError('retryJob', err);
    }
  }

  /** Build a Pipeline domain object from a downstream_pipeline ref + fetched jobs. */
  private async buildDownstreamPipeline(projectPath: string, dp: any): Promise<Pipeline> {
    let pipelineJobs: any[] = [];
    try {
      pipelineJobs = (await this.gb.Jobs.all(projectPath, {
        pipelineId: dp.id,
        perPage: 100,
        page: 1,
      } as never)) as unknown as any[];
    } catch {
      // Match legacy behavior: jobs listing failure yields an empty jobs array.
    }
    return {
      id: domainId('pipeline', dp.id),
      status: (dp.status || '').toLowerCase(),
      createdAt: dp.created_at || null,
      webUrl: dp.web_url || null,
      jobs: pipelineJobs.map((j: any) => ({
        id: domainId('job', j.id),
        name: j.name || '',
        stage: j.stage || '',
        status: (j.status || '').toLowerCase(),
        allowFailure: j.allow_failure || false,
        duration: j.duration ? Math.round(j.duration) : null,
        webUrl: j.web_url || null,
      })),
    };
  }

  /**
   * Shared helper: resolve downstream pipeline for a job.
   *
   * GitLab bridge/trigger jobs do NOT appear at GET /jobs/:id — that endpoint
   * returns 404 for them. Strategy:
   *   1. Try GET /jobs/:id (works for regular jobs, includes downstream_pipeline)
   *   2. If 404 and pipelineId provided, scan GET /pipelines/:pipelineId/bridges
   *      and find the bridge whose job id matches.
   */
  private async resolveDownstreamPipeline(
    projectPath: string,
    jobId: number,
    pipelineId?: number,
  ): Promise<Pipeline | null> {
    // Attempt 1: regular job endpoint (bridge jobs 404 here).
    try {
      const job: any = await this.gb.Jobs.show(projectPath, jobId);
      if (job.downstream_pipeline) {
        return this.buildDownstreamPipeline(projectPath, job.downstream_pipeline);
      }
      return null; // Regular job, not a bridge
    } catch {
      // Fall through to the bridges scan.
    }

    // Attempt 2: bridges fallback.
    if (pipelineId) {
      try {
        const bridges = (await this.gb.Jobs.allPipelineBridges(projectPath, pipelineId, {
          perPage: 100,
          page: 1,
        } as never)) as unknown as any[];
        const bridge = bridges.find((b: any) => b.id === jobId);
        if (bridge?.downstream_pipeline) {
          return this.buildDownstreamPipeline(projectPath, bridge.downstream_pipeline);
        }
      } catch {
        // Match legacy: bridge listing failure means "no downstream found".
      }
    }
    return null;
  }

  /**
   * Fetch the child/downstream pipeline for a bridge/trigger job.
   * Pass pipelineId when available so the bridges fallback can be used.
   */
  async fetchDownstreamPipeline(projectPath: string, jobId: number, pipelineId?: number): Promise<Pipeline | null> {
    return this.resolveDownstreamPipeline(projectPath, jobId, pipelineId);
  }

  /**
   * Unified job detail fetch. Returns a discriminated union:
   * - { type: 'bridge', downstreamPipeline } — trigger/bridge job
   * - { type: 'trace', content } — regular job trace log
   *
   * Pass pipelineId so bridge jobs (which 404 on /jobs/:id) can be
   * found via the /pipelines/:id/bridges fallback.
   */
  async fetchJobDetail(projectPath: string, jobId: number, pipelineId?: number): Promise<JobDetail> {
    const downstream = await this.resolveDownstreamPipeline(projectPath, jobId, pipelineId);
    if (downstream) {
      return { type: 'bridge', downstreamPipeline: downstream };
    }
    // Regular job — fetch trace log
    const content = await this.fetchJobTrace(projectPath, jobId);
    return { type: 'trace', content };
  }

  async fetchJobTrace(projectPath: string, jobId: number): Promise<string> {
    try {
      const log = await this.gb.Jobs.showLog(projectPath, jobId);
      return typeof log === 'string' ? log : String(log);
    } catch (err) {
      throw this.legacyError('fetchJobTrace', err);
    }
  }

  // ── Review mutations ────────────────────────────────────────────────────

  /**
   * GitLab has no dedicated re-request endpoint, so both paths work by
   * re-assigning the MR's reviewer set:
   *
   * - With `reviewerUsernames`: each name is resolved to a user id and
   *   unioned into the existing reviewer set (never replacing it). When a
   *   named user was not already a reviewer this genuinely changes MR
   *   state, which is what makes the call observable: a caller can
   *   re-read the MR and see the id present.
   * - Without `reviewerUsernames`: the current reviewer set is re-sent
   *   unchanged, which GitLab treats as a no-op reassignment. Its only
   *   effect is a re-notification email; there is no MR state a caller can
   *   read back to confirm it happened, so that path stays unobservable
   *   through this interface even after this fix.
   *
   * With neither usernames nor existing reviewers there is nothing to
   * re-request from, and resolving anyway would recreate the exact
   * silent-success shape this method used to have. Throw instead.
   */
  async requestReReview(projectPath: string, mrIid: number, reviewerUsernames?: string[]): Promise<void> {
    let currentReviewerIds: number[];
    try {
      const mr = (await this.gb.MergeRequests.show(projectPath, mrIid)) as unknown as {
        reviewers?: Array<{ id: number }>;
      };
      currentReviewerIds = mr.reviewers?.map((r) => r.id) ?? [];
    } catch (err) {
      throw this.legacyError('requestReReview: failed to fetch MR', err);
    }

    const reviewerIds = new Set(currentReviewerIds);
    if (reviewerUsernames?.length) {
      const resolvedIds = await this.resolveUserIds('requestReReview', reviewerUsernames);
      for (const id of resolvedIds) reviewerIds.add(id);
    } else if (reviewerIds.size === 0) {
      throw new Error(
        'requestReReview: nothing to re-request -- no reviewerUsernames given and the MR has no existing reviewers'
      );
    }

    try {
      await this.gb.MergeRequests.edit(projectPath, mrIid, { reviewerIds: [...reviewerIds] });
    } catch (err) {
      throw this.legacyError('requestReReview', err);
    }
  }

  // MARK: - Private

  /**
   * GitLab's assignee_ids / reviewer_ids take numeric user IDs, while
   * `CreatePullRequestInput` and `UpdatePullRequestInput` document these
   * fields as usernames. `requestReReview` needed this same resolution
   * first (MAT-24 predecessor); this factors it out so create/update reuse
   * it instead of each growing its own copy, or reaching for the cast this
   * used to be.
   *
   * A username with no match throws, naming it: dropping it silently would
   * return a PullRequest that looks like the reviewer/assignee was added,
   * the same defect this method exists to remove.
   */
  private async resolveUserIds(op: string, usernames: string[]): Promise<number[]> {
    return Promise.all(
      usernames.map(async (username) => {
        const matches = await this.gb.Users.all({ username });
        const user = matches[0];
        if (!user) {
          throw new Error(`${op}: no GitLab user found for username "${username}"`);
        }
        return user.id;
      }),
    );
  }

  /**
   * Retry `fetchSingleMR` with exponential backoff to handle REST→GraphQL
   * eventual consistency. GitLab's GraphQL may not immediately reflect
   * changes made via REST. 3 attempts: 0ms, 300ms, 600ms delay.
   */
  private async fetchSingleMRWithRetry(projectPath: string, mrIid: number, errorMessage: string): Promise<PullRequest> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 300));
      }
      const pr = await this.fetchSingleMR(projectPath, mrIid, null);
      if (pr) return pr;
    }
    throw new Error(errorMessage);
  }

  /**
   * Bound on the diagnostic read below. 5s is about 4.5x the slowest read the
   * live probe measured (1.1s), so a merely slow GitLab still gets to answer,
   * while the delay a caller pays for a diagnostic on an already-failed call
   * stays short. A field rather than a literal so a test can shrink it and
   * prove the bound exists without spending five seconds to do it.
   */
  private mergeStatusReadTimeoutMs = 5_000;

  /**
   * Name what GitLab refused a merge for, when GitLab itself will not (MAT-132).
   *
   * On the plain (non auto-merge) path, a refusal arrives as a bare HTTP 405
   * with nothing to read: `execute_merge` (lib/api/merge_requests.rb) calls
   * `not_allowed!` whenever `merge_request.mergeable?` is false, and
   * `not_allowed!` (lib/api/helpers.rb) renders the constant string "405
   * Method Not Allowed". One boolean, no cause, so the status cannot separate
   * "mergeability is still being computed, retry" from "a check failed,
   * change something". This is scoped to that path on purpose: the same
   * endpoint's other refusals already name themselves, 409 for a `sha` that
   * does not match the head and 422 "Branch cannot be merged" from
   * `execute_immediate_merge!`, and neither needs help.
   *
   * `detailedMergeStatus` does carry the missing cause, and is readable right
   * afterwards: a read-only probe of the live fixture returned it in 0.3-1.1s
   * per merge request, and phase 4's merge-readiness poll watched it move
   * preparing -> unchecked -> checking on a just-created MR through this same
   * `fetchSingleMR` call.
   *
   * Four deliberate limits. It does not poll, because the value is only worth
   * reporting while it is still near the refusal. It is bounded, because the
   * error path must not outlive the error: `runQuery` has no timeout of its
   * own, so an unreachable GitLab would turn a fast, correct 405 into a hang.
   * It never lets the read become the error: `fetchSingleMR` already logs and
   * returns null on transport failure, and the `catch` below covers the rest,
   * because a read failure is not why the merge did not happen. And it does
   * not claim to be the status at the instant of the refusal, which it cannot
   * be; the message says the status was read back afterwards, so a status that
   * moved in between reads as the observation it is. The one case measured for
   * that gap is benign: an MR merged by someone else between the two calls
   * reads back as `not_open`, which no one will mistake for a diagnosis. The
   * probe that measured it read closed and merged MRs only, so what a
   * transitional status looks like after a real refusal is still unmeasured.
   *
   * Only the 405 path reads anything. Other statuses already say what went
   * wrong, and spending two HTTP requests (`fetchSingleMR` issues a GraphQL
   * query and a REST show in parallel) to append a merge status to a 401 would
   * be noise. The "mergePullRequest failed: 405" prefix is preserved verbatim
   * because tests/live/conformance.ts matches on it.
   */
  private async mergeRefusalError(projectPath: string, mrIid: number, err: unknown): Promise<Error> {
    const base = this.legacyError('mergePullRequest', err);
    const httpStatus =
      err instanceof GitbeakerRequestError ? (err.cause?.response as Response | undefined)?.status : undefined;
    if (httpStatus !== 405) return base;

    const read = this.fetchSingleMR(projectPath, mrIid, null)
      .then((pr) => pr?.detailedMergeStatus ?? null)
      .catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detailed = await Promise.race([
      read,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.mergeStatusReadTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (!detailed) return base;

    const retryHint = isTransitionalMergeStatus(detailed)
      ? ' GitLab reports that value while it is still computing mergeability, so the same call may succeed once it settles.'
      : '';
    return new Error(
      `${base.message}. Read back after the refusal, GitLab reported detailedMergeStatus="${detailed}".${retryHint}`,
    );
  }

  /**
   * Rebuild the pre-gitbeaker error shape. Guarantee: any gitbeaker-raised
   * error (GitbeakerRequestError, GitbeakerRetryError) is rebuilt with the
   * stable prefix "<label> failed:", with the HTTP status appended when
   * known; the suffix carries statusText and the response body description
   * (GitbeakerRequestError) or the original message (GitbeakerRetryError).
   * Non-gitbeaker Errors pass through unchanged.
   */
  private legacyError(label: string, err: unknown): Error {
    if (err instanceof GitbeakerRequestError && err.cause?.response) {
      const res = err.cause.response as Response;
      const desc = err.cause.description ?? '';
      return new Error(`${label} failed: ${res.status} ${res.statusText}${desc ? ` — ${desc}` : ''}`);
    }
    if (err instanceof GitbeakerRetryError) {
      // Gitbeaker retries 429/502 internally up to 10 times, then throws
      // this (no cause.response) with a message like "...after 10 retries,
      // last status code: 429. Check the applicable rate limits...".
      const match = err.message.match(/status code: (\d{3})/);
      const status = match?.[1];
      return status
        ? new Error(`${label} failed: ${status} — ${err.message}`)
        : new Error(`${label} failed: ${err.message}`);
    }
    if (err instanceof Error) return err;
    return new Error(`${label} failed: ${String(err)}`);
  }

  private async runQuery<T>(op: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseURL}/api/graphql`;
    const body = JSON.stringify({ query, variables: variables ?? {} });
    const started = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body,
    });
    safeEmit(this.onRequest, {
      op,
      transport: 'graphql',
      method: 'POST',
      path: '/api/graphql',
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }

    const envelope = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (envelope.errors?.length) {
      const msg = envelope.errors.map((e) => e.message).join('; ');
      throw new Error(`GraphQL errors: ${msg}`);
    }

    if (!envelope.data) {
      throw new Error('GraphQL response missing data');
    }

    return envelope.data;
  }
}
