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

import type {
  FetchPullRequestsOptions,
  FetchPullRequestsWarning,
  GitProvider,
  MRState
} from './GitProvider.ts';
import { parseUpdatedAfter, requireProjectPath } from './GitProvider.ts';
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
import {
  createGitHubClient,
  ghError,
  reasonPhrase,
  resolveGitHubUrls,
  type GlanceOctokit
} from './githubClient.ts';
import type { OnRequestHook } from './instrumentation.ts';
import { RequestError } from '@octokit/request-error';

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
  /** GraphQL global node ID: the handle the v4 API addresses this PR by. */
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
    /**
     * The repository the branch lives in. Present on real API responses;
     * declared optional/nullable here because GitHub returns null when the
     * fork has since been deleted.
     */
    repo?: { full_name: string } | null;
  };
  base: {
    ref: string;
    repo: {
      id: number;
      full_name: string;
      default_branch?: string;
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

/** An item from `/search/issues`: issue-shaped, with a `pull_request` stub on PRs. */
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

/** Pages of 100 to walk before giving up on a search. Matches the bound
    fetchPullRequestByBranch uses for its own fallback scan. */
const SEARCH_MAX_PAGES = 5;

/** Pages of 100 to walk when listing every PR in a repository. */
const LIST_MAX_PAGES = 20;

/** PRs per batched `nodes(ids:)` review-thread query. */
const THREAD_BATCH_SIZE = 50;

/**
 * Per-PR requests in flight at once (detail, reviews, check runs).
 *
 * An unbounded `Promise.all` over a few hundred PRs opens a few hundred
 * sockets and spends the secondary rate limit in one burst, which GitHub
 * answers with 403s. Slower and complete beats faster and throttled.
 */
const DETAIL_CONCURRENCY = 8;

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
 * The `is:` qualifiers to search for `wanted`: one query per qualifier.
 *
 * GitHub search cannot express "open OR merged" in one query -- qualifiers
 * AND together, so `is:open is:closed` matches nothing. Dropping the
 * qualifier instead would match every PR the user has ever touched, all
 * time, which is how a mixed-state request became the most expensive call in
 * the SDK. Two bounded searches cost less than one unbounded one.
 *
 * `merged` and `closed` are both `is:closed` on GitHub (a merged PR is a
 * closed one with `merged_at` set), so a request for both still searches once.
 */
function searchStateQualifiers(wanted: Set<MRState>): string[] {
  const qualifiers: string[] = [];
  if (wanted.has('opened')) qualifiers.push('is:open');
  if (wanted.has('merged') || wanted.has('closed')) qualifiers.push('is:closed');
  return qualifiers.length > 0 ? qualifiers : ['is:open'];
}

/** The `state` query param for `/repos/{path}/pulls` covering `wanted`. */
function listStateParam(wanted: Set<MRState>): 'open' | 'closed' | 'all' {
  if (!wanted.has('opened')) return 'closed';
  if (wanted.size === 1) return 'open';
  return 'all';
}

/** A PR plus the roles the token user holds on it. */
interface PRWithRoles {
  pr: GHPullRequest;
  roles: string[];
}

/** A PR a search matched, before it has been fetched in full. */
interface SearchHit {
  /** `owner/repo`. */
  repoPath: string;
  number: number;
}

function hitKey(hit: SearchHit): string {
  return `${hit.repoPath}#${hit.number}`;
}

/** One entry per PR, in first-seen order. */
function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (!seen.has(hitKey(hit))) seen.set(hitKey(hit), hit);
  }
  return [...seen.values()];
}

/**
 * `task` over every item with at most `limit` running at once, results in
 * input order.
 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await task(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
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
  private readonly octokit: GlanceOctokit;
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
    options: { logger?: ForgeLogger; onRequest?: OnRequestHook } = {}
  ) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;

    const urls = resolveGitHubUrls(this.baseURL);
    this.apiBase = urls.apiBase;
    this.graphqlURL = urls.graphqlURL;
    this.octokit = createGitHubClient({
      baseURL: this.baseURL,
      token: this.token,
      log: this.log,
      onRequest: options.onRequest
    });
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
    let user: GHUser;
    try {
      const res = await this.octokit.request('GET /user');
      user = res.data as GHUser;
    } catch (err) {
      throw ghError('validateToken', err);
    }
    return toUserRef(user);
  }

  /**
   * Fetch pull requests the token user is involved in, or -- with
   * `projectPath` -- pull requests in a single repository.
   *
   * How each `FetchPullRequestsOptions` field lands on GitHub:
   * - `state`: honored. GitHub has no merged state of its own, so `merged`
   *   is `is:closed` plus a `merged_at` check (the same reading
   *   `normalizePRState` does). A request for several states runs one search
   *   per `is:` qualifier rather than an unqualified (all-time) search.
   * - `iids` + `projectPath`: honored, one PR fetch per number.
   * - `authorUsernames` + `projectPath`: honored, one search per author and
   *   state qualifier.
   * - `projectPath` alone: honored, paginated `/pulls` listing. GitHub only
   *   returns diff stats and mergeability from the single-PR endpoint, so PRs
   *   from this mode carry `diffStats: null` and `conflicts: false`. Use
   *   `fetchSingleMR` when those matter.
   * - `updatedAfter`: honored in every mode.
   * - `listWeight`: honored in every mode, skips the per-PR check-run fetch,
   *   leaving `pipeline` null.
   * - `onWarning`: called for page-cap truncation and for detail fetches
   *   GitHub rejected (the shape rate limiting takes here).
   *
   * `iids` and `authorUsernames` throw without `projectPath`, as the interface
   * documents.
   *
   * Cost, for U matching PRs and Q state qualifiers (1, or 2 for a request
   * mixing open with merged/closed): the involvement mode runs 3*Q searches of
   * up to `SEARCH_MAX_PAGES` pages each, then 1 detail GET + 1 reviews GET per
   * unique PR, + 1 check-runs GET unless `listWeight`, + ceil(U/50) GraphQL
   * calls for thread counts. Searches are merged by PR before any detail
   * fetch, so a PR three searches matched still costs one GET.
   */
  async fetchPullRequests(
    options?: FetchPullRequestsOptions
  ): Promise<PullRequest[]> {
    const wanted = wantedStates(options?.state);
    const updatedAfter = parseUpdatedAfter(options?.updatedAfter);
    const onWarning = options?.onWarning;
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
    const stateQualifiers = searchStateQualifiers(wanted);

    let candidates: PRWithRoles[];

    // Mode selection keys off the field being present, not non-empty: an empty
    // `iids` list asks for no MRs, not for the whole repository.
    if (options?.iids) {
      const projectPath = requireProjectPath(options.projectPath, 'iids');
      const fetched = await mapPool(options.iids, DETAIL_CONCURRENCY, iid =>
        this.fetchPR(projectPath, iid, onWarning)
      );
      candidates = await this.withRoles(
        fetched.filter((pr): pr is GHPullRequest => pr !== null).filter(keepRaw)
      );
    } else if (options?.authorUsernames) {
      const projectPath = requireProjectPath(
        options.projectPath,
        'authorUsernames'
      );
      const perSearch = await Promise.all(
        options.authorUsernames.flatMap(author =>
          stateQualifiers.map(state =>
            this.searchPRs(
              `${state} is:pr repo:${projectPath} author:${author}${freshQualifier}`,
              keepSearchItem,
              onWarning
            )
          )
        )
      );
      const fetched = await this.fetchHits(dedupeHits(perSearch.flat()), onWarning);
      candidates = await this.withRoles(fetched.map(({ pr }) => pr));
    } else if (options?.projectPath) {
      candidates = await this.withRoles(
        await this.listRepoPRs(
          options.projectPath,
          wanted,
          updatedAfter,
          keepRaw,
          onWarning
        )
      );
    } else {
      // Involvement search: authored, review-requested, and assigned PRs are
      // separate searches (times one per state qualifier) merged by PR. The
      // merge happens on the search results, BEFORE any detail fetch: a PR the
      // token user authored, was assigned, and was asked to review used to cost
      // three identical detail GETs.
      const involvements = [
        { qualifier: 'author:@me', role: 'author' },
        { qualifier: 'review-requested:@me', role: 'reviewer' },
        { qualifier: 'assignee:@me', role: 'assignee' }
      ];
      const searched = await Promise.all(
        involvements.flatMap(({ qualifier, role }) =>
          stateQualifiers.map(async state => ({
            role,
            hits: await this.searchPRs(
              `${state} is:pr ${qualifier}${freshQualifier}`,
              keepSearchItem,
              onWarning
            )
          }))
        )
      );

      const rolesByHit = new Map<string, string[]>();
      const unique: SearchHit[] = [];
      for (const { role, hits } of searched) {
        for (const hit of hits) {
          const roles = rolesByHit.get(hitKey(hit));
          if (!roles) {
            rolesByHit.set(hitKey(hit), [role]);
            unique.push(hit);
          } else if (!roles.includes(role)) {
            roles.push(role);
          }
        }
      }

      const fetched = await this.fetchHits(unique, onWarning);
      candidates = fetched.map(({ hit, pr }) => ({
        pr,
        roles: rolesByHit.get(hitKey(hit)) ?? ['author']
      }));
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
        // The invented rule this replaces was wrong in both directions at once:
        // it claimed force-push and deletion were forbidden while also claiming
        // no approvals and no status checks were required, and a caller had no
        // way to tell those four values from real ones (MAT-131). On a private
        // repository on the free plan this is a 403, which the message surfaces.
        const text = await detailRes.text().catch(() => '');
        throw new Error(
          `fetchBranchProtectionRules failed reading protection for "${b.name}": ${detailRes.status} ${text}`
        );
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
    // The whole "owner:branch" value is encoded together, not just the
    // branch half. Octokit's endpoint parser rewrites `:word` into a route
    // placeholder before this string ever reaches fetch, and an unencoded
    // colon here reads as exactly that: `head=o:mybranch` becomes the
    // placeholder `{mybranch}`, which expands to empty with no parameters
    // supplied, silently turning this into a query for any PR from the
    // owner instead of this branch's PR. Because the whole value goes
    // through `encodeURIComponent` before it is spliced in, the colon is
    // already `%3A` by the time this string exists -- there is no raw `:`
    // left for the placeholder rewrite to find, on this route or the
    // fallback one below, so calling `octokit.request` directly here (unlike
    // arbitrary future paths) needs no extra escaping.
    let prs: GHPullRequest[];
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/pulls?head=${encodeURIComponent(`${projectPath.split('/')[0]}:${sourceBranch}`)}&state=${ghState}&per_page=1`
      );
      prs = res.data as GHPullRequest[];
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        this.log.warn('fetchPullRequestByBranch failed', {
          projectPath,
          sourceBranch,
          status: err.status
        });
        return null;
      }
      throw err;
    }
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
      let list: GHPullRequest[];
      try {
        const listRes = await this.octokit.request(
          `GET /repos/${projectPath}/pulls?state=${ghState}&per_page=100&page=${page}`
        );
        list = listRes.data as GHPullRequest[];
      } catch (err) {
        if (err instanceof RequestError && err.response) {
          this.log.warn('fetchPullRequestByBranch failed', {
            projectPath,
            sourceBranch,
            status: err.status
          });
          return null;
        }
        throw err;
      }
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

  /**
   * When `shouldRemoveSourceBranch` is set, the branch deletion happens as a
   * second call after the merge PUT has already succeeded. If that deletion
   * fails, this method rejects even though the merge itself went through.
   * A caller must not read a rejection from this method as "the merge
   * failed"; it can mean "merged, but the source branch is still there."
   */
  async mergePullRequest(
    projectPath: string,
    mrIid: number,
    input?: MergePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    const mergeMethod =
      input?.mergeMethod ?? (input?.squash ? 'squash' : undefined);
    if (mergeMethod) body.merge_method = mergeMethod;
    Object.assign(body, this.mergeCommitFields(input, mergeMethod));
    if (input?.sha != null) body.sha = input.sha;

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
    if (input?.shouldRemoveSourceBranch) {
      // `pr.sourceBranch` is `head.ref`, a branch name with no repository
      // attached. For a same-repo PR that name lives in `projectPath`, but
      // for a fork PR it lives in the fork, and deleting against
      // `projectPath` would either 404 (branch never existed there, so the
      // delete silently does nothing while reporting success) or, worse,
      // delete an unrelated same-named branch in the base repo. The raw PR
      // (not the mapped `PullRequest`, which carries no head-repo field)
      // has to be read to find out which repository actually owns the ref.
      const raw = await this.fetchPR(projectPath, mrIid);
      const headRepo = raw?.head?.repo?.full_name;
      if (!headRepo) {
        throw new Error(
          `mergePullRequest merged but could not delete source branch "${pr.sourceBranch}": ` +
            'the head repository is unknown (fork likely deleted), so deletion cannot be targeted safely.'
        );
      }
      await this.deleteMergedSourceBranch(headRepo, pr.sourceBranch);
    }
    return pr;
  }

  /**
   * Pick the one commit message that applies to this merge.
   *
   * GitHub carries a single commit-message pair per merge: `commit_title` and
   * `commit_message` are the title and body of one commit, not a merge variant
   * and a squash variant. `commitMessage` and `squashCommitMessage` are
   * alternates selected by strategy (types.ts), so sending both would put a
   * squash message in the body of a merge commit. Sending both onto
   * `commit_title` is MAT-25, where the second silently overwrote the first.
   */
  private mergeCommitFields(
    input: MergePullRequestInput | undefined,
    mergeMethod: string | undefined
  ): { commit_title?: string; commit_message?: string } {
    // A squash with no squash-specific message still has the caller's intent in
    // commitMessage, and GitHub produces exactly one commit either way, so
    // falling back preserves it instead of discarding it. The reverse case is
    // symmetric: a caller who supplies only squashCommitMessage and no
    // mergeMethod clearly meant that message to be used, and since GitHub
    // produces one commit regardless of method, dropping it serves nobody.
    // This does not weaken MAT-25: when both messages are supplied, exactly
    // one is still selected.
    const chosen =
      mergeMethod === 'squash'
        ? (input?.squashCommitMessage ?? input?.commitMessage)
        : (input?.commitMessage ?? input?.squashCommitMessage);
    if (chosen == null) return {};

    // Strip leading newlines to avoid empty commit_title in the request body.
    const trimmed = chosen.replace(/^\n+/, '');
    if (trimmed === '') return {};

    const firstBreak = trimmed.indexOf('\n');
    if (firstBreak === -1) return { commit_title: trimmed };
    const rest = trimmed.slice(firstBreak + 1).replace(/^\n+/, '');
    return rest
      ? { commit_title: trimmed.slice(0, firstBreak), commit_message: rest }
      : { commit_title: trimmed.slice(0, firstBreak) };
  }

  /**
   * GitHub's merge endpoint has no delete-branch parameter: it accepts only
   * commit_title, commit_message, sha, and merge_method. The `delete_branch`
   * field this used to send was silently ignored, so callers asking for branch
   * removal never got it (MAT-127). The ref has to be deleted in a second call.
   *
   * A ref that is already gone satisfies what the caller asked for. The
   * repository-level delete_branch_on_merge setting deletes it asynchronously
   * and races this call, so treating "not there" as failure would make every
   * merge on such a repository throw.
   *
   * GitHub's 422 status is ambiguous: it means both "reference does not exist"
   * and (in some cases) "deletion blocked by branch protection". The intent
   * ("ref is gone") is verified by checking whether the ref still exists, not
   * by status code alone. If it is gone, the caller's end state is satisfied.
   *
   * `repoPath` is the repository that owns `branch`, which for a fork PR is
   * the fork, not the base repository the PR was opened against. The caller
   * resolves that from `head.repo.full_name` before calling in.
   */
  private async deleteMergedSourceBranch(
    repoPath: string,
    branch: string
  ): Promise<void> {
    const res = await this.api(
      'DELETE',
      `/repos/${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`
    );
    if (res.ok) return; // Fast path: successful delete.

    // Verify whether the ref still exists. If it is gone, the caller's
    // requested end state is satisfied. If it still exists, throw with the
    // deletion failure details.
    const checkRes = await this.api(
      'GET',
      `/repos/${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`
    );

    // If the ref is gone (404), the end state is satisfied.
    if (!checkRes.ok && checkRes.status === 404) return;

    // Ref still exists (checkRes.ok) or we cannot verify the state
    // (checkRes is an unrelated error). Either way, throw with the deletion
    // failure details.
    const text = await res.text().catch(() => '');
    throw new Error(
      `mergePullRequest merged but could not delete source branch "${branch}": ${res.status} ${text}`
    );
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

  /**
   * Kept as a Response-returning seam while call sites migrate off it.
   *
   * Octokit throws on non-2xx; this converts that back into a Response so the
   * `if (!res.ok)` call sites still work and so `restRequest`, which is public
   * and documented to return a Response, does not start throwing on a 404 that
   * callers branch on.
   */
  private async api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    // Octokit's endpoint parser rewrites `:word` into a route placeholder
    // before the string is ever handed to fetch, and a placeholder with no
    // matching parameter expands to the empty string. Every call site is
    // supposed to hand over an already-built path with the colon encoded,
    // but this is the last line of defense: any literal colon that still
    // reaches this point is escaped so it cannot be misread as a
    // placeholder marker. The negative lookahead excludes a colon followed
    // by a slash, which is a scheme separator (e.g. `https://...`) on an
    // absolute URL, not a placeholder colon (Octokit's own placeholder
    // regex, `/:([a-z]\w+)/g`, never matches a colon before `/` either);
    // escaping it would turn `https://` into `https%3A//`, which still
    // passes Octokit's `/^http/` check so no baseUrl gets prepended, and
    // fetch then throws on the malformed URL. `restRequest` is documented
    // as accepting an absolute URL, and fetchAllPages passes one straight
    // through when following a Link header, so this path is live. Only
    // `path` is escaped, never the "${method} " prefix, since Octokit
    // splits on that leading space to read the verb.
    const safePath = path.replace(/:(?!\/)/g, '%3A');
    try {
      const res = await this.octokit.request(`${method} ${safePath}`, {
        ...(body !== undefined ? { data: body } : {})
      });
      return toResponse(res.status, res.headers, res.data);
    } catch (err) {
      if (err instanceof RequestError) {
        if (!err.response) {
          // No `response` means Octokit's fetch wrapper never got an HTTP
          // result (DNS failure, connection refused, an aborted request):
          // a transport failure, not an HTTP outcome. Fabricating a
          // synthetic 500 Response here would make fetchAllPages's
          // `if (!res.ok) break` read a dropped connection mid-pagination
          // as "no more pages" and silently hand back a truncated list,
          // hiding the failure instead of surfacing it.
          throw err;
        }
        return toResponse(err.status, err.response.headers ?? {}, err.response.data);
      }
      throw err;
    }
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
   * Report a shortfall to the caller and the logger.
   *
   * The logger alone is not enough: it defaults to noop, so a truncated or
   * throttled fetch used to return a short list with nothing to distinguish it
   * from a complete one.
   */
  private warn(
    onWarning: FetchPullRequestsOptions['onWarning'],
    warning: FetchPullRequestsWarning
  ): void {
    this.log.warn(warning.message, { ...warning });
    if (!onWarning) return;
    try {
      onWarning(warning);
    } catch {
      // A broken observer must never fail a fetch.
    }
  }

  /**
   * The PRs a search matched, as `owner/repo` + number. No detail fetch: the
   * caller merges hits across searches first, so a PR several searches matched
   * is fetched once.
   *
   * Filtering on the issue-shaped search result here means a state filter costs
   * nothing extra: PRs we are about to discard never reach the detail path.
   *
   * Walks up to `SEARCH_MAX_PAGES` pages. Stopping there with results
   * outstanding, or a page GitHub rejected, is reported through `onWarning`:
   * this is a bounded scan, not an exhaustive one, and the caller cannot see
   * the difference from the returned list.
   */
  private async searchPRs(
    qualifiers: string,
    keep: (item: GHSearchItem) => boolean,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<SearchHit[]> {
    const q = encodeURIComponent(qualifiers);
    const matched: SearchHit[] = [];

    for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
      let data: { items: GHSearchItem[] };
      try {
        const res = await this.octokit.request(
          `GET /search/issues?q=${q}&per_page=100&sort=updated&page=${page}`
        );
        data = res.data as { items: GHSearchItem[] };
      } catch (err) {
        if (err instanceof RequestError && err.response) {
          this.warn(onWarning, {
            kind: 'request-failed',
            source: 'search',
            status: err.status,
            target: qualifiers,
            message: `GitHub search failed with HTTP ${err.status}; PRs matching "${qualifiers}" are missing from this result.`
          });
          break;
        }
        throw err;
      }

      for (const item of data.items) {
        if (!item.pull_request || !keep(item)) continue;
        matched.push({
          repoPath: item.repository_url.replace(`${this.apiBase}/repos/`, ''),
          number: item.number
        });
      }

      if (data.items.length < 100) break;
      if (page === SEARCH_MAX_PAGES) {
        this.warn(onWarning, {
          kind: 'page-cap',
          source: 'search',
          target: qualifiers,
          message: `GitHub search "${qualifiers}" hit the ${SEARCH_MAX_PAGES}-page cap (${SEARCH_MAX_PAGES * 100} results); later matches are missing from this result.`
        });
      }
    }

    return matched;
  }

  /** Full PRs for `hits`, bounded to `DETAIL_CONCURRENCY` requests in flight.
      Hits GitHub would not return are dropped, having been reported. */
  private async fetchHits(
    hits: SearchHit[],
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<Array<{ hit: SearchHit; pr: GHPullRequest }>> {
    const fetched = await mapPool(hits, DETAIL_CONCURRENCY, async hit => ({
      hit,
      pr: await this.fetchPR(hit.repoPath, hit.number, onWarning)
    }));
    return fetched.filter(
      (entry): entry is { hit: SearchHit; pr: GHPullRequest } => entry.pr !== null
    );
  }

  /**
   * GET a single PR, or null.
   *
   * Null means two different things, and the difference matters to a caller
   * assembling a list: a 404 is a PR that is not there (deleted, or invisible
   * to this token), while any other failure is a PR that exists and is missing
   * from the result. Only the second is reported through `onWarning` -- which
   * is how a rate-limited fetch stops looking like a short one.
   */
  private async fetchPR(
    projectPath: string,
    prNumber: number,
    onWarning?: FetchPullRequestsOptions['onWarning']
  ): Promise<GHPullRequest | null> {
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/pulls/${prNumber}`
      );
      return res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        if (err.status === 404) return null;
        this.warn(onWarning, {
          kind: 'request-failed',
          source: 'detail',
          status: err.status,
          target: `${projectPath}#${prNumber}`,
          message: `GitHub returned HTTP ${err.status} for ${projectPath}#${prNumber}; it is missing from this result.`
        });
        return null;
      }
      throw err;
    }
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
    keep: (pr: GHPullRequest) => boolean,
    onWarning: FetchPullRequestsOptions['onWarning']
  ): Promise<GHPullRequest[]> {
    const state = listStateParam(wanted);
    const collected: GHPullRequest[] = [];

    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      let listed: GHPullRequest[];
      try {
        const res = await this.octokit.request(
          `GET /repos/${projectPath}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`
        );
        listed = res.data as GHPullRequest[];
      } catch (err) {
        throw ghError('fetchPullRequests', err);
      }
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
        this.warn(onWarning, {
          kind: 'page-cap',
          source: 'list',
          target: projectPath,
          message: `Listing ${projectPath} hit the ${LIST_MAX_PAGES}-page cap (${LIST_MAX_PAGES * 100} PRs); older PRs are missing from this result.`
        });
      }
    }

    return collected;
  }

  /**
   * The authenticated user, fetched once per provider instance.
   * Null when the lookup fails, so callers degrade to unknown roles rather than
   * failing the whole fetch.
   */
  private async currentUser(): Promise<GHUser | null> {
    this.currentUserPromise ??= (async () => {
      const res = await this.octokit.request('GET /user');
      return res.data as GHUser;
    })()
      .catch(() => null)
      .then(user => {
        // Concurrent callers share the in-flight request, but a failure is not
        // cached: the next fetch asks again rather than degrading for the
        // lifetime of the provider.
        if (!user) this.currentUserPromise = null;
        return user;
      });
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
   *
   * The per-PR leg runs through the same bounded pool as the detail fetches;
   * a dashboard-sized result set otherwise opens two sockets per PR at once.
   */
  private async enrich(
    candidates: PRWithRoles[],
    listWeight: boolean
  ): Promise<PullRequest[]> {
    const threadCounts = await this.fetchUnresolvedThreadCounts(
      candidates.map(c => c.pr)
    );
    return mapPool(
      candidates,
      DETAIL_CONCURRENCY,
      async ({ pr, roles }) => {
        const reviews = await this.fetchReviews(
          pr.base.repo.full_name,
          pr.number
        );
        const checkRuns = listWeight
          ? []
          : await this.fetchCheckRuns(pr.base.repo.full_name, pr.head.sha);
        return this.toPullRequest(
          pr,
          roles,
          reviews,
          checkRuns,
          threadCounts.get(pr.node_id) ?? null
        );
      }
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
      const res = await this.octokit.request(
        `GET /repos/${repoPath}/commits/${sha}/check-runs?per_page=100`
      );
      const data = res.data as GHCheckSuite;
      return data.check_runs;
    } catch {
      // Every failure here (404, rate limit, transport) degrades to "no
      // check runs reported" rather than failing the PR it belongs to --
      // this is existing behavior, not new: the old code returned `[]` for
      // any non-ok status and any thrown error alike.
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
      isStacked:
        !!pr.base.repo.default_branch &&
        pr.base.ref !== pr.base.repo.default_branch,
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

// Statuses the HTTP spec defines as never carrying a body. Octokit's fetch
// wrapper still returns `data: ""` for these, and `new Response("", {
// status: 204 })` is valid under Bun but throws a TypeError under Node,
// which is what this package publishes for (`engines.node >= 18`,
// `--target node`). A test suite that only runs on Bun cannot see this
// divergence, so the null-body statuses are forced to a null body here
// regardless of what Octokit handed back.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Rebuild a Response from an Octokit result so the pre-Octokit call sites,
 * and the public restRequest contract, keep seeing what they always saw.
 */
function toResponse(
  status: number,
  headers: Record<string, unknown>,
  data: unknown
): Response {
  const body =
    NULL_BODY_STATUSES.has(status) || data === undefined || data === null
      ? null
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);
  const init: ResponseInit = { status, statusText: reasonPhrase(status), headers: {} };
  const link = headers.link;
  if (typeof link === 'string') init.headers = { Link: link };
  return new Response(body, init);
}
