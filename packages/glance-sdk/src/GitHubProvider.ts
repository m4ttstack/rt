/**
 * GitHub provider implementation (Phase C1 spike).
 *
 * Uses the GitHub REST API v3 to fetch pull requests, PR details, and
 * discussions. Maps GitHub responses to the same provider-agnostic domain
 * types used by GitLab, so the Swift client renders them identically.
 *
 * Auth: expects a GitHub Personal Access Token (classic or fine-grained)
 * with `repo` scope. Passed as `Authorization: Bearer <token>`.
 *
 * Base URL: "https://api.github.com" for github.com; for GHES, the user
 * provides the instance URL and we append "/api/v3".
 */

import type { FetchPullRequestsOptions, GitProvider, MRState } from './GitProvider.ts';
import type {
  BranchProtectionRule,
  CreatePullRequestInput,
  DiffStats,
  Discussion,
  JobDetail,
  MergePullRequestInput,
  MRDetail,
  Note,
  NoteAuthor,
  NotePosition,
  Pipeline,
  PipelineJob,
  ProviderCapabilities,
  PullRequest,
  UpdatePullRequestInput,
  UserRef
} from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';

// ---------------------------------------------------------------------------
// GitHub REST API response shapes (only fields we consume)
// ---------------------------------------------------------------------------

interface GHUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url: string | null;
}

interface GHLabel {
  id: number;
  name: string;
  color: string;
}

interface GHPullRequest {
  id: number;
  /** GraphQL global node ID — the handle the v4 API addresses this PR by. */
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: string; // "open" | "closed"
  draft: boolean;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
    repo: {
      id: number;
      full_name: string;
    };
  };
  user: GHUser;
  assignees: GHUser[];
  requested_reviewers: GHUser[];
  labels: GHLabel[];
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: boolean | null;
  mergeable_state?: string; // "dirty" | "clean" | "unstable" | "blocked" | ...
  auto_merge?: {
    enabled_by: GHUser;
    merge_method: string; // "merge" | "squash" | "rebase"
  } | null;
}

interface GHReview {
  id: number;
  user: GHUser;
  state: string; // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  submitted_at: string;
}

interface GHCheckRun {
  id: number;
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

interface GHCheckSuite {
  check_runs: GHCheckRun[];
  total_count: number;
}

/** `nodes(ids:)` review-thread projection. Non-PR nodes come back as null. */
interface GHReviewThreadsResponse {
  nodes: Array<{
    id?: string;
    reviewThreads?: {
      pageInfo?: { hasNextPage: boolean };
      nodes: Array<{ isResolved: boolean }>;
    };
  } | null>;
}

/** An item from `/search/issues` — issue-shaped, with a `pull_request` stub on PRs. */
interface GHSearchItem {
  number: number;
  state: string;
  updated_at: string;
  repository_url: string;
  pull_request?: { url: string; merged_at?: string | null };
}

interface GHComment {
  id: number;
  body: string;
  user: GHUser;
  created_at: string;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  diff_hunk?: string | null;
  pull_request_review_id?: number | null;
  in_reply_to_id?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pages of 100 to walk before giving up on a search (GitHub caps it at 10). */
const SEARCH_MAX_PAGES = 10;

/** Pages of 100 to walk when listing every PR in a repository. */
const LIST_MAX_PAGES = 20;

/** PRs per batched `nodes(ids:)` review-thread query. */
const THREAD_BATCH_SIZE = 50;

/** Review threads read per PR. Beyond this the count is reported as unknown. */
const THREAD_PAGE_SIZE = 100;

function toUserRef(u: GHUser): UserRef {
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url
  };
}

/**
 * Normalize GitHub PR state to our domain states.
 * GitHub only has "open" and "closed"; we check `merged_at` to distinguish merges.
 */
function normalizePRState(pr: GHPullRequest): MRState {
  return toMRState(pr.state, pr.merged_at);
}

/**
 * The same open/closed/merged_at reading as `normalizePRState`, for payloads
 * that carry those two fields without being a full PR (search results).
 */
function toMRState(state: string, mergedAt: string | null | undefined): MRState {
  if (mergedAt) return 'merged';
  if (state === 'open') return 'opened';
  return 'closed';
}

/** The requested state filter as a set; defaults to open MRs only. */
function wantedStates(state: FetchPullRequestsOptions['state']): Set<MRState> {
  if (!state) return new Set<MRState>(['opened']);
  return new Set<MRState>(Array.isArray(state) ? state : [state]);
}

/**
 * The `is:` qualifier for a search covering `wanted`.
 *
 * GitHub search cannot express "open OR merged" in one query -- qualifiers
 * AND together, so `is:open is:closed` matches nothing. A mixed request
 * therefore searches every state and filters client-side, mirroring how
 * GitLabProvider falls back to `state: all` + a client filter.
 */
function searchStateQualifier(wanted: Set<MRState>): string {
  if (!wanted.has('opened')) return 'is:closed ';
  if (wanted.size === 1) return 'is:open ';
  return '';
}

/** The `state` query param for `/repos/{path}/pulls` covering `wanted`. */
function listStateParam(wanted: Set<MRState>): 'open' | 'closed' | 'all' {
  if (!wanted.has('opened')) return 'closed';
  if (wanted.size === 1) return 'open';
  return 'all';
}

function parseUpdatedAfter(updatedAfter: string | undefined): number | null {
  if (updatedAfter == null) return null;
  const parsed = Date.parse(updatedAfter);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `fetchPullRequests: updatedAfter must be an ISO-8601 instant, got "${updatedAfter}"`
    );
  }
  return parsed;
}

function requireProjectPath(
  projectPath: string | undefined,
  field: string
): string {
  if (!projectPath) {
    throw new Error(`fetchPullRequests: \`${field}\` requires \`projectPath\``);
  }
  return projectPath;
}

function dedupePRs(prs: GHPullRequest[]): GHPullRequest[] {
  const byKey = new Map<string, GHPullRequest>();
  for (const pr of prs) byKey.set(`${pr.base.repo.id}:${pr.number}`, pr);
  return [...byKey.values()];
}

/** A PR plus the roles the token user holds on it. */
interface PRWithRoles {
  pr: GHPullRequest;
  roles: string[];
}

/**
 * Map our provider-agnostic MRState to GitHub's `state` query param, which
 * only knows "open" | "closed" | "all" (GitHub has no separate "merged"
 * state -- a merged PR is just `state=closed` with `merged_at` set).
 */
function mapStateToGitHubQueryParam(state: MRState | 'all'): 'open' | 'closed' | 'all' {
  if (state === 'all') return 'all';
  if (state === 'opened') return 'open';
  return 'closed'; // 'closed' and 'merged' both map to GitHub's 'closed'
}

/**
 * Map GitHub check runs to our Pipeline model.
 * GitHub doesn't have a single "pipeline" concept; we synthesize one from check runs.
 */
function toPipeline(
  checkRuns: GHCheckRun[],
  prHtmlUrl: string
): Pipeline | null {
  if (checkRuns.length === 0) return null;

  const jobs: PipelineJob[] = checkRuns.map(cr => ({
    id: `github:check:${cr.id}`,
    name: cr.name,
    stage: 'checks', // GitHub doesn't have stages; use a flat stage name
    status: normalizeCheckStatus(cr),
    allowFailure: false,
    duration: cr.started_at && cr.completed_at
      ? Math.round((new Date(cr.completed_at).getTime() - new Date(cr.started_at).getTime()) / 1000)
      : null,
    webUrl: cr.html_url
  }));

  // Derive overall pipeline status from individual check runs
  const statuses = jobs.map(j => j.status);
  let overallStatus: string;
  if (statuses.some(s => s === 'failed')) {
    overallStatus = 'failed';
  } else if (statuses.some(s => s === 'running')) {
    overallStatus = 'running';
  } else if (statuses.some(s => s === 'pending')) {
    overallStatus = 'pending';
  } else if (statuses.every(s => s === 'success' || s === 'skipped')) {
    overallStatus = 'success';
  } else {
    overallStatus = 'pending';
  }

  return {
    id: `github:checks:${prHtmlUrl}`,
    status: overallStatus,
    createdAt: null,
    webUrl: `${prHtmlUrl}/checks`,
    jobs
  };
}

function normalizeCheckStatus(cr: GHCheckRun): string {
  if (cr.status === 'completed') {
    switch (cr.conclusion) {
      case 'success':
        return 'success';
      case 'failure':
      case 'timed_out':
        return 'failed';
      case 'cancelled':
        return 'canceled';
      case 'skipped':
        return 'skipped';
      case 'neutral':
        return 'success';
      case 'action_required':
        return 'manual';
      default:
        return 'pending';
    }
  }
  if (cr.status === 'in_progress') return 'running';
  return 'pending'; // "queued"
}

// ---------------------------------------------------------------------------
// GitHubProvider
// ---------------------------------------------------------------------------

export class GitHubProvider implements GitProvider {
  readonly providerName = 'github' as const;
  readonly baseURL: string;
  private readonly apiBase: string;
  private readonly graphqlURL: string;
  private readonly token: string;
  private readonly log: ForgeLogger;
  private currentUserPromise: Promise<GHUser | null> | null = null;

  /**
   * @param baseURL — The user-facing GitHub URL. For github.com: "https://github.com".
   *   For GHES: "https://github.mycompany.com".
   * @param token — A GitHub PAT (classic or fine-grained) with `repo` scope.
   * @param options.logger — Optional logger; defaults to noop.
   */
  constructor(
    baseURL: string,
    token: string,
    options: { logger?: ForgeLogger } = {}
  ) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;

    // API base: github.com uses api.github.com; GHES uses <host>/api/v3
    if (
      this.baseURL === 'https://github.com' ||
      this.baseURL === 'https://www.github.com'
    ) {
      this.apiBase = 'https://api.github.com';
      this.graphqlURL = 'https://api.github.com/graphql';
    } else {
      this.apiBase = `${this.baseURL}/api/v3`;
      // GHES serves GraphQL from /api/graphql, not under the REST /api/v3 root.
      this.graphqlURL = `${this.baseURL}/api/graphql`;
    }
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  readonly capabilities: ProviderCapabilities = {
    canMerge: true,
    canApprove: true,
    canUnapprove: false,
    canRebase: false,
    canAutoMerge: false,
    canResolveDiscussions: false,
    canRetryPipeline: true,
    canRequestReReview: true,
    canWatchEvents: false
  };

  // ── GitProvider interface ─────────────────────────────────────────────────

  async validateToken(): Promise<UserRef> {
    const res = await this.api('GET', '/user');
    if (!res.ok) {
      throw new Error(
        `GitHub token validation failed: ${res.status} ${res.statusText}`
      );
    }
    const user = (await res.json()) as GHUser;
    return toUserRef(user);
  }

  /**
   * Fetch pull requests the token user is involved in, or -- with
   * `projectPath` -- pull requests in a single repository.
   *
   * How each `FetchPullRequestsOptions` field lands on GitHub:
   * - `state` — honored. GitHub has no merged state of its own, so `merged`
   *   is `is:closed` plus a `merged_at` check (the same reading
   *   `normalizePRState` does).
   * - `iids` + `projectPath` — honored: one PR fetch per number.
   * - `authorUsernames` + `projectPath` — honored: one search per author.
   * - `projectPath` alone — honored: paginated `/pulls` listing. GitHub only
   *   returns diff stats and mergeability from the single-PR endpoint, so PRs
   *   from this mode carry `diffStats: null` and `conflicts: false`. Use
   *   `fetchSingleMR` when those matter.
   * - `updatedAfter` — honored in every mode.
   * - `listWeight` — honored in every mode: skips the per-PR check-run fetch,
   *   leaving `pipeline` null.
   *
   * `iids` and `authorUsernames` throw without `projectPath`, as the interface
   * documents.
   */
  async fetchPullRequests(
    options?: FetchPullRequestsOptions
  ): Promise<PullRequest[]> {
    const wanted = wantedStates(options?.state);
    const updatedAfter = parseUpdatedAfter(options?.updatedAfter);
    const isFresh = (updatedAt: string) =>
      updatedAfter === null || Date.parse(updatedAt) >= updatedAfter;
    const keepRaw = (pr: GHPullRequest) =>
      wanted.has(normalizePRState(pr)) && isFresh(pr.updated_at);
    const keepSearchItem = (item: GHSearchItem) =>
      wanted.has(toMRState(item.state, item.pull_request?.merged_at)) &&
      isFresh(item.updated_at);

    // A date-only lower bound is a superset of the requested instant, so the
    // exact `isFresh` filter below still decides; this only trims the search.
    const freshQualifier = options?.updatedAfter
      ? ` updated:>=${options.updatedAfter.slice(0, 10)}`
      : '';
    const stateQualifier = searchStateQualifier(wanted);

    let candidates: PRWithRoles[];

    if (options?.iids?.length) {
      const projectPath = requireProjectPath(options.projectPath, 'iids');
      const fetched = await Promise.all(
        options.iids.map(iid => this.fetchPR(projectPath, iid))
      );
      candidates = await this.withRoles(
        fetched.filter((pr): pr is GHPullRequest => pr !== null).filter(keepRaw)
      );
    } else if (options?.authorUsernames?.length) {
      const projectPath = requireProjectPath(
        options.projectPath,
        'authorUsernames'
      );
      const perAuthor = await Promise.all(
        options.authorUsernames.map(author =>
          this.searchPRs(
            `${stateQualifier}is:pr repo:${projectPath} author:${author}${freshQualifier}`,
            keepSearchItem
          )
        )
      );
      candidates = await this.withRoles(dedupePRs(perAuthor.flat()));
    } else if (options?.projectPath) {
      candidates = await this.withRoles(
        await this.listRepoPRs(options.projectPath, wanted, updatedAfter, keepRaw)
      );
    } else {
      // Involvement search: authored, review-requested, and assigned PRs are
      // three separate searches merged by PR, accumulating roles.
      const [authored, reviewRequested, assigned] = await Promise.all([
        this.searchPRs(
          `${stateQualifier}is:pr author:@me${freshQualifier}`,
          keepSearchItem
        ),
        this.searchPRs(
          `${stateQualifier}is:pr review-requested:@me${freshQualifier}`,
          keepSearchItem
        ),
        this.searchPRs(
          `${stateQualifier}is:pr assignee:@me${freshQualifier}`,
          keepSearchItem
        )
      ]);

      const byKey = new Map<string, PRWithRoles>();
      const addAll = (prs: GHPullRequest[], role: string) => {
        for (const pr of prs) {
          const key = `${pr.base.repo.id}:${pr.number}`;
          const existing = byKey.get(key);
          if (!existing) {
            byKey.set(key, { pr, roles: [role] });
          } else if (!existing.roles.includes(role)) {
            existing.roles.push(role);
          }
        }
      };
      addAll(authored, 'author');
      addAll(reviewRequested, 'reviewer');
      addAll(assigned, 'assignee');
      candidates = [...byKey.values()];
    }

    const results = await this.enrich(candidates, options?.listWeight ?? false);

    this.log.debug('GitHubProvider.fetchPullRequests', {
      count: results.length
    });
    return results;
  }

  async fetchSingleMR(
    projectPath: string,
    mrIid: number,
    _currentUserNumericId: number | null
  ): Promise<PullRequest | null> {
    // projectPath for GitHub is "owner/repo"
    try {
      const pr = await this.fetchPR(projectPath, mrIid);
      if (!pr) return null;
      const [withRoles] = await this.withRoles([pr]);
      if (!withRoles) return null;
      const [result] = await this.enrich([withRoles], false);
      return result ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn('GitHubProvider.fetchSingleMR failed', {
        projectPath,
        mrIid,
        message
      });
      return null;
    }
  }

  async fetchMRDiscussions(
    repositoryId: string,
    mrIid: number
  ): Promise<MRDetail> {
    const repoId = parseInt(repositoryId.split(':').pop() ?? '0', 10);
    // We need the repo full_name. For now, look it up from the API.
    const repoRes = await this.api('GET', `/repositories/${repoId}`);
    if (!repoRes.ok) {
      throw new Error(`Failed to fetch repo: ${repoRes.status}`);
    }
    const repo = (await repoRes.json()) as { full_name: string };

    // Fetch review comments (diff-level) and issue comments (PR-level)
    const [reviewComments, issueComments] = await Promise.all([
      this.fetchAllPages<GHComment>(
        `/repos/${repo.full_name}/pulls/${mrIid}/comments?per_page=100`
      ),
      this.fetchAllPages<GHComment>(
        `/repos/${repo.full_name}/issues/${mrIid}/comments?per_page=100`
      )
    ]);

    // Group review comments into threads (by pull_request_review_id and in_reply_to_id)
    const discussions: Discussion[] = [];

    // Issue comments become individual discussions (no threading)
    for (const c of issueComments) {
      discussions.push({
        id: `gh-issue-comment-${c.id}`,
        resolvable: null,
        resolved: null,
        notes: [toNote(c)]
      });
    }

    // Group review comments by thread root
    const threadMap = new Map<number, GHComment[]>();
    for (const c of reviewComments) {
      const rootId = c.in_reply_to_id ?? c.id;
      const thread = threadMap.get(rootId) ?? [];
      thread.push(c);
      threadMap.set(rootId, thread);
    }

    for (const [rootId, comments] of threadMap) {
      comments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      discussions.push({
        id: `gh-review-thread-${rootId}`,
        resolvable: true,
        resolved: null, // GitHub doesn't have a native "resolved" state on review threads
        notes: comments.map(toNote)
      });
    }

    return { mrIid, repositoryId, discussions };
  }

  async fetchBranchProtectionRules(
    projectPath: string
  ): Promise<BranchProtectionRule[]> {
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/branches?protected=true&per_page=100`
    );
    if (!res.ok) {
      throw new Error(
        `fetchBranchProtectionRules failed: ${res.status} ${await res.text()}`
      );
    }
    const branches = (await res.json()) as Array<{
      name: string;
      protected: boolean;
      protection?: {
        enabled: boolean;
        required_status_checks?: {
          enforcement_level: string;
          contexts: string[];
        } | null;
      };
    }>;

    const rules: BranchProtectionRule[] = [];
    for (const b of branches) {
      if (!b.protected) continue;
      // Fetch detailed protection for each protected branch
      const detailRes = await this.api(
        'GET',
        `/repos/${projectPath}/branches/${encodeURIComponent(b.name)}/protection`
      );
      if (!detailRes.ok) {
        rules.push({
          pattern: b.name,
          allowForcePush: false,
          allowDeletion: false,
          requiredApprovals: 0,
          requireStatusChecks: false
        });
        continue;
      }
      const detail = (await detailRes.json()) as {
        allow_force_pushes?: { enabled: boolean };
        allow_deletions?: { enabled: boolean };
        required_pull_request_reviews?: {
          required_approving_review_count?: number;
        } | null;
        required_status_checks?: { strict: boolean; contexts: string[] } | null;
      };
      rules.push({
        pattern: b.name,
        allowForcePush: detail.allow_force_pushes?.enabled ?? false,
        allowDeletion: detail.allow_deletions?.enabled ?? false,
        requiredApprovals:
          detail.required_pull_request_reviews
            ?.required_approving_review_count ?? 0,
        requireStatusChecks:
          detail.required_status_checks !== null &&
          detail.required_status_checks !== undefined,
        raw: detail as unknown as Record<string, unknown>
      });
    }
    return rules;
  }

  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    const res = await this.api(
      'DELETE',
      `/repos/${projectPath}/git/refs/heads/${encodeURIComponent(branch)}`
    );
    if (!res.ok) {
      throw new Error(`deleteBranch failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state: MRState | 'all' = 'opened'
  ): Promise<PullRequest | null> {
    const ghState = mapStateToGitHubQueryParam(state);

    // Fast path: GitHub's `head` filter requires `<owner>:<branch>`, and we
    // only know the BASE repo's owner here -- this matches same-repo
    // branches but never matches a fork PR (whose head lives under a
    // different owner).
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/pulls?head=${projectPath.split('/')[0]}:${encodeURIComponent(sourceBranch)}&state=${ghState}&per_page=1`
    );
    if (!res.ok) {
      this.log.warn('fetchPullRequestByBranch failed', {
        projectPath,
        sourceBranch,
        status: res.status
      });
      return null;
    }
    const prs = (await res.json()) as GHPullRequest[];
    if (prs[0]) {
      return this.fetchSingleMR(projectPath, prs[0].number, null);
    }

    // Fallback: list PRs in the target state and match by head.ref
    // client-side, which catches fork PRs the head-filtered fast path
    // above can never see. First match wins. We walk up to 5 pages (500
    // PRs) and stop early on a match or a short page (< 100, i.e. the
    // last page). This is a bounded scan, not an exhaustive search:
    // branches whose PR sits beyond the first 500 in the target state
    // are reported as not found. Callers that need an exhaustive lookup
    // should use fetchSingleMR by number instead.
    const maxPages = 5;
    for (let page = 1; page <= maxPages; page++) {
      const listRes = await this.api(
        'GET',
        `/repos/${projectPath}/pulls?state=${ghState}&per_page=100&page=${page}`
      );
      if (!listRes.ok) {
        this.log.warn('fetchPullRequestByBranch failed', {
          projectPath,
          sourceBranch,
          status: listRes.status
        });
        return null;
      }
      const list = (await listRes.json()) as GHPullRequest[];
      const match = list.find((pr) => pr.head.ref === sourceBranch);
      if (match) {
        return this.fetchSingleMR(projectPath, match.number, null);
      }
      if (list.length < 100) {
        // Short page: this was the last page, nothing left to scan.
        return null;
      }
      if (page === maxPages) {
        this.log.warn('fetchPullRequestByBranch: fallback scan hit page limit', {
          projectPath,
          sourceBranch
        });
      }
    }
    return null;
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      head: input.sourceBranch,
      base: input.targetBranch,
      title: input.title
    };
    if (input.description != null) body.body = input.description;
    if (input.draft != null) body.draft = input.draft;

    const res = await this.api(
      'POST',
      `/repos/${input.projectPath}/pulls`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createPullRequest failed: ${res.status} ${text}`);
    }
    const created = (await res.json()) as GHPullRequest;

    // GitHub doesn't support reviewers/assignees/labels on create — add them separately
    if (input.reviewers?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/pulls/${created.number}/requested_reviewers`,
        {
          reviewers: input.reviewers
        }
      );
    }
    if (input.assignees?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/issues/${created.number}/assignees`,
        {
          assignees: input.assignees
        }
      );
    }
    if (input.labels?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/issues/${created.number}/labels`,
        {
          labels: input.labels
        }
      );
    }

    const pr = await this.fetchSingleMR(
      input.projectPath,
      created.number,
      null
    );
    if (!pr) throw new Error('Created PR but failed to fetch it back');
    return pr;
  }

  /**
   * `input.draft` is applied with a GraphQL mutation, not through the PATCH:
   * GitHub's REST update endpoint has no `draft` field, so the value the
   * previous code put in the request body was silently discarded (MAT-15).
   */
  async updatePullRequest(
    projectPath: string,
    mrIid: number,
    input: UpdatePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    if (input.title != null) body.title = input.title;
    if (input.description != null) body.body = input.description;
    if (input.targetBranch != null) body.base = input.targetBranch;
    if (input.stateEvent)
      body.state = input.stateEvent === 'close' ? 'closed' : 'open';

    const res = await this.api(
      'PATCH',
      `/repos/${projectPath}/pulls/${mrIid}`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`updatePullRequest failed: ${res.status} ${text}`);
    }

    if (input.draft != null) {
      const patched = (await res.json()) as GHPullRequest;
      if (patched.draft !== input.draft) {
        await this.setDraft(patched.node_id, input.draft);
      }
    }

    // Handle reviewers/assignees/labels replacement if provided
    if (input.reviewers) {
      await this.api(
        'POST',
        `/repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        {
          reviewers: input.reviewers
        }
      );
    }
    if (input.assignees) {
      await this.api(
        'POST',
        `/repos/${projectPath}/issues/${mrIid}/assignees`,
        {
          assignees: input.assignees
        }
      );
    }
    if (input.labels) {
      await this.api('PUT', `/repos/${projectPath}/issues/${mrIid}/labels`, {
        labels: input.labels
      });
    }

    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Updated PR but failed to fetch it back');
    return pr;
  }

  async restRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    return this.api(method, path, body);
  }

  watchMR(
    _projectPath: string,
    _mrIid: number,
    _currentUserNumericId: number | null,
    _onUpdate: (pr: PullRequest) => void,
    _options?: import('./RealtimeWatcher.ts').RealtimeWatcherOptions
  ): () => void {
    throw new Error(
      'watchMR is not supported by the GitHub REST API. ' +
        'GitHub does not offer a WebSocket subscription equivalent. ' +
        'Check provider capabilities before calling.'
    );
  }

  async mergePullRequest(
    projectPath: string,
    mrIid: number,
    input?: MergePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    if (input?.commitMessage != null) body.commit_title = input.commitMessage;
    if (input?.squashCommitMessage != null)
      body.commit_title = input.squashCommitMessage;
    if (input?.shouldRemoveSourceBranch != null)
      body.delete_branch = input.shouldRemoveSourceBranch;
    if (input?.sha != null) body.sha = input.sha;

    // Map mergeMethod / squash to GitHub's merge_method parameter.
    // GitHub accepts: "merge", "squash", "rebase".
    if (input?.mergeMethod) {
      body.merge_method = input.mergeMethod;
    } else if (input?.squash) {
      body.merge_method = 'squash';
    }

    const res = await this.api(
      'PUT',
      `/repos/${projectPath}/pulls/${mrIid}/merge`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`mergePullRequest failed: ${res.status} ${text}`);
    }
    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Merged PR but failed to fetch it back');
    return pr;
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    const res = await this.api(
      'POST',
      `/repos/${projectPath}/pulls/${mrIid}/reviews`,
      {
        event: 'APPROVE'
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `approvePullRequest failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  async unapprovePullRequest(
    _projectPath: string,
    _mrIid: number
  ): Promise<void> {
    // TODO: GitHub does not support unapproving via REST API.
    // A possible workaround is to dismiss the review via
    //   PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals
    // but that requires knowing the review ID and is semantically different
    // (dismissal vs. unapproval). Leave as stub until a use case emerges.
    throw new Error(
      'unapprovePullRequest is not supported by GitHub. ' +
        'Check provider.capabilities.canUnapprove before calling.'
    );
  }

  async rebasePullRequest(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub has no native "rebase" API for pull requests.
    // The closest equivalent is the update-branch API:
    //   PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
    // which updates the PR branch with the latest from the base branch,
    // but it's a merge (not a rebase). True rebase requires pushing
    // locally rebased commits.
    throw new Error(
      'rebasePullRequest is not supported by GitHub. ' +
        'Check provider.capabilities.canRebase before calling.'
    );
  }

  async setAutoMerge(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub supports auto-merge via GraphQL mutation:
    //   mutation { enablePullRequestAutoMerge(input: { pullRequestId: "..." }) { ... } }
    // Requires the repository to have "Allow auto-merge" enabled in settings.
    // The REST API does not support this — GraphQL only.
    throw new Error(
      'setAutoMerge is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canAutoMerge before calling.'
    );
  }

  async cancelAutoMerge(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { disablePullRequestAutoMerge(input: { pullRequestId: "..." }) { ... } }
    // Same pre-requisites as setAutoMerge.
    throw new Error(
      'cancelAutoMerge is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canAutoMerge before calling.'
    );
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(
    _projectPath: string,
    _mrIid: number,
    _discussionId: string
  ): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { resolveReviewThread(input: { threadId: "..." }) { ... } }
    // REST API does not support resolving review threads.
    throw new Error(
      'resolveDiscussion is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canResolveDiscussions before calling.'
    );
  }

  async unresolveDiscussion(
    _projectPath: string,
    _mrIid: number,
    _discussionId: string
  ): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { unresolveReviewThread(input: { threadId: "..." }) { ... } }
    // REST API does not support unresolving review threads.
    throw new Error(
      'unresolveDiscussion is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canResolveDiscussions before calling.'
    );
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    // GitHub Actions: re-run a workflow run.
    // pipelineId maps to the workflow run ID.
    const res = await this.api(
      'POST',
      `/repos/${projectPath}/actions/runs/${pipelineId}/rerun`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `retryPipeline failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  async retryJob(projectPath: string, jobId: number): Promise<void> {
    // GitHub Actions: re-run a single job within a workflow run.
    // jobId maps to the job ID. Requires the workflow run ID which we don't have here.
    // Use POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun
    const res = await this.api(
      'POST',
      `/repos/${projectPath}/actions/jobs/${jobId}/rerun`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `retryJob failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  async fetchJobTrace(projectPath: string, jobId: number): Promise<string> {
    // GitHub Actions: download job logs
    // GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/actions/jobs/${jobId}/logs`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `fetchJobTrace failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
    return res.text();
  }

  async fetchDownstreamPipeline(_projectPath: string, _jobId: number): Promise<Pipeline | null> {
    // GitHub Actions doesn't have a child/downstream pipeline concept
    return null;
  }

  async fetchJobDetail(projectPath: string, jobId: number, _pipelineId?: number): Promise<JobDetail> {
    // GitHub Actions has no bridge/trigger concept — always return trace
    const content = await this.fetchJobTrace(projectPath, jobId);
    return { type: 'trace', content };
  }

  // ── Review mutations ────────────────────────────────────────────────────

  async requestReReview(
    projectPath: string,
    mrIid: number,
    reviewerUsernames?: string[]
  ): Promise<void> {
    // GitHub: POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
    // If no usernames provided, we'd need to fetch the current PR to get
    // the existing reviewer list. For now, require explicit usernames.
    if (!reviewerUsernames?.length) {
      // Fetch current reviewers from the PR
      const prRes = await this.api(
        'GET',
        `/repos/${projectPath}/pulls/${mrIid}`
      );
      if (!prRes.ok) {
        throw new Error(`requestReReview: failed to fetch PR: ${prRes.status}`);
      }
      const pr = (await prRes.json()) as GHPullRequest;
      reviewerUsernames = pr.requested_reviewers.map(r => r.login);
      if (!reviewerUsernames.length) {
        // Nothing to re-request
        return;
      }
    }

    const res = await this.api(
      'POST',
      `/repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
      { reviewers: reviewerUsernames }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `requestReReview failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  }

  /**
   * Issue a GraphQL (v4) request. Returns null on transport, HTTP, or GraphQL
   * errors: callers report "unknown" rather than substituting a value.
   */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T | null> {
    try {
      const res = await fetch(this.graphqlURL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
      });
      if (!res.ok) {
        this.log.warn('GitHub GraphQL request failed', { status: res.status });
        return null;
      }
      const payload = (await res.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };
      if (payload.errors?.length) {
        this.log.warn('GitHub GraphQL returned errors', {
          messages: payload.errors.map(e => e.message)
        });
        return null;
      }
      return payload.data ?? null;
    } catch (err) {
      this.log.warn('GitHub GraphQL request threw', {
        message: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  }

  /**
   * Move a PR between draft and ready for review.
   *
   * These two mutations are GitHub's only API for the transition -- REST
   * exposes `draft` on create and nowhere else. A failure throws: reporting
   * success on a draft flag that never landed is the bug this replaces.
   */
  private async setDraft(
    pullRequestId: string,
    draft: boolean
  ): Promise<void> {
    const field = draft
      ? 'convertPullRequestToDraft'
      : 'markPullRequestReadyForReview';
    const mutation = `
      mutation GlanceSetDraft($id: ID!) {
        ${field}(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }
    `;

    const data = await this.graphql<
      Record<string, { pullRequest?: { isDraft: boolean } } | undefined>
    >(mutation, { id: pullRequestId });

    if (data?.[field]?.pullRequest?.isDraft !== draft) {
      throw new Error(
        `updatePullRequest failed: could not set draft=${draft} (GitHub GraphQL ${field})`
      );
    }
  }

  /**
   * Unresolved review-thread counts for `prs`, keyed by GraphQL node ID.
   *
   * Thread resolution exists only in GraphQL (`reviewThreads { isResolved }`);
   * REST review comments carry no resolved state, so they are not a substitute.
   * One batched query per `THREAD_BATCH_SIZE` PRs keeps this off the per-PR
   * path.
   *
   * A PR maps to null -- unknown, not zero -- when the query fails or when the
   * PR has more than `THREAD_PAGE_SIZE` threads: a truncated read cannot say
   * how many of the remainder are outstanding.
   */
  private async fetchUnresolvedThreadCounts(
    prs: GHPullRequest[]
  ): Promise<Map<string, number | null>> {
    const counts = new Map<string, number | null>();
    const ids = prs.map(pr => pr.node_id).filter(id => !!id);
    if (ids.length === 0) return counts;

    const query = `
      query GlanceUnresolvedThreads($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on PullRequest {
            id
            reviewThreads(first: ${THREAD_PAGE_SIZE}) {
              pageInfo { hasNextPage }
              nodes { isResolved }
            }
          }
        }
      }
    `;

    for (let i = 0; i < ids.length; i += THREAD_BATCH_SIZE) {
      const batch = ids.slice(i, i + THREAD_BATCH_SIZE);
      const data = await this.graphql<GHReviewThreadsResponse>(query, {
        ids: batch
      });
      for (const node of data?.nodes ?? []) {
        if (!node?.id) continue;
        const threads = node.reviewThreads;
        counts.set(
          node.id,
          threads && !threads.pageInfo?.hasNextPage
            ? threads.nodes.filter(t => !t.isResolved).length
            : null
        );
      }
      for (const id of batch) {
        if (!counts.has(id)) counts.set(id, null);
      }
    }

    return counts;
  }

  /**
   * Search for PRs using the GitHub search API, keeping only the items `keep`
   * accepts, then fetching full PR details for those.
   *
   * Filtering on the issue-shaped search result first means a state filter
   * costs nothing extra: PRs we are about to discard never get a detail fetch.
   *
   * Walks up to `SEARCH_MAX_PAGES` pages and logs a warning if it stops there
   * with more results outstanding — a bounded scan, not an exhaustive one.
   */
  private async searchPRs(
    qualifiers: string,
    keep: (item: GHSearchItem) => boolean
  ): Promise<GHPullRequest[]> {
    const q = encodeURIComponent(qualifiers);
    const matched: GHSearchItem[] = [];

    for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
      const res = await this.api(
        'GET',
        `/search/issues?q=${q}&per_page=100&sort=updated&page=${page}`
      );
      if (!res.ok) {
        this.log.warn('GitHub search failed', {
          status: res.status,
          qualifiers
        });
        break;
      }

      const data = (await res.json()) as { items: GHSearchItem[] };
      matched.push(...data.items.filter(item => item.pull_request && keep(item)));

      if (data.items.length < 100) break;
      if (page === SEARCH_MAX_PAGES) {
        this.log.warn('GitHub search hit the page limit', { qualifiers });
      }
    }

    // The search API returns issue-shaped results; fetch full PR details
    const results = await Promise.all(
      matched.map(item =>
        this.fetchPR(
          item.repository_url.replace(`${this.apiBase}/repos/`, ''),
          item.number
        )
      )
    );
    return results.filter((pr): pr is GHPullRequest => pr !== null);
  }

  /** GET a single PR. Null when the repo or PR is not visible to this token. */
  private async fetchPR(
    projectPath: string,
    prNumber: number
  ): Promise<GHPullRequest | null> {
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/pulls/${prNumber}`
    );
    if (!res.ok) return null;
    return (await res.json()) as GHPullRequest;
  }

  /**
   * Every PR in a repository, newest-updated first.
   *
   * The listing endpoint omits `additions`/`deletions`/`changed_files` and
   * `mergeable`; PRs from here therefore have no diff stats and report no
   * conflicts. Fetching those would cost one extra request per PR.
   */
  private async listRepoPRs(
    projectPath: string,
    wanted: Set<MRState>,
    updatedAfter: number | null,
    keep: (pr: GHPullRequest) => boolean
  ): Promise<GHPullRequest[]> {
    const state = listStateParam(wanted);
    const collected: GHPullRequest[] = [];

    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const res = await this.api(
        'GET',
        `/repos/${projectPath}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`
      );
      if (!res.ok) {
        throw new Error(
          `fetchPullRequests failed: ${res.status} ${await res.text()}`
        );
      }
      const listed = (await res.json()) as GHPullRequest[];
      collected.push(...listed.filter(keep));

      if (listed.length < 100) break;
      // Sorted newest-updated first, so once a page ends before the cutoff
      // every later page is older too.
      const oldest = listed.at(-1);
      if (
        updatedAfter !== null &&
        oldest &&
        Date.parse(oldest.updated_at) < updatedAfter
      ) {
        break;
      }
      if (page === LIST_MAX_PAGES) {
        this.log.warn('fetchPullRequests: project listing hit the page limit', {
          projectPath
        });
      }
    }

    return collected;
  }

  /**
   * The authenticated user, fetched once per provider instance.
   * Null when the lookup fails — callers degrade to unknown roles rather than
   * failing the whole fetch.
   */
  private async currentUser(): Promise<GHUser | null> {
    this.currentUserPromise ??= (async () => {
      const res = await this.api('GET', '/user');
      if (!res.ok) return null;
      return (await res.json()) as GHUser;
    })().catch(() => null);
    return this.currentUserPromise;
  }

  private async withRoles(prs: GHPullRequest[]): Promise<PRWithRoles[]> {
    if (prs.length === 0) return [];
    const me = await this.currentUser();
    return prs.map(pr => {
      const roles: string[] = [];
      if (me) {
        if (pr.user.id === me.id) roles.push('author');
        if (pr.assignees.some(a => a.id === me.id)) roles.push('assignee');
        if (pr.requested_reviewers.some(r => r.id === me.id))
          roles.push('reviewer');
      }
      return { pr, roles: roles.length > 0 ? roles : ['author'] };
    });
  }

  /**
   * Turn raw PRs into domain PullRequests: reviews and check runs per PR,
   * unresolved review-thread counts batched across all of them.
   */
  private async enrich(
    candidates: PRWithRoles[],
    listWeight: boolean
  ): Promise<PullRequest[]> {
    const threadCounts = await this.fetchUnresolvedThreadCounts(
      candidates.map(c => c.pr)
    );
    return Promise.all(
      candidates.map(async ({ pr, roles }) => {
        const [reviews, checkRuns] = await Promise.all([
          this.fetchReviews(pr.base.repo.full_name, pr.number),
          listWeight
            ? Promise.resolve<GHCheckRun[]>([])
            : this.fetchCheckRuns(pr.base.repo.full_name, pr.head.sha)
        ]);
        return this.toPullRequest(
          pr,
          roles,
          reviews,
          checkRuns,
          threadCounts.get(pr.node_id) ?? null
        );
      })
    );
  }

  private async fetchReviews(
    repoPath: string,
    prNumber: number
  ): Promise<GHReview[]> {
    return this.fetchAllPages<GHReview>(
      `/repos/${repoPath}/pulls/${prNumber}/reviews?per_page=100`
    );
  }

  private async fetchCheckRuns(
    repoPath: string,
    sha: string
  ): Promise<GHCheckRun[]> {
    try {
      const res = await this.api(
        'GET',
        `/repos/${repoPath}/commits/${sha}/check-runs?per_page=100`
      );
      if (!res.ok) return [];
      const data = (await res.json()) as GHCheckSuite;
      return data.check_runs;
    } catch {
      return [];
    }
  }

  private async fetchAllPages<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = path;

    while (url) {
      const res = await this.api('GET', url);
      if (!res.ok) break;
      const items = (await res.json()) as T[];
      results.push(...items);

      // Parse Link header for pagination
      const linkHeader = res.headers.get('Link');
      const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        // Strip apiBase prefix — `api()` will re-add it
        url = nextMatch[1]!.replace(this.apiBase, '');
      } else {
        url = null;
      }
    }

    return results;
  }

  /**
   * Convert a GitHub PR + reviews + check runs into our domain PullRequest.
   *
   * @param unresolvedThreadCount - null when the count could not be read; the
   *   field must not claim zero outstanding threads on a guess.
   */
  private toPullRequest(
    pr: GHPullRequest,
    roles: string[],
    reviews: GHReview[],
    checkRuns: GHCheckRun[],
    unresolvedThreadCount: number | null
  ): PullRequest {
    // Compute approvals: latest review per user, count "APPROVED" ones
    const latestReviewByUser = new Map<number, GHReview>();
    for (const r of reviews.sort(
      (a, b) =>
        new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
    )) {
      latestReviewByUser.set(r.user.id, r);
    }

    const approvedBy: UserRef[] = [];
    let changesRequested = 0;
    for (const r of latestReviewByUser.values()) {
      if (r.state === 'APPROVED') {
        approvedBy.push(toUserRef(r.user));
      } else if (r.state === 'CHANGES_REQUESTED') {
        changesRequested++;
      }
    }

    // GitHub doesn't expose required approval count via REST without the
    // branch protection API. We use changesRequested as a blocking signal:
    // 0 = not blocked by reviews, 1 = at least one CHANGES_REQUESTED review.
    const approvalsLeft = changesRequested > 0 ? 1 : 0;

    const diffStats: DiffStats | null =
      pr.additions !== undefined
        ? {
            additions: pr.additions!,
            deletions: pr.deletions ?? 0,
            filesChanged: pr.changed_files ?? 0
          }
        : null;

    // Conflicts: GitHub's mergeable_state "dirty" indicates conflicts
    const conflicts = pr.mergeable === false || pr.mergeable_state === 'dirty';

    const pipeline = toPipeline(checkRuns, pr.html_url);

    return {
      id: `github:pr:${pr.id}`,
      iid: pr.number,
      repositoryId: `github:${pr.base.repo.id}`,
      title: pr.title,
      state: normalizePRState(pr),
      draft: pr.draft,
      conflicts,
      webUrl: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      sha: pr.head.sha,
      author: toUserRef(pr.user),
      assignees: pr.assignees.map(toUserRef),
      reviewers: pr.requested_reviewers.map(u => ({
        ...toUserRef(u),
        reviewState: null as import('./types.ts').Reviewer['reviewState']
      })),
      roles,
      pipeline,
      description: pr.body ?? null,
      unresolvedThreadCount,
      approvalsLeft,
      approved: approvedBy.length > 0 && changesRequested === 0,
      approvedBy,
      diffStats,
      // Documented as the raw GitLab status; GitHub's mergeable_state uses a
      // different vocabulary, so publishing it here would invite comparisons
      // against GitLab values that can never match. `conflicts` above carries
      // the one part of it we can map. See MAT-14.
      detailedMergeStatus: null,
      autoMergeEnabled: pr.auto_merge != null,
      autoMergeStrategy: pr.auto_merge?.merge_method ?? null,
      mergeUser: pr.auto_merge ? toUserRef(pr.auto_merge.enabled_by) : null,
      mergeAfter: null, // GitHub doesn't have scheduled merge
      divergedCommitsCount: null, // Would need GET /compare/{base}...{head} — too costly per PR
      rebaseInProgress: false,
      mergeOngoing: false,
      inProgressMergeCommitSha: null,
      mergeError: null,
      shouldBeRebased: false,
      mergeabilityChecks: [], // GitHub doesn't expose individual check list via REST
      blockingMergeRequestsCount: 0,
      approvalsRequired: 0, // Not available without branch protection API
      squash: false,
      squashOnMerge: false,
      mergeTrainIndex: null
    };
  }
}

// ---------------------------------------------------------------------------
// Note mapping
// ---------------------------------------------------------------------------

function toNote(c: GHComment): Note {
  const position: NotePosition | null = c.path
    ? {
        newPath: c.path,
        oldPath: c.path,
        newLine: c.line ?? null,
        oldLine: c.original_line ?? null,
        positionType: c.path ? 'text' : null
      }
    : null;

  return {
    id: c.id,
    body: c.body,
    author: toNoteAuthor(c.user),
    createdAt: c.created_at,
    system: false,
    type: c.path ? 'DiffNote' : 'DiscussionNote',
    resolvable: c.path ? true : null,
    resolved: null,
    position
  };
}

function toNoteAuthor(u: GHUser): NoteAuthor {
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url
  };
}
