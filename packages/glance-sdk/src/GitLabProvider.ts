import type { GitProvider, FetchPullRequestsOptions, MRState } from './GitProvider.ts';
import type {
  BranchProtectionRule,
  CreatePullRequestInput,
  DiffStats,
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
} from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';
import { MRDetailFetcher } from './MRDetailFetcher.ts';
import { ActionCableClient } from './ActionCableClient.ts';
import { createRealtimeWatcher, type RealtimeWatcherOptions } from './RealtimeWatcher.ts';

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
  stages: { nodes: GQLStage[] };
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
  const allJobs: PipelineJob[] = p.stages.nodes.flatMap((stage) =>
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
  const allJobs = p.stages.nodes.flatMap((s) => s.jobs.nodes);
  const status = p.status.toLowerCase();
  const hasAllowFailFailed = allJobs.some((j) => j.allowFailure && j.status.toLowerCase() === 'failed');
  if (status === 'success' && hasAllowFailFailed) {
    return 'success_with_warnings';
  }
  return status;
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

  return {
    id: `gitlab:mr:${numericId(gql.id)}`,
    iid: parseInt(gql.iid, 10),
    repositoryId: `gitlab:${gql.projectId}`,
    title: gql.title,
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

// ---------------------------------------------------------------------------
// GitLabProvider
// ---------------------------------------------------------------------------

export class GitLabProvider implements GitProvider {
  readonly providerName = 'gitlab' as const;
  readonly baseURL: string;
  private readonly token: string;
  private readonly log: ForgeLogger;
  private readonly mrDetailFetcher: MRDetailFetcher;

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

  constructor(baseURL: string, token: string, options: { logger?: ForgeLogger } = {}) {
    // Strip trailing slash for consistent URL building
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;
    this.mrDetailFetcher = new MRDetailFetcher(this.baseURL, token, {
      logger: this.log,
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
    const url = `${this.baseURL}/api/v4/user`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      throw new Error(`Token validation failed: ${res.status} ${res.statusText}`);
    }
    const user = (await res.json()) as {
      id: number;
      username: string;
      name: string;
      avatar_url: string | null;
    };
    let avatarUrl: string | null = user.avatar_url;
    if (avatarUrl) {
      if (avatarUrl.startsWith('/')) {
        avatarUrl = `${this.baseURL}${avatarUrl}`;
      }
      const sep = avatarUrl.includes('?') ? '&' : '?';
      avatarUrl = `${avatarUrl}${sep}private_token=${this.token}`;
    }
    return {
      id: `gitlab:user:${user.id}`,
      username: user.username,
      name: user.name,
      avatarUrl,
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
      const encoded = encodeURIComponent(projectPath);
      [resp] = await Promise.all([
        this.runQuery<MRDetailResponse>(MR_DETAIL_QUERY, {
          projectPath,
          iid: String(mrIid),
        }),
        fetch(
          `${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}?include_diverged_commits_count=true`,
          { headers: { 'PRIVATE-TOKEN': this.token } },
        ).then(async (r) => {
          if (r.ok) {
            const data = (await r.json()) as {
              diverged_commits_count?: number;
            };
            divergedCommitsCount = data.diverged_commits_count ?? null;
          }
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

  async fetchPullRequests(options?: FetchPullRequestsOptions): Promise<PullRequest[]> {
    const stateInput = options?.state;
    const states: MRState[] = stateInput ? (Array.isArray(stateInput) ? stateInput : [stateInput]) : ['opened'];

    // Determine the single GitLab API state enum to use.
    // GitLab only accepts one state; if multiple are requested, use 'all' + client filter.
    const ALL_STATES: MRState[] = ['opened', 'merged', 'closed'];
    const needsAllStates = states.length > 1 || states.length === ALL_STATES.length;
    const apiState = needsAllStates ? 'all' : (states[0] ?? 'opened');
    const filterSet = needsAllStates ? new Set(states) : null;

    // IID batch path — use batch query for specific MRs
    if (options?.iids && options.projectPath) {
      // When fetching all states, omit the state filter entirely so
      // GitLab returns MRs regardless of state (the default is 'opened').
      const useStateFilter = !needsAllStates;
      const query = useStateFilter ? MR_BATCH_QUERY : MR_BATCH_QUERY_NO_STATE;
      const vars: Record<string, unknown> = {
        projectPath: options.projectPath,
        iids: options.iids.map(String),
      };
      if (useStateFilter) {
        vars.state = apiState;
      }
      const resp = await this.runQuery<MRBatchResponse>(query, vars);
      const nodes = resp.project?.mergeRequests?.nodes ?? [];
      const results = nodes.map((gql) => toMR(gql, 'author', this.baseURL, null, this.token));
      return filterSet ? results.filter((pr) => filterSet.has(pr.state as MRState)) : results;
    }

    // Author batch path — one query per author, deduped by MR global ID.
    // Fetches full dashboard fields directly, so callers building a team board
    // need no separate REST discovery pass.
    if (options?.authorUsernames && options.projectPath) {
      const projectPath = options.projectPath;
      const perAuthor = await Promise.all(
        options.authorUsernames.map((author) =>
          this.runQuery<MRBatchResponse>(MR_BY_AUTHOR_QUERY, {
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

    // Role-based path — 3 queries (authored + reviewing + assigned)
    const stateVar = { state: apiState };
    const [authored, reviewing, assigned] = await Promise.all([
      this.runQuery<AuthoredResponse>(AUTHORED_QUERY, stateVar),
      this.runQuery<ReviewingResponse>(REVIEWING_QUERY, stateVar),
      this.runQuery<AssignedResponse>(ASSIGNED_QUERY, stateVar),
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

    // Fetch diverged_commits_count for all MRs in parallel via REST.
    // We need the project path per MR, which we derive from webUrl.
    await Promise.all(
      prs.map(async (pr) => {
        const match = pr.webUrl?.match(/\/([^/]+\/[^/]+)\/-\/merge_requests/);
        if (!match) return;
        const projectPath = match[1]!;
        const encoded = encodeURIComponent(projectPath);
        try {
          const r = await fetch(
            `${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${pr.iid}?include_diverged_commits_count=true`,
            { headers: { 'PRIVATE-TOKEN': this.token } },
          );
          if (r.ok) {
            const data = (await r.json()) as {
              diverged_commits_count?: number;
            };
            pr.divergedCommitsCount = data.diverged_commits_count ?? null;
          }
        } catch {
          // Non-fatal — leave as null
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

  async fetchBranchProtectionRules(projectPath: string): Promise<BranchProtectionRule[]> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/protected_branches?per_page=100`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      throw new Error(`fetchBranchProtectionRules failed: ${res.status} ${await res.text()}`);
    }
    const branches = (await res.json()) as Array<{
      name: string;
      allow_force_push: boolean;
      push_access_levels: Array<{ access_level: number }>;
      merge_access_levels: Array<{ access_level: number }>;
      code_owner_approval_required?: boolean;
    }>;
    return branches.map((b) => ({
      pattern: b.name,
      allowForcePush: b.allow_force_push,
      allowDeletion: false,
      requiredApprovals: 0,
      requireStatusChecks: false,
      raw: b as unknown as Record<string, unknown>,
    }));
  }

  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseURL}/api/v4/projects/${encoded}/repository/branches/${encodeURIComponent(branch)}`,
      { method: 'DELETE', headers: { 'PRIVATE-TOKEN': this.token } },
    );
    if (!res.ok) {
      throw new Error(`deleteBranch failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state: MRState | 'all' = 'opened',
  ): Promise<PullRequest | null> {
    const encoded = encodeURIComponent(projectPath);
    const url = `${this.baseURL}/api/v4/projects/${encoded}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=${state}&per_page=1`;
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      this.log.warn('fetchPullRequestByBranch failed', {
        projectPath,
        sourceBranch,
        status: res.status,
      });
      return null;
    }
    const mrs = (await res.json()) as Array<{ iid: number }>;
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

    const resp = await this.runQuery<MRBatchResponse>(MR_BY_BRANCHES_QUERY, {
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

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const encoded = encodeURIComponent(input.projectPath);
    const body: Record<string, unknown> = {
      source_branch: input.sourceBranch,
      target_branch: input.targetBranch,
      title: input.title,
    };
    if (input.description != null) body.description = input.description;
    if (input.draft != null) body.draft = input.draft;
    if (input.labels?.length) body.labels = input.labels.join(',');
    if (input.assignees?.length) body.assignee_ids = input.assignees;
    if (input.reviewers?.length) body.reviewer_ids = input.reviewers;

    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createPullRequest failed: ${res.status} ${text}`);
    }
    const created = (await res.json()) as { iid: number };
    return this.fetchSingleMRWithRetry(input.projectPath, created.iid, 'Created MR but failed to fetch it back');
  }

  async updatePullRequest(projectPath: string, mrIid: number, input: UpdatePullRequestInput): Promise<PullRequest> {
    const encoded = encodeURIComponent(projectPath);
    const body: Record<string, unknown> = {};
    if (input.title != null) body.title = input.title;
    if (input.description != null) body.description = input.description;
    if (input.draft != null) body.draft = input.draft;
    if (input.targetBranch != null) body.target_branch = input.targetBranch;
    if (input.labels) body.labels = input.labels.join(',');
    if (input.assignees) body.assignee_ids = input.assignees;
    if (input.reviewers) body.reviewer_ids = input.reviewers;
    if (input.stateEvent) body.state_event = input.stateEvent;

    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}`, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`updatePullRequest failed: ${res.status} ${text}`);
    }
    return this.fetchSingleMRWithRetry(projectPath, mrIid, 'Updated MR but failed to fetch it back');
  }

  async restRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      'PRIVATE-TOKEN': this.token,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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

  // ── MR lifecycle mutations ──────────────────────────────────────────────

  async mergePullRequest(projectPath: string, mrIid: number, input?: MergePullRequestInput): Promise<PullRequest> {
    const encoded = encodeURIComponent(projectPath);
    const body: Record<string, unknown> = {};
    if (input?.commitMessage != null) body.merge_commit_message = input.commitMessage;
    if (input?.squashCommitMessage != null) body.squash_commit_message = input.squashCommitMessage;
    if (input?.squash != null) body.squash = input.squash;
    if (input?.shouldRemoveSourceBranch != null) body.should_remove_source_branch = input.shouldRemoveSourceBranch;
    if (input?.sha != null) body.sha = input.sha;
    // mergeMethod: GitLab uses the project's configured merge method by default.
    // The merge REST API doesn't accept a merge_method param — it honours the project setting.
    // If the caller passes mergeMethod: "squash", we set squash = true as a hint.
    if (input?.mergeMethod === 'squash' && input?.squash == null) body.squash = true;

    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/merge`, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`mergePullRequest failed: ${res.status} ${text}`);
    }
    return this.fetchSingleMRWithRetry(projectPath, mrIid, 'Merged MR but failed to fetch it back');
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/approve`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`approvePullRequest failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async unapprovePullRequest(projectPath: string, mrIid: number): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/unapprove`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`unapprovePullRequest failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async rebasePullRequest(projectPath: string, mrIid: number): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/rebase`, {
      method: 'PUT',
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`rebasePullRequest failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async setAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    // REST: PUT merge with merge_when_pipeline_succeeds = true
    // This tells GitLab to merge automatically once the head pipeline succeeds.
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/merge`, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ merge_when_pipeline_succeeds: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`setAutoMerge failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async cancelAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    // REST: POST cancel_merge_when_pipeline_succeeds
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/cancel_merge_when_pipeline_succeeds`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': this.token },
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`cancelAutoMerge failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/discussions/${discussionId}`,
      {
        method: 'PUT',
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolved: true }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`resolveDiscussion failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/discussions/${discussionId}`,
      {
        method: 'PUT',
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolved: false }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`unresolveDiscussion failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/pipelines/${pipelineId}/retry`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`retryPipeline failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  async retryJob(projectPath: string, jobId: number): Promise<void> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`retryJob failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  /** Build a Pipeline domain object from a downstream_pipeline ref + fetched jobs. */
  private async buildDownstreamPipeline(encoded: string, dp: any): Promise<Pipeline> {
    const jobsRes = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/pipelines/${dp.id}/jobs?per_page=100`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    const pipelineJobs: any[] = jobsRes.ok ? await jobsRes.json() : [];
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
    const encoded = encodeURIComponent(projectPath);

    // Attempt 1: regular job endpoint
    const jobRes = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/jobs/${jobId}`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (jobRes.ok) {
      const job: any = await jobRes.json();
      if (job.downstream_pipeline) {
        return this.buildDownstreamPipeline(encoded, job.downstream_pipeline);
      }
      return null; // Regular job, not a bridge
    }

    // Attempt 2: bridge endpoint fallback (bridge jobs 404 on /jobs/:id)
    if (pipelineId) {
      const bridgesRes = await fetch(
        `${this.baseURL}/api/v4/projects/${encoded}/pipelines/${pipelineId}/bridges?per_page=100`,
        { headers: { 'PRIVATE-TOKEN': this.token } },
      );
      if (bridgesRes.ok) {
        const bridges: any[] = await bridgesRes.json();
        const bridge = bridges.find((b: any) => b.id === jobId);
        if (bridge?.downstream_pipeline) {
          return this.buildDownstreamPipeline(encoded, bridge.downstream_pipeline);
        }
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
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/jobs/${jobId}/trace`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`fetchJobTrace failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
    return res.text();
  }

  // ── Review mutations ────────────────────────────────────────────────────

  async requestReReview(projectPath: string, mrIid: number, _reviewerUsernames?: string[]): Promise<void> {
    // GitLab does not have a dedicated "re-request review" endpoint.
    // The approach: fetch the current MR to get reviewer IDs, then
    // re-assign them via PUT to trigger review-requested notifications.
    const encoded = encodeURIComponent(projectPath);

    // Fetch current MR to get existing reviewer IDs
    const mrRes = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}`, {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!mrRes.ok) {
      const text = await mrRes.text().catch(() => '');
      throw new Error(`requestReReview: failed to fetch MR: ${mrRes.status}${text ? ` — ${text}` : ''}`);
    }

    const mr = (await mrRes.json()) as {
      reviewers?: Array<{ id: number }>;
    };
    const reviewerIds = mr.reviewers?.map((r) => r.id) ?? [];
    if (reviewerIds.length === 0) {
      // No reviewers to re-request
      return;
    }

    // Re-assign the same reviewers to trigger notifications
    const res = await fetch(`${this.baseURL}/api/v4/projects/${encoded}/merge_requests/${mrIid}`, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reviewer_ids: reviewerIds }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`requestReReview failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
  }

  // MARK: - Private

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

  private async runQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseURL}/api/graphql`;
    const body = JSON.stringify({ query, variables: variables ?? {} });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body,
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
