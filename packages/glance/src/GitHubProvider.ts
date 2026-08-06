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
  InvalidationBatch,
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
  UserRef,
  WatchEventsOptions
} from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';
import {
  GitHubEventsPoller,
  type FetchGitHubEventsPage,
  type GitHubEvent
} from './GitHubEventsPoller.ts';
import { startWatcherLoop, type LoopTick } from './EventsWatcher.ts';
import {
  bodyText,
  createGitHubClient,
  ghError,
  reasonPhrase,
  resolveGitHubUrls,
  type GlanceOctokit
} from './githubClient.ts';
import type { OnRequestHook } from './instrumentation.ts';
// This package depends on @octokit/request-error directly so `err instanceof
// RequestError` below can narrow errors thrown by @octokit/core's OWN copy of
// this class. That only works while npm/bun dedupe the two into one module
// instance, which only holds while this package's version range for
// @octokit/request-error overlaps the range @octokit/core depends on. If the
// ranges ever diverge, two separate RequestError classes end up installed,
// every migrated `instanceof RequestError` check here goes false, and each
// catch rethrows the raw error instead of translating it. Keep this range
// tracking @octokit/core's own dependency on @octokit/request-error.
import { RequestError } from '@octokit/request-error';
// Same coupling as RequestError above, for @octokit/core's copy of
// @octokit/graphql: `err instanceof GraphqlResponseError` in `graphql()`'s
// catch only works while the two copies dedupe to one module instance, which
// requires this package's @octokit/graphql range to track @octokit/core's.
import { GraphqlResponseError } from '@octokit/graphql';

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

/** One review thread, joined to REST review comments by its root comment. */
interface GHReviewThread {
  nodeId: string;
  isResolved: boolean;
  rootCommentId: number;
}

/** `repository.pullRequest.reviewThreads` projection, one PR at a time. */
interface GHPullRequestThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          isResolved: boolean;
          comments?: { nodes: Array<{ databaseId: number | null }> };
        } | null>;
      };
    } | null;
  } | null;
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

/**
 * GraphQL page size for review threads. `fetchUnresolvedThreadCounts` reads
 * a single page per PR and reports the count as unknown beyond it;
 * `fetchReviewThreadIndex` instead walks further pages up to
 * `THREAD_MAX_PAGES`.
 */
const THREAD_PAGE_SIZE = 100;

/**
 * Thread pages to walk for one PR before giving up. At THREAD_PAGE_SIZE per
 * page this is 1000 threads, far past any real review. The bound exists so a
 * pathological PR cannot spin this loop, not because 1000 is a meaningful
 * limit.
 */
const THREAD_MAX_PAGES = 10;

/**
 * GitHub requires a reason on every review dismissal and posts it to the pull
 * request timeline. GitLab's unapprove takes no message, so
 * `unapprovePullRequest` has none to pass along and sends this instead of
 * inventing a reason that would read as if a person wrote it.
 */
const DISMISSAL_MESSAGE = 'Approval withdrawn via the Glance SDK.';

/**
 * Default `watchEvents` cadence: 60s, four times GitLab's 15s.
 *
 * Not a tuning preference. GitHub asks for exactly this on every 200 from
 * the events feed (`X-Poll-Interval: 60`), and polling a repo feed faster
 * than the server asked is how a token earns a secondary rate limit. A
 * caller that passes `intervalMs` is still honored; the server's own number
 * only ever raises the wait, never lowers it (see `watchEvents`).
 */
const WATCH_EVENTS_INTERVAL_MS = 60_000;

/** The events feed's page size cap, and the only value this provider sends. */
const EVENTS_PER_PAGE = 100;

/**
 * The events feed serves at most 3 pages (300 events) to a poller; page 4 is
 * empty no matter what. `GitHubEventsPoller` already clamps to this, so the
 * fetch below throwing past it is defense, not the enforcement.
 */
const EVENTS_MAX_PAGE = 3;

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
    canUnapprove: true,
    canRebase: false,
    canAutoMerge: true,
    canResolveDiscussions: true,
    canRetryPipeline: true,
    canRequestReReview: true,
    /**
     * True, with two limits a caller has to design around.
     *
     * no CI events: the polled feed has no workflow/check event type at all,
     * so a `pipelines` invalidation never fires here. keep a full poll for
     * pipeline status; the watcher is an accelerator, not a replacement.
     *
     * hours-scale retention: the feed holds roughly six hours. a watcher
     * down longer than that comes back to a cursor that proves nothing about
     * what it missed, because the missed history is already gone from the
     * feed. resume is a fast path, not a guarantee; full sync is the only
     * recovery.
     */
    canWatchEvents: true
  };

  // ── GitProvider interface ─────────────────────────────────────────────────

  async validateToken(): Promise<UserRef> {
    let user: GHUser;
    try {
      const res = await this.octokit.request('GET /user');
      user = res.data as GHUser;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // Built directly, not through `ghError`, because this message's shape
        // predates that helper and the live harness pattern-matches on it:
        // `${op} failed: ${status} ${statusText}`, no body. `ghError`'s
        // 'statusText' style appends the body after an em dash, which is a
        // different, newer shape this call site never used.
        throw new Error(
          `GitHub token validation failed: ${err.status} ${reasonPhrase(err.status)}`
        );
      }
      // No `.response` means this never reached an HTTP outcome (DNS
      // failure, connection refused): a transport failure, not something
      // `validateToken` has ever translated. Rethrow the original
      // `RequestError` (or whatever else was thrown) so callers keep
      // `.status`/`.request`, same as every other migrated method here.
      throw err;
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
    const { owner, repo: repoName } = this.splitOwnerRepo(repo.full_name);

    // Fetch review comments (diff-level) and issue comments (PR-level).
    // `paginate` needs the route template plus real route params (rather
    // than one path string) so it can follow the `Link` header itself.
    const [reviewComments, issueComments] = await Promise.all([
      this.octokit.paginate<GHComment>(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
        { owner, repo: repoName, pull_number: mrIid, per_page: 100 }
      ),
      this.octokit.paginate<GHComment>(
        'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
        { owner, repo: repoName, issue_number: mrIid, per_page: 100 }
      )
    ]);

    // Resolution state lives only in GraphQL. A failure here degrades the
    // answer to the pre-MAT-27 "unknown" rather than failing the call: the
    // notes themselves came from REST and were returned long before resolved
    // state was available.
    let threads: Map<number, GHReviewThread> = new Map();
    try {
      threads = await this.fetchReviewThreadIndex(
        'fetchMRDiscussions',
        owner,
        repoName,
        mrIid
      );
    } catch (err) {
      this.log.warn('fetchMRDiscussions: could not read review thread state', {
        message: err instanceof Error ? err.message : String(err),
        projectPath: `${owner}/${repoName}`,
        mrIid
      });
    }

    const discussions: Discussion[] = [];

    // PR-level comments have no thread and no resolved state on GitHub, so
    // null is the correct answer here rather than a gap.
    for (const c of issueComments) {
      discussions.push({
        id: `gh-issue-comment-${c.id}`,
        resolvable: null,
        resolved: null,
        notes: [toNote(c)]
      });
    }

    // Group review comments into threads by their reply root. GitHub does not
    // return a thread id on REST review comments, so the root comment stands
    // in for one: every reply carries `in_reply_to_id` pointing at it, and
    // GraphQL reports that same comment as the thread's first comment, which
    // is what lets `fetchReviewThreadIndex` join the two.
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
      // No match means the GraphQL read failed or the thread arrived after
      // it. `resolvable: true` with `resolved: null` is exactly what this
      // method reported before MAT-27, so an unmatched thread degrades to the
      // old answer instead of to a wrong one.
      //
      // A matched thread also reports `resolvable: true`, unconditionally.
      // GitHub has no per-thread resolvability flag: every review thread can
      // be resolved, so there is nothing else to encode. `viewerCanResolve`
      // exists on the schema but answers a different question, whether the
      // calling user has permission, not whether the thread itself is
      // resolvable, so mapping it onto this field would trade one wrong
      // answer for another.
      const thread = threads.get(rootId);
      discussions.push({
        id: `gh-review-thread-${rootId}`,
        resolvable: true,
        resolved: thread ? thread.isResolved : null,
        notes: comments.map(c => toNote(c, thread ? thread.isResolved : null))
      });
    }

    return { mrIid, repositoryId, discussions };
  }

  async fetchBranchProtectionRules(
    projectPath: string
  ): Promise<BranchProtectionRule[]> {
    let branches: Array<{
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
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/branches?protected=true&per_page=100`
      );
      branches = res.data as typeof branches;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('fetchBranchProtectionRules', err);
      }
      throw err;
    }

    const rules: BranchProtectionRule[] = [];
    for (const b of branches) {
      if (!b.protected) continue;
      // Fetch detailed protection for each protected branch
      let detail: {
        allow_force_pushes?: { enabled: boolean };
        allow_deletions?: { enabled: boolean };
        required_pull_request_reviews?: {
          required_approving_review_count?: number;
        } | null;
        required_status_checks?: { strict: boolean; contexts: string[] } | null;
      };
      try {
        const detailRes = await this.octokit.request(
          `GET /repos/${projectPath}/branches/${encodeURIComponent(b.name)}/protection`
        );
        detail = detailRes.data as typeof detail;
      } catch (err) {
        if (!(err instanceof RequestError && err.response)) throw err;
        // The invented rule this replaces was wrong in both directions at once:
        // it claimed force-push and deletion were forbidden while also claiming
        // no approvals and no status checks were required, and a caller had no
        // way to tell those four values from real ones (MAT-131). On a private
        // repository on the free plan this is a 403, which the message surfaces.
        // Not `ghError`-shaped: the prefix here is "reading protection for
        // ...", not "op failed:", so the body is read with `bodyText` directly.
        throw new Error(
          `fetchBranchProtectionRules failed reading protection for "${b.name}": ${err.status} ${bodyText(err)}`
        );
      }
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
    try {
      await this.octokit.request(
        `DELETE /repos/${projectPath}/git/refs/heads/${encodeURIComponent(branch)}`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The existing message is the plain shape (status plus body, no
        // statusText): `ghError`'s default style reproduces it exactly.
        throw ghError('deleteBranch', err);
      }
      throw err;
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

  /**
   * Every route built in this method and in `updatePullRequest` below
   * interpolates only `projectPath`/`input.projectPath` (an `owner/repo`
   * string, and GitHub forbids a colon in either half of that) and a
   * numeric PR number, never a value with a colon in it. Unlike
   * `fetchPullRequestByBranch`'s `owner:branch` value, there is nothing
   * here for Octokit's endpoint parser to rewrite into an empty route
   * placeholder, so none of these routes carry the defensive `%3A` escape
   * `api()` applies as a last line of defense. If a future change threads
   * a caller-supplied string (a title, a branch name) into one of these
   * routes rather than the request body, that guard needs to come back.
   */
  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      head: input.sourceBranch,
      base: input.targetBranch,
      title: input.title
    };
    if (input.description != null) body.body = input.description;
    if (input.draft != null) body.draft = input.draft;

    let created: GHPullRequest;
    try {
      const res = await this.octokit.request(
        `POST /repos/${input.projectPath}/pulls`,
        { data: body }
      );
      created = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('createPullRequest', err);
      }
      throw err;
    }

    // GitHub doesn't support reviewers/assignees/labels on create -- add them
    // separately. The PR above already exists by this point: a failure here
    // is not "no PR was created," it is "PR #<n> exists without this one
    // field applied." The op label below names both the sub-operation and
    // the PR number so a caller (or a human reading the thrown message) can
    // tell the two apart and find the PR that already exists, instead of
    // retrying and hitting GitHub's own "a pull request already exists" 422.
    if (input.reviewers?.length) {
      await this.fireAndThrow(
        `createPullRequest reviewers for #${created.number}`,
        `POST /repos/${input.projectPath}/pulls/${created.number}/requested_reviewers`,
        { reviewers: input.reviewers }
      );
    }
    if (input.assignees?.length) {
      await this.fireAndThrow(
        `createPullRequest assignees for #${created.number}`,
        `POST /repos/${input.projectPath}/issues/${created.number}/assignees`,
        { assignees: input.assignees }
      );
    }
    if (input.labels?.length) {
      await this.fireAndThrow(
        `createPullRequest labels for #${created.number}`,
        `POST /repos/${input.projectPath}/issues/${created.number}/labels`,
        { labels: input.labels }
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

    let patched: GHPullRequest;
    try {
      const res = await this.octokit.request(
        `PATCH /repos/${projectPath}/pulls/${mrIid}`,
        { data: body }
      );
      patched = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('updatePullRequest', err);
      }
      throw err;
    }

    if (input.draft != null) {
      if (patched.draft !== input.draft) {
        await this.setDraft(patched.node_id, input.draft);
      }
    }

    // Handle reviewers/assignees/labels replacement if provided. Octokit
    // throws on a non-2xx here, where the old fetch-based code never checked
    // `res.ok` and silently swallowed a failure on all three. Surfacing that
    // failure is a deliberate behavior change (MAT-24 owns these fields). By
    // this point the PATCH above and any draft toggle have already landed,
    // so the op label below names the sub-operation and the PR number,
    // matching createPullRequest's treatment: a caller reading the thrown
    // message can tell "the title/base/draft update landed but reviewers
    // did not" from "nothing happened."
    if (input.reviewers) {
      await this.fireAndThrow(
        `updatePullRequest reviewers for #${mrIid}`,
        `POST /repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        { reviewers: input.reviewers }
      );
    }
    if (input.assignees) {
      await this.fireAndThrow(
        `updatePullRequest assignees for #${mrIid}`,
        `POST /repos/${projectPath}/issues/${mrIid}/assignees`,
        { assignees: input.assignees }
      );
    }
    if (input.labels) {
      await this.fireAndThrow(
        `updatePullRequest labels for #${mrIid}`,
        `PUT /repos/${projectPath}/issues/${mrIid}/labels`,
        { labels: input.labels }
      );
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
   * Poll the repository events feed and translate activity into invalidation
   * hints. Same contract as GitLab's `watchEvents`; the feed underneath is
   * different in ways a caller feels:
   *
   * - Cadence defaults to 60s, not GitLab's 15s, because that is what the
   *   server asks for (`WATCH_EVENTS_INTERVAL_MS`). A 200 carrying a larger
   *   `X-Poll-Interval` raises the next wait; it never lowers it below what
   *   the caller configured.
   * - No `pipelines` invalidation is ever delivered. The feed has no CI event
   *   type, so a caller that needs pipeline status keeps its full poll.
   * - The first tick on a cold start delivers nothing: it snapshots page 1 to
   *   seed the cursor, since the feed has no time filter to bound a lookback
   *   with. Full-refresh on boot, as on GitLab.
   * - `options.perPage` is ignored: the feed is always requested at its cap
   *   of 100 per page, which is what makes the 3-page ceiling worth 300
   *   events.
   *
   * @returns dispose. Call to stop the loop.
   */
  watchEvents(
    projectPath: string,
    options: WatchEventsOptions,
    onInvalidations: (batch: InvalidationBatch) => void
  ): () => void {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const poller = new GitHubEventsPoller({
      fetchPage: (opts) => this.fetchEventsPage(owner, repo, opts),
      cursor: options.cursor,
      maxPagesPerTick: options.maxPagesPerTick
    });
    const intervalMs = options.intervalMs ?? WATCH_EVENTS_INTERVAL_MS;

    return startWatcherLoop(
      async (): Promise<LoopTick> => {
        const result = await poller.tick();
        // One timestamp per tick, not one per field: the batch's `syncedAt`
        // and the loop's own notion of when this tick landed must not be two
        // clock reads that can disagree.
        const syncedAt = new Date().toISOString();
        // The poller already returns [] on a cold start, so an empty list is
        // the only "nothing to say" signal this needs.
        const batch: InvalidationBatch | null =
          result.invalidations.length > 0
            ? { invalidations: result.invalidations, syncedAt, cursor: result.cursor }
            : null;
        // Server-directed cadence, one way only: honor a slower request,
        // ignore one that would poll faster than the caller asked for.
        const serverMs = result.serverPollIntervalMs;
        const nextIntervalMs =
          serverMs != null && serverMs > intervalMs ? serverMs : undefined;
        return { batch, cursor: result.cursor, nextIntervalMs };
      },
      { ...options, intervalMs },
      onInvalidations,
      this.log
    );
  }

  /**
   * One conditional GET of the events feed.
   *
   * Octokit does not return a 304 -- it throws a `RequestError` with
   * `status: 304`, since there is no body to hand back. Translating that
   * here is what keeps a "nothing changed" tick from reaching the watcher
   * loop as a failure and tripping its backoff, which would turn the
   * steady-state response into an outage.
   *
   * `If-None-Match` goes out on page 1 only (the etag describes the head of
   * the feed), and no `since`/`after` is ever sent: the feed has no such
   * parameter, and inventing one would silently filter nothing.
   */
  private async fetchEventsPage(
    owner: string,
    repo: string,
    opts: { page: number; etag: string | null }
  ): Promise<Awaited<ReturnType<FetchGitHubEventsPage>>> {
    if (opts.page > EVENTS_MAX_PAGE) {
      throw new Error(
        `fetchEventsPage: the events feed serves at most ${EVENTS_MAX_PAGE} pages, got page ${opts.page}`
      );
    }
    const headers: Record<string, string> = {};
    if (opts.page === 1 && opts.etag) headers['if-none-match'] = opts.etag;

    let res: { headers: Record<string, unknown>; data: unknown };
    try {
      res = await this.octokit.request('GET /repos/{owner}/{repo}/events', {
        owner,
        repo,
        per_page: EVENTS_PER_PAGE,
        page: opts.page,
        headers
      });
    } catch (err) {
      // Duck-typed on purpose, unlike every other catch in this file, which
      // narrows with `instanceof RequestError`. A 304 is what a healthy
      // watcher gets on nearly every tick, so if the two RequestError copies
      // ever stop deduping (see this file's import comment), an `instanceof`
      // here would silently reclassify the steady state as a failure and
      // leave the loop permanently backing off. Only `.status` is needed,
      // and reading it cannot go false.
      if ((err as { status?: unknown } | null)?.status === 304) {
        return { status: 304, events: [], etag: null, pollIntervalSec: null };
      }
      throw err;
    }

    const etag = res.headers.etag;
    const pollInterval = Number(res.headers['x-poll-interval']);
    return {
      status: 200,
      events: (res.data ?? []) as GitHubEvent[],
      etag: typeof etag === 'string' ? etag : null,
      // A missing header parses to NaN, a blank one to 0; neither is a
      // cadence, and both must read as "the server said nothing".
      pollIntervalSec: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : null
    };
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

    try {
      await this.octokit.request(
        `PUT /repos/${projectPath}/pulls/${mrIid}/merge`,
        { data: body }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The live conformance harness (conformance.ts:838) matches
        // /\bmergePullRequest failed: 405\b/ on this exact message. Do not
        // reword it.
        throw ghError('mergePullRequest', err);
      }
      throw err;
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
    try {
      await this.octokit.request(
        `DELETE /repos/${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`
      );
      return; // Fast path: successful delete.
    } catch (deleteErr) {
      if (!(deleteErr instanceof RequestError && deleteErr.response)) {
        throw deleteErr;
      }

      // Verify whether the ref still exists. If it is gone, the caller's
      // requested end state is satisfied. If it still exists, throw with the
      // deletion failure details below. GitHub reuses 422 for both
      // "reference does not exist" and a protection-refused delete, so the
      // status code alone cannot distinguish them.
      try {
        await this.octokit.request(
          `GET /repos/${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`
        );
        // No throw means the ref still exists: fall through to the throw below.
      } catch (checkErr) {
        if (
          checkErr instanceof RequestError &&
          checkErr.response &&
          checkErr.status === 404
        ) {
          return; // Confirmed gone: the requested end state is satisfied.
        }
        // Cannot verify the end state: either a non-404 HTTP response (ref
        // still there, or an unrelated error on the check) or a transport
        // failure on the check itself (no `.response`, e.g. a dropped
        // connection). Both fall through to the deletion-failure throw
        // below, deliberately, including the transport case. The merge
        // above already succeeded; an unverifiable branch deletion is a
        // deletion failure, not a merge failure, so it must not propagate
        // as a raw thrown error the way a merge-PUT transport failure does.
        // This is a deliberate behavior change from the pre-Octokit code,
        // which rethrew a response-less fetch failure on the verification
        // GET untouched, letting it escape mergePullRequest as a hard
        // failure instead of reaching this message.
      }

      throw new Error(
        `mergePullRequest merged but could not delete source branch "${branch}": ${deleteErr.status} ${bodyText(deleteErr)}`
      );
    }
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/pulls/${mrIid}/reviews`,
        { data: { event: 'APPROVE' } }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // The live conformance harness matches /approvePullRequest failed:
        // 422\b/ on this message. When a second identity is configured that
        // identity approves for real and this message is never produced;
        // this 422 is only the fallback proof of request shape and auth
        // for a single-identity run, where self-approval is the only call
        // available to make.
        throw ghError('approvePullRequest', err, 'statusText');
      }
      throw err;
    }
  }

  /**
   * Withdraw the token user's approval by dismissing their review.
   *
   * Not identical to GitLab's unapprove, and the difference is caller-visible:
   * GitLab removes the approval record, GitHub leaves a `DISMISSED` review in
   * the list.
   *
   * Only `APPROVE` and `REQUEST_CHANGES` reviews change a reviewer's state on
   * GitHub; a `COMMENT` review does not. The review that currently carries
   * the approval is therefore the newest APPROVED-or-CHANGES_REQUESTED
   * review, not simply the newest review of any kind -- a comment left after
   * approving must not be mistaken for a state change and must not shadow
   * the approval that is still in effect.
   *
   * Throws when there is nothing to dismiss. Resolving would be the silent
   * no-op shape: the caller would believe an approval was revoked when none
   * existed. GitLab's own unapprove answers a non-approved MR with a 404,
   * which its SDK also turns into a throw.
   */
  async unapprovePullRequest(
    projectPath: string,
    mrIid: number
  ): Promise<void> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const me = (await this.validateToken()).username;

    let reviews: GHReview[];
    try {
      reviews = await this.octokit.paginate<GHReview>(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        { owner, repo, pull_number: mrIid, per_page: 100 }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }

    // Only APPROVE and REQUEST_CHANGES reviews change a reviewer's state on
    // GitHub, so a later COMMENT review must not be picked over a still-
    // current approval. Filtering to state-bearing reviews before taking
    // the newest is what makes that true; sorting rather than trusting list
    // order for the same reason `toPullRequest` does.
    const mine = reviews
      .filter(
        r =>
          r.user?.login === me &&
          (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
      )
      .sort(
        (a, b) =>
          new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
      );
    const latest = mine[mine.length - 1];

    if (!latest || latest.state !== 'APPROVED') {
      throw new Error(
        `unapprovePullRequest failed: ${me} has no current approval on ${projectPath}!${mrIid} to dismiss`
      );
    }

    try {
      await this.octokit.request(
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals',
        {
          owner,
          repo,
          pull_number: mrIid,
          review_id: latest.id,
          message: DISMISSAL_MESSAGE,
          event: 'DISMISS'
        }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('unapprovePullRequest', err, 'statusText');
      }
      throw err;
    }
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

  /**
   * The GraphQL node id for a pull request the caller named by number.
   *
   * Both auto-merge mutations address a PR by node id and `GitProvider` only
   * hands this provider `projectPath` and `mrIid`, so every call pays one
   * REST read for the translation.
   */
  private async pullRequestNodeId(
    op: string,
    projectPath: string,
    mrIid: number
  ): Promise<string> {
    const { owner, repo } = this.splitOwnerRepo(projectPath);
    let pr: GHPullRequest;
    try {
      const res = await this.octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner, repo, pull_number: mrIid }
      );
      pr = res.data as GHPullRequest;
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      }
      throw err;
    }
    if (!pr.node_id) {
      throw new Error(`${op} failed: ${projectPath}!${mrIid} carries no GraphQL node id`);
    }
    return pr.node_id;
  }

  /**
   * Merge this pull request once its required checks pass.
   *
   * REST has no auto-merge endpoint, so this is GraphQL only. Two repository
   * preconditions are GitHub's, not this SDK's: `allow_auto_merge` must be on,
   * and GitHub refuses `enablePullRequestAutoMerge` at both ends of the
   * mergeability range -- "clean" (nothing left to wait for) and "unstable"
   * (won't queue behind failing/pending checks) -- so the round trip is only
   * provable when a run happens to land the pull request inside the armable
   * window between them. In a repository with no required status checks, a
   * pull request with checks still pending is "unstable", which is the
   * primary use case a consumer who just read `canAutoMerge: true` hits.
   */
  async setAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('setAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceEnableAutoMerge($id: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      enablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('setAutoMerge', mutation, { id: nodeId });

    // Reading the end state back, not just the absence of an error: an
    // accepted mutation that enabled nothing is indistinguishable from a
    // successful one at the call site otherwise.
    if (!data.enablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `setAutoMerge failed: GitHub accepted the mutation but reported no auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }

  /**
   * Disarm a previously-armed auto-merge on this pull request.
   *
   * Same `allow_auto_merge` repository precondition as `setAutoMerge`: GitHub
   * has nothing to disable if that setting was never on for this repository.
   */
  async cancelAutoMerge(projectPath: string, mrIid: number): Promise<void> {
    const nodeId = await this.pullRequestNodeId('cancelAutoMerge', projectPath, mrIid);
    const mutation = `
      mutation GlanceDisableAutoMerge($id: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const data = await this.graphqlOrThrow<{
      disablePullRequestAutoMerge?: {
        pullRequest?: { autoMergeRequest?: { enabledAt?: string | null } | null } | null;
      };
    }>('cancelAutoMerge', mutation, { id: nodeId });

    if (data.disablePullRequestAutoMerge?.pullRequest?.autoMergeRequest?.enabledAt) {
      throw new Error(
        `cancelAutoMerge failed: GitHub accepted the mutation but still reports auto-merge on ${projectPath}!${mrIid}`
      );
    }
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('resolveDiscussion', projectPath, mrIid, discussionId, true);
  }

  async unresolveDiscussion(
    projectPath: string,
    mrIid: number,
    discussionId: string
  ): Promise<void> {
    await this.setThreadResolved('unresolveDiscussion', projectPath, mrIid, discussionId, false);
  }

  /**
   * Move one review thread between resolved and unresolved.
   *
   * `discussionId` is the `gh-review-thread-<rootCommentId>` form
   * `fetchMRDiscussions` emits, not a GraphQL node id. Keeping it that way is
   * deliberate: the id is a value consumers may have persisted, and changing
   * what it means would be a breaking change on a package with unbumped
   * consumer-visible changes already shipped. The cost is this lookup.
   */
  private async setThreadResolved(
    op: string,
    projectPath: string,
    mrIid: number,
    discussionId: string,
    resolved: boolean
  ): Promise<void> {
    const rootCommentId = parseReviewThreadDiscussionId(discussionId);
    if (rootCommentId == null) {
      throw new Error(
        `${op} failed: "${discussionId}" is not a resolvable review thread. ` +
          'Only ids of the form gh-review-thread-<id> can be resolved; ' +
          'GitHub pull request level comments have no thread.'
      );
    }

    const { owner, repo } = this.splitOwnerRepo(projectPath);
    const threads = await this.fetchReviewThreadIndex(op, owner, repo, mrIid);
    const thread = threads.get(rootCommentId);
    if (!thread) {
      throw new Error(
        `${op} failed: no review thread rooted at comment ${rootCommentId} on ${projectPath}!${mrIid}`
      );
    }

    const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
    const mutation = `
      mutation GlanceSetThreadResolved($threadId: ID!) {
        ${field}(input: { threadId: $threadId }) {
          thread { id isResolved }
        }
      }
    `;

    const data = await this.graphqlOrThrow<
      Record<string, { thread?: { id: string; isResolved: boolean } } | undefined>
    >(op, mutation, { threadId: thread.nodeId });

    // GitHub accepting the mutation is not the same as GitHub applying it.
    // Reporting success on a thread that never changed is the MAT-15 shape.
    const isResolved = data[field]?.thread?.isResolved;
    if (isResolved !== resolved) {
      throw new Error(
        `${op} failed: thread ${thread.nodeId} did not become ${resolved ? 'resolved' : 'unresolved'} ` +
          `(GitHub reported isResolved=${String(isResolved)})`
      );
    }
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    // GitHub Actions: re-run a workflow run.
    // pipelineId maps to the workflow run ID.
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/actions/runs/${pipelineId}/rerun`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('retryPipeline', err, 'statusText');
      }
      throw err;
    }
  }

  async retryJob(projectPath: string, jobId: number): Promise<void> {
    // GitHub Actions: re-run a single job within a workflow run.
    // jobId maps to the job ID. Requires the workflow run ID which we don't have here.
    // Use POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun
    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/actions/jobs/${jobId}/rerun`
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        // This message is quoted verbatim, 403 case included, as evidence in
        // two committed specs documents; ghError's statusText style reproduces
        // its exact shape.
        throw ghError('retryJob', err, 'statusText');
      }
      throw err;
    }
  }

  async fetchJobTrace(projectPath: string, jobId: number): Promise<string> {
    // GitHub Actions: download job logs
    // GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
    // The endpoint answers a redirect to a signed blob-storage URL; Octokit's
    // fetch wrapper follows it and then parses the final body by the content
    // type the blob store answers with, not by this route. A text/* (or
    // missing) content type is the branch the hand-rolled `res.text()` this
    // replaces was equivalent to, but that prior behavior was content-type
    // agnostic and never exercised Octokit's own parsing, so which of these
    // three branches actually fires is unverified until the next live run.
    // Handle all three explicitly so this method's Promise<string> contract
    // holds regardless: text/* comes back as a string already; anything else
    // recognized as text-like falls through to an ArrayBuffer; anything
    // Octokit parses as JSON (e.g. an `application/json` content type,
    // plausible behind a GHES proxy) arrives as an object.
    try {
      const res = await this.octokit.request(
        `GET /repos/${projectPath}/actions/jobs/${jobId}/logs`
      );
      return typeof res.data === 'string'
        ? res.data
        : res.data instanceof ArrayBuffer
          ? Buffer.from(res.data).toString('utf-8')
          : JSON.stringify(res.data);
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('fetchJobTrace', err, 'statusText');
      }
      throw err;
    }
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
    // With no usernames given, fall back to the PR's current reviewer list.
    if (!reviewerUsernames?.length) {
      // Fetch current reviewers from the PR
      let pr: GHPullRequest;
      try {
        const res = await this.octokit.request(
          `GET /repos/${projectPath}/pulls/${mrIid}`
        );
        pr = res.data as GHPullRequest;
      } catch (err) {
        if (err instanceof RequestError && err.response) {
          throw new Error(`requestReReview: failed to fetch PR: ${err.status}`);
        }
        throw err;
      }
      reviewerUsernames = pr.requested_reviewers.map(r => r.login);
      if (!reviewerUsernames.length) {
        // Matches GitLabProvider.requestReReview: resolving here would be
        // the exact silent-success shape this method must not have. The
        // caller asked to re-ping reviewers and there is no one to ping.
        throw new Error(
          'requestReReview: nothing to re-request -- no reviewerUsernames given and the PR has no existing reviewers'
        );
      }
    }

    try {
      await this.octokit.request(
        `POST /repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        { data: { reviewers: reviewerUsernames } }
      );
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError('requestReReview', err, 'statusText');
      }
      throw err;
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
    // as accepting an absolute URL, so this path is live. Only `path` is
    // escaped, never the "${method} " prefix, since Octokit splits on that
    // leading space to read the verb.
    const safePath = path.replace(/:(?!\/)/g, '%3A');
    // The pre-Octokit `fetch` threw `TypeError: Request with GET/HEAD method
    // cannot have body` here, a loud failure. Octokit has no such guard: for
    // GET/HEAD it routes `data` into the query string instead
    // (`?data=%5Bobject%20Object%5D` for an object body), turning a caller
    // mistake into a silently wrong request rather than a thrown error. This
    // restores the old loudness instead of letting that corruption through.
    if (body !== undefined) {
      const upperMethod = method.toUpperCase();
      if (upperMethod === 'GET' || upperMethod === 'HEAD') {
        throw new Error(
          `restRequest: ${method} cannot have a body (GitHub/Octokit routes it into the query string instead)`
        );
      }
    }
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
          // synthetic 500 Response here would let a caller's `if (!res.ok)`
          // read a dropped connection as an ordinary HTTP failure, hiding
          // the transport failure instead of surfacing it.
          throw err;
        }
        return toResponse(err.status, err.response.headers ?? {}, err.response.data);
      }
      throw err;
    }
  }

  /**
   * Fire a write whose caller does not read the response body, translating a
   * thrown HTTP failure into `ghError`'s shape. A transport failure (no
   * `.response`) is rethrown untouched, same as every other migrated call
   * site: it never reached an HTTP outcome, so laundering it through
   * `ghError` would lose `.status` and `.request` for no reason.
   *
   * `op` is not a bare method name here the way it is at the other call
   * sites: every caller of this helper names the sub-operation and the PR
   * number it applies to (e.g. `createPullRequest reviewers for #42`), since
   * a failure here throws for a PR that already exists (created) or was
   * already partially updated (patched). A generic `createPullRequest`
   * label would read as "nothing happened," which is false.
   */
  private async fireAndThrow(
    op: string,
    route: string,
    data: unknown
  ): Promise<void> {
    try {
      await this.octokit.request(route, { data });
    } catch (err) {
      if (err instanceof RequestError && err.response) {
        throw ghError(op, err);
      }
      throw err;
    }
  }

  /**
   * Issue a GraphQL (v4) request. Returns null on transport, HTTP, or GraphQL
   * errors: callers report "unknown" rather than substituting a value.
   *
   * MAT-133 (phase 4): swallowing every failure category into a warn + null
   * is intentional legacy behavior, not something this transport swap is
   * fixing. Do not "harmonize" this with the throw-on-HTTP-failure pattern
   * used everywhere else in this file -- that change is scoped to phase 4,
   * and making it here would be indistinguishable from a transport
   * regression.
   *
   * `octokit.graphql` derives its endpoint from the client's REST `baseUrl`:
   * for github.com (`https://api.github.com`) it appends `/graphql`; for a
   * GHES host (`.../api/v3`) `@octokit/graphql` detects the `/api/v3` suffix
   * itself and rewrites it to `/api/graphql`, matching what
   * `resolveGitHubUrls` computes separately. See
   * `@octokit/graphql/dist-src/graphql.js`'s `GHES_V3_SUFFIX_REGEX`. Both
   * hosts are covered by tests since no fixture otherwise exercises GHES.
   *
   * `createGitHubClient` also declines to retry a rate limit hit on this
   * transport (see its `onRateLimit`/`onSecondaryRateLimit`): without that,
   * a GraphQL response reporting `RATE_LIMITED` or a secondary rate limit
   * would retry through the REST retry budget before this catch ever ran,
   * turning an immediate null into a wait of minutes to hours -- exactly
   * the kind of caller-visible delay this swallow exists to avoid.
   */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T | null> {
    try {
      return (await this.octokit.graphql<T>(query, variables)) ?? null;
    } catch (err) {
      const messages = graphqlErrorMessages(err);
      if (messages) {
        this.log.warn('GitHub GraphQL returned errors', { messages });
        return null;
      }
      if (err instanceof GraphqlResponseError) {
        // `graphqlErrorMessages` returned null above, meaning `err.errors`
        // was empty. `@octokit/graphql` throws whenever the response body
        // has an `errors` key at all -- `if (response.data.errors)`, which
        // is true even for `[]`, an empty array being truthy in JS -- but
        // the old bare-fetch code tested `payload.errors?.length`, so an
        // empty array read as success. Reproduce that by falling through to
        // whatever data the response actually carried.
        return (err.data as T | undefined) ?? null;
      }
      if (err instanceof RequestError && err.response) {
        this.log.warn('GitHub GraphQL request failed', { status: err.status });
        return null;
      }
      this.log.warn('GitHub GraphQL request threw', {
        message: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  }

  /**
   * Issue a GraphQL (v4) request that must succeed. The mutation counterpart
   * to `graphql()`.
   *
   * MAT-133. `graphql()` reports every failure as `null` so read callers can
   * say "unknown" instead of substituting a value. A mutation has no such
   * answer available: a `null` from `enablePullRequestAutoMerge` is
   * indistinguishable from "auto-merge is off", which is the MAT-15 bug class
   * where a silent no-op meant a draft MR was never actually published.
   *
   * `graphql()` is deliberately left alone rather than harmonized with this.
   * Two live-passing read paths depend on its swallow and no failing
   * assertion drives changing them.
   */
  private async graphqlOrThrow<T>(
    op: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    let data: T | null | undefined;
    try {
      data = await this.octokit.graphql<T>(query, variables);
    } catch (err) {
      const messages = graphqlErrorMessages(err);
      if (messages) {
        throw new Error(`${op} failed: GitHub GraphQL returned ${messages.join('; ')}`);
      }
      if (err instanceof GraphqlResponseError) {
        // Empty `errors` array. `@octokit/graphql` throws on the key's mere
        // presence and `[]` is truthy, but an empty array carries no error.
        // `graphql()` reads that as success by falling through to the
        // response's data, and so does this.
        data = err.data as T | undefined;
      } else if (err instanceof RequestError && err.response) {
        throw ghError(op, err, 'statusText');
      } else {
        throw err;
      }
    }
    if (data == null) {
      throw new Error(`${op} failed: GitHub GraphQL returned no data`);
    }
    return data;
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

    const data = await this.graphqlOrThrow<
      Record<string, { pullRequest?: { isDraft: boolean } } | undefined>
    >('updatePullRequest', mutation, { id: pullRequestId });

    // Kept after the throwing call: `graphqlOrThrow` proves the request
    // succeeded and returned data, not that GitHub landed the flag we asked
    // for. Reporting success on a draft flag that never took is the bug this
    // check exists for.
    if (data[field]?.pullRequest?.isDraft !== draft) {
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
   * Review threads for one PR, keyed by the databaseId of the comment that
   * roots each thread.
   *
   * That key is what makes the join work. REST review comments carry no
   * thread id, so `fetchMRDiscussions` groups them by `in_reply_to_id ?? id`
   * and the resulting root is the same comment GraphQL reports as the
   * thread's first. Fetching `comments(first: 1)` is therefore enough to
   * match a whole thread.
   *
   * Distinct from `fetchUnresolvedThreadCounts`, which batches many PRs and
   * only needs a count. This one needs per-thread identity, so it is per-PR
   * and paginates rather than reporting unknown on the first page alone.
   *
   * The walk is still bounded, at `THREAD_MAX_PAGES`, so a pathological PR
   * cannot spin it forever. Hitting that bound with pages still remaining
   * logs a warning and returns the partial index rather than throwing:
   * threads past the bound are simply absent from the map, and the caller
   * (`fetchMRDiscussions`) already treats an absent thread as "unknown"
   * rather than "unresolved", so a partial index degrades the same way a
   * missing one does.
   *
   * Throws on any failure. Read callers that can degrade wrap the call;
   * mutation callers must not.
   */
  private async fetchReviewThreadIndex(
    op: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Map<number, GHReviewThread>> {
    const query = `
      query GlancePullRequestThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: ${THREAD_PAGE_SIZE}, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) { nodes { databaseId } }
              }
            }
          }
        }
      }
    `;

    const index = new Map<number, GHReviewThread>();
    let cursor: string | null = null;
    // Stays true only if every page up to the bound reported more remaining;
    // a normal `break` below (the common case) flips it to false.
    let boundHit = true;

    for (let page = 0; page < THREAD_MAX_PAGES; page++) {
      // Annotated rather than left to inference: `cursor` is reassigned below
      // from this same call's result, and without the annotation TypeScript's
      // control-flow analysis treats `data`'s type as depending on `cursor`
      // depending on `data` across loop iterations and reports it circular.
      const data: GHPullRequestThreadsResponse = await this.graphqlOrThrow<GHPullRequestThreadsResponse>(
        op,
        query,
        { owner, repo, number: prNumber, cursor }
      );

      const threads = data.repository?.pullRequest?.reviewThreads;
      if (!threads) {
        throw new Error(
          `${op} failed: GitHub reported no pull request ${owner}/${repo}!${prNumber}`
        );
      }

      for (const node of threads.nodes) {
        const rootCommentId = node?.comments?.nodes[0]?.databaseId;
        // A thread whose first comment carries no databaseId cannot be joined
        // to anything REST returned, so indexing it would be indexing nothing.
        if (!node || rootCommentId == null) continue;
        index.set(rootCommentId, {
          nodeId: node.id,
          isResolved: node.isResolved,
          rootCommentId
        });
      }

      if (!threads.pageInfo?.hasNextPage) {
        boundHit = false;
        break;
      }
      cursor = threads.pageInfo.endCursor;
    }

    if (boundHit) {
      // Not a failure: the index is partial, not wrong. The threads that
      // didn't fit are simply missing from it, and the caller already reads
      // a missing thread as unknown rather than resolved or unresolved.
      this.log.warn(`${op}: hit the review-thread page bound with more threads remaining`, {
        projectPath: `${owner}/${repo}`,
        prNumber,
        pages: THREAD_MAX_PAGES
      });
    }

    return index;
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
        if (err instanceof RequestError && err.response) {
          throw ghError('fetchPullRequests', err);
        }
        // No `.response`: a transport failure, not an HTTP result. Rethrow
        // the original error untouched, same as the other five migrated
        // methods, instead of laundering it through `ghError` into a plain
        // `Error` that has lost `.status` and `.request`.
        throw err;
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
    const { owner, repo } = this.splitOwnerRepo(repoPath);
    // `paginate` needs the route template plus real route params (rather
    // than one path string) so it can follow the `Link` header itself; every
    // other call site in this file interpolates a whole path instead.
    return this.octokit.paginate<GHReview>(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      { owner, repo, pull_number: prNumber, per_page: 100 }
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

  /**
   * Splits an "owner/repo" path into the two route params `paginate` needs.
   * Every other call site in this file hands Octokit a whole interpolated
   * path; `paginate` is the one place a route template plus separate params
   * is correct, since it re-derives the next page's URL from the route
   * itself rather than from a path string it was only handed once.
   */
  private splitOwnerRepo(repoPath: string): { owner: string; repo: string } {
    const slash = repoPath.indexOf('/');
    // A theme of this change is refusing to degrade silently on a failure
    // `paginate` can't recover from; fabricating an `owner`/`repo` pair out
    // of a path with no slash (e.g. owner = the whole string, repo = "")
    // would send `paginate` a route it silently mis-follows instead of one
    // that fails loudly.
    if (slash === -1) {
      throw new Error(`splitOwnerRepo: expected "owner/repo", got "${repoPath}"`);
    }
    return { owner: repoPath.slice(0, slash), repo: repoPath.slice(slash + 1) };
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

function toNote(c: GHComment, resolved: boolean | null = null): Note {
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
    // Resolution is a property of the thread, not of an individual comment,
    // so it is passed in. GitLab reports the same value on every note of a
    // resolved discussion and this matches that.
    resolved: c.path ? resolved : null,
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

/**
 * The root comment id inside a `gh-review-thread-<id>` discussion id, or null
 * for any other shape.
 *
 * Null for `gh-issue-comment-<id>` is the useful case: those are PR-level
 * comments with no thread behind them, and the caller turns the null into an
 * explanation rather than sending a comment id to a mutation that wants a
 * thread.
 */
function parseReviewThreadDiscussionId(discussionId: string): number | null {
  const match = /^gh-review-thread-(\d+)$/.exec(discussionId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
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
  // Octokit hands back the whole header map (lowercase keys, string values)
  // rather than one cherry-picked field, so passing it straight into
  // ResponseInit restores content-type, etag, location, x-ratelimit-*, and
  // everything else a pre-Octokit caller could read off the genuine fetch
  // Response, not just Link. Only string-valued entries are copied. The
  // Headers constructor would coerce anything else rather than throw, which
  // is the trap: an array or object would arrive as "x,y" or
  // "[object Object]" and read as a real header value. Dropping it keeps a
  // never-observed exotic value from looking like data.
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') responseHeaders[key] = value;
  }
  const init: ResponseInit = {
    status,
    statusText: reasonPhrase(status),
    headers: responseHeaders
  };
  return new Response(body, init);
}

/**
 * Read GraphQL-level error messages off a thrown error, for `graphql()`'s
 * MAT-133 swallow. Two different shapes carry this same "the response was a
 * 200 with a GraphQL-level error" outcome:
 *
 * - `GraphqlResponseError`, thrown by `@octokit/graphql` itself whenever the
 *   response has a non-empty `errors` array.
 * - A plain `Error` with a `.data.errors` array, thrown by
 *   `@octokit/plugin-throttling`'s own `RATE_LIMITED`-in-body detection (see
 *   `wrap-request.js`) -- a different class, but the same underlying
 *   GraphQL error payload the old bare-fetch code read directly off
 *   `payload.errors`.
 *
 * Returns null (not a match) for an empty `errors` array so a caller falls
 * through to treating the response as a success, matching the old code's
 * `payload.errors?.length` check rather than a truthiness check on the
 * array itself.
 */
function graphqlErrorMessages(err: unknown): string[] | null {
  if (err instanceof GraphqlResponseError) {
    return err.errors && err.errors.length > 0
      ? err.errors.map(e => e.message)
      : null;
  }
  if (err instanceof Error) {
    const data = (err as unknown as { data?: { errors?: unknown } }).data;
    if (Array.isArray(data?.errors)) {
      const errors = data.errors as Array<{ message: string }>;
      return errors.length > 0 ? errors.map(e => e.message) : null;
    }
  }
  return null;
}
