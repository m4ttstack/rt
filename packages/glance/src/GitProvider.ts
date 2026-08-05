import type {
  BranchProtectionRule,
  CreatePullRequestInput,
  Discussion,
  InvalidationBatch,
  JobDetail,
  MergePullRequestInput,
  MRDetail,
  Pipeline,
  ProviderCapabilities,
  PullRequest,
  UpdatePullRequestInput,
  UserRef,
  WatchEventsOptions,
} from './types.ts';
import type { RealtimeWatcherOptions } from './RealtimeWatcher.ts';

/** MR/PR state filter values. */
export type MRState = 'opened' | 'merged' | 'closed';

/**
 * A fetch returned less than the caller asked for.
 *
 * `fetchPullRequests` resolves to a plain `PullRequest[]`, which has nowhere
 * to say "...and there were more": a bounded scan that stops at its page cap
 * and a complete result are the same value. This is that missing channel.
 * A caller doing best-effort discovery can ignore it; a caller that must not
 * present a partial board should treat any warning as "this list is
 * incomplete" and say so in its UI.
 */
export interface FetchPullRequestsWarning {
  /**
   * `page-cap`: a bounded scan stopped with matches still outstanding.
   * `request-failed`: a non-ok response, so whatever it would have returned
   * is missing from the result entirely. Rate limiting shows up here.
   */
  kind: 'page-cap' | 'request-failed';
  /** Which leg of the fetch: the search API, a repository listing, or a per-MR detail fetch. */
  source: 'search' | 'list' | 'detail';
  /** Human-readable summary, always populated. */
  message: string;
  /** The HTTP status, when `kind` is `request-failed`. */
  status?: number;
  /** What the warning is about: a search query, a project path, or `owner/repo#number`. */
  target?: string;
}

/**
 * Options for `fetchPullRequests`.
 * All fields are optional — omitting everything returns the user's open MRs.
 */
export interface FetchPullRequestsOptions {
  /**
   * Filter by state(s). Defaults to `'opened'`.
   * Pass a single state or an array (e.g. `['opened', 'merged']`).
   * When multiple states are requested and the API only supports one,
   * the provider fetches `all` and filters client-side.
   */
  state?: MRState | MRState[];

  /**
   * Fetch specific MRs by IID in a single batched query.
   * Requires `projectPath` to be set.
   */
  iids?: number[];

  /**
   * Fetch every MR in the project authored by any of these usernames, with
   * full dashboard fields, in one query per author. Lets a caller build a
   * team board without the token user being involved in each MR — no REST
   * discovery pass needed. Requires `projectPath` to be set.
   */
  authorUsernames?: string[];

  /**
   * Project path (e.g. `'group/project'`). Required when `iids` or
   * `authorUsernames` is specified. May also be passed ALONE: returns every
   * MR in the project (member-blind), cursor-paginated, with full dashboard
   * fields.
   */
  projectPath?: string;

  /** Only MRs updated at/after this ISO-8601 instant. Honored by the projectPath-alone mode. */
  updatedAfter?: string;
  /** Project mode: fetch the list-weight fragment (no CI stages/jobs trees). ~10x cheaper
      per page on large projects and immune to GitLab's resolver timeouts on job trees;
      per-MR job detail stays available via fetchSingleMR. */
  listWeight?: boolean;

  /**
   * Called once per way the result fell short: a page cap reached with matches
   * outstanding, a search page that failed, an MR whose detail fetch was
   * rejected. A quiet fetch made no such compromise.
   *
   * Invoked synchronously during the fetch; a callback that throws is ignored,
   * never surfaced as a fetch failure.
   *
   * GitHub emits these for its search/listing page caps and for non-ok detail
   * responses (rate limiting reaches a caller this way). GitLab paginates its
   * project mode to exhaustion and raises transport failures as exceptions, so
   * it has nothing to report and never calls this.
   */
  onWarning?: (warning: FetchPullRequestsWarning) => void;
}

/**
 * The project path an option requires, or a thrown error naming that option.
 *
 * Shared by both providers so `{ iids }` without a `projectPath` fails the
 * same way everywhere: one provider throwing while the other quietly returned
 * a different query's results is the cross-provider split this prevents.
 */
export function requireProjectPath(projectPath: string | undefined, field: string): string {
  if (!projectPath) {
    throw new Error(`fetchPullRequests: \`${field}\` requires \`projectPath\``);
  }
  return projectPath;
}

/**
 * `updatedAfter` as epoch milliseconds, or null when it was not supplied.
 *
 * @throws when the value is not parseable as an instant. Forwarding an
 *   unparseable bound to the API instead means the filter is silently dropped
 *   and the caller gets more MRs than it asked for.
 */
export function parseUpdatedAfter(updatedAfter: string | undefined): number | null {
  if (updatedAfter == null) return null;
  const parsed = Date.parse(updatedAfter);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `fetchPullRequests: updatedAfter must be an ISO-8601 instant, got "${updatedAfter}"`,
    );
  }
  return parsed;
}

/**
 * Provider-agnostic interface for a Git hosting service.
 *
 * `GitLabProvider` implements this today; `GitHubProvider` will follow.
 * `Connection` stores a `GitProvider` and uses only this interface — it never
 * reaches into provider-specific internals.
 */
export interface GitProvider {
  /** The provider slug stored in `connected_accounts.provider`. */
  readonly providerName: string;

  /** The base URL for this provider instance, e.g. "https://gitlab.com". */
  readonly baseURL: string;

  /** Validate the stored credentials and return the authenticated user. */
  validateToken(): Promise<UserRef>;

  /**
   * Fetch pull/merge requests the current user is involved in.
   *
   * - No args or `{}`: returns open MRs (authored + assigned + reviewing)
   * - `{ state }`: filter by state(s)
   * - `{ iids, projectPath }`: batch-fetch specific MRs by IID
   * - `{ authorUsernames, projectPath }`: every MR in the project authored by
   *   any of those users (for team boards)
   * - `{ projectPath }`: every MR in the project (team/project view), paginated
   *
   * Contract every implementation owes a caller, so the same input cannot mean
   * different things on different providers:
   *
   * - `iids` or `authorUsernames` without `projectPath` **throws**. Neither is
   *   answerable without a project, and quietly answering a different question
   *   (the involvement set) is worse than failing.
   * - A present-but-empty `iids` or `authorUsernames` selects that mode and
   *   returns `[]`. It asks for no MRs, not for every MR.
   * - `updatedAfter` that is not parseable as an instant **throws**, in every
   *   mode, rather than being forwarded to the API and dropped there.
   * - `onWarning` is the only signal that the returned array is short. A
   *   provider that truncates or loses MRs must call it; see
   *   `FetchPullRequestsWarning`.
   *
   * Which options each provider honors:
   *
   * | option        | GitLab                        | GitHub                    |
   * | ------------- | ----------------------------- | ------------------------- |
   * | `state`       | all modes                     | all modes                 |
   * | `updatedAfter`| `projectPath`-alone mode only | all modes                 |
   * | `listWeight`  | `projectPath`-alone mode only | all modes                 |
   * | `onWarning`   | never fires (see below)       | page caps + failed detail |
   *
   * GitLab returns full dashboard fields from every mode and paginates its
   * project mode to exhaustion, so it has no truncation to report; GitHub
   * assembles a PR from several endpoints under bounded page walks, so it does.
   */
  fetchPullRequests(options?: FetchPullRequestsOptions): Promise<PullRequest[]>;

  /**
   * Fetch a single MR/PR by project path and IID.
   * Returns null if the project or MR doesn't exist.
   */
  fetchSingleMR(projectPath: string, mrIid: number, currentUserNumericId: number | null): Promise<PullRequest | null>;

  /**
   * Fetch a single MR/PR by its source branch within a project.
   * Returns null if no matching MR/PR exists for that branch.
   * @param state - Filter by state. Defaults to `'opened'`. Pass `'all'` to include merged/closed.
   */
  fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string,
    state?: MRState | 'all',
  ): Promise<PullRequest | null>;

  /**
   * Batch-fetch MRs by source branches in a single operation.
   * Returns a Map<branch, PullRequest | null>. Branches with no open MR map to null.
   * Optional — providers that don't implement this fall back to
   * sequential fetchPullRequestByBranch calls.
   */
  fetchPullRequestsByBranches?(
    projectPath: string,
    branches: string[],
    state?: MRState | 'all',
  ): Promise<Map<string, PullRequest | null>>;

  /**
   * Create a new merge request / pull request.
   * Returns the created PullRequest.
   */
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequest>;

  /**
   * Update an existing merge request / pull request.
   * Returns the updated PullRequest.
   */
  updatePullRequest(projectPath: string, mrIid: number, input: UpdatePullRequestInput): Promise<PullRequest>;

  /**
   * Fetch branch protection rules for a repository.
   * Returns an array of rules (one per protected branch/pattern).
   */
  fetchBranchProtectionRules(projectPath: string): Promise<BranchProtectionRule[]>;

  /**
   * Delete a branch from the repository.
   * @throws if the branch doesn't exist or is protected.
   */
  deleteBranch(projectPath: string, branch: string): Promise<void>;

  /**
   * Fetch discussions (comments, threads) for a specific MR/PR.
   * Returns the MRDetail with discussions populated.
   */
  fetchMRDiscussions(repositoryId: string, mrIid: number): Promise<MRDetail>;

  // ── Mutation capabilities ───────────────────────────────────────────────

  /**
   * Reports which mutation operations this provider supports.
   * Callers should check these flags to conditionally show/hide UI
   * affordances without knowing which provider they're talking to.
   */
  readonly capabilities: ProviderCapabilities;

  // ── MR lifecycle mutations ──────────────────────────────────────────────

  /**
   * Merge (accept) a pull request / merge request.
   * All input fields are optional — omitting them defers to the project's
   * configured defaults (merge method, squash policy, delete-source-branch).
   */
  mergePullRequest(projectPath: string, mrIid: number, input?: MergePullRequestInput): Promise<PullRequest>;

  /**
   * Approve a pull request / merge request.
   * On GitLab: POST /merge_requests/:iid/approve
   * On GitHub: POST /pulls/:number/reviews with event "APPROVE"
   */
  approvePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Revoke an existing approval.
   * GitLab-only — GitHub does not support unapproving via API.
   * Check `capabilities.canUnapprove` before calling.
   */
  unapprovePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Rebase the MR source branch onto the target branch.
   * GitLab-only — GitHub does not have a native rebase API.
   * Check `capabilities.canRebase` before calling.
   */
  rebasePullRequest(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Enable auto-merge: the MR will be merged automatically when the
   * pipeline succeeds and all approval rules are met.
   * GitLab-only — check `capabilities.canAutoMerge` before calling.
   */
  setAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Cancel a previously enabled auto-merge.
   * GitLab-only — check `capabilities.canAutoMerge` before calling.
   */
  cancelAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  // ── Discussion mutations ────────────────────────────────────────────────

  /**
   * Resolve a discussion thread on an MR.
   * GitLab-only — check `capabilities.canResolveDiscussions` before calling.
   */
  resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;

  /**
   * Unresolve a previously resolved discussion thread.
   * GitLab-only — check `capabilities.canResolveDiscussions` before calling.
   */
  unresolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;

  // ── Pipeline mutations ──────────────────────────────────────────────────

  /**
   * Retry a failed or canceled pipeline.
   * On GitLab: POST /pipelines/:id/retry
   * On GitHub: POST re-run for the workflow run.
   */
  retryPipeline(projectPath: string, pipelineId: number): Promise<void>;

  /**
   * Retry a single failed or canceled job.
   * On GitLab: POST /projects/:id/jobs/:job_id/retry
   * On GitHub: POST re-run for a specific job.
   */
  retryJob(projectPath: string, jobId: number): Promise<void>;

  /**
   * Fetch the trace/log output for a job.
   * On GitLab: GET /projects/:id/jobs/:job_id/trace
   * Returns plain text log content.
   */
  fetchJobTrace(projectPath: string, jobId: number): Promise<string>;

  /**
   * Fetch the child/downstream pipeline for a trigger bridge job.
   * Returns null if no downstream pipeline exists.
   */
  fetchDownstreamPipeline(projectPath: string, jobId: number): Promise<Pipeline | null>;

  /**
   * Unified job detail fetch — single GET /jobs/:id, discriminated return type.
   * Pass `pipelineId` as a hint: if /jobs/:id returns 404 (bridge jobs don't appear
   * there), falls back to scanning /pipelines/:pipelineId/bridges instead.
   */
  fetchJobDetail(projectPath: string, jobId: number, pipelineId?: number): Promise<JobDetail>;

  // ── Review mutations ────────────────────────────────────────────────────

  /**
   * Re-request review attention on an MR from its reviewers.
   * If `reviewerUsernames` is provided, only those reviewers are pinged;
   * otherwise all current reviewers are re-requested.
   */
  requestReReview(projectPath: string, mrIid: number, reviewerUsernames?: string[]): Promise<void>;

  // ── REST pass-through (used by note mutations, job traces, etc.) ────────

  /**
   * Make an authenticated REST API request to the provider.
   * Used for operations that don't have a typed method yet (job traces,
   * pipeline retries, etc.).
   *
   * Implementations translate the path to the provider's API URL format.
   *
   * A non-2xx resolves rather than throwing, so callers branch on `res.ok`.
   *
   * GitHub's Response is rebuilt from its HTTP client rather than returned
   * from `fetch`, so `res.url` is always empty there. Status, statusText,
   * headers, and body are all carried through; `url` is the one field the
   * Response constructor cannot set, so it cannot be restored.
   */
  restRequest(method: string, path: string, body?: unknown): Promise<Response>;

  /**
   * Subscribe to real-time updates for a single MR/PR.
   *
   * Calls `onUpdate` whenever the MR state changes (pipeline status, approvals,
   * merge status, rebase progress, etc.), giving consumers a fully-typed
   * PullRequest without having to manage raw WebSocket frames or ActionCable
   * protocol details.
   *
   * Returns a dispose function — call it to unsubscribe and clean up.
   *
   * **GitLab**: Implemented via ActionCable WebSocket subscription on
   *   `userMergeRequestUpdated`, backed by a `MR_DETAIL_QUERY` re-fetch on
   *   each event to return a complete, strongly-typed PullRequest.
   * **GitHub**: Not yet implemented — throws `ProviderNotSupportedError`.
   *
   * @param projectPath - e.g. "group/project"
   * @param mrIid - the numeric MR/PR number
   * @param currentUserNumericId - used to compute roles; pass null if unknown
   * @param onUpdate - called with the latest PullRequest snapshot on each change
   * @returns dispose — call to cancel the subscription
   */
  watchMR(
    projectPath: string,
    mrIid: number,
    currentUserNumericId: number | null,
    onUpdate: (pr: PullRequest) => void,
    options?: RealtimeWatcherOptions,
  ): () => void;

  /**
   * Watch the project's events feed and translate activity into cache
   * invalidation hints. The SDK owns the poll loop: interval, jitter,
   * retry, and backoff. The caller persists the cursor via
   * `options.onCursor` and passes it back on the next start.
   *
   * Optional: GitLab-only today. Feature-detect with
   * `provider.watchEvents?.(...)` or check `capabilities.canWatchEvents`.
   *
   * Known feed blind spots (rely on a slow full refresh for these):
   * metadata-only MR edits and pipeline status transitions emit no event.
   *
   * @returns dispose. Call to stop the loop.
   */
  watchEvents?(
    projectPath: string,
    options: WatchEventsOptions,
    onInvalidations: (batch: InvalidationBatch) => void,
  ): () => void;
}

/**
 * Parse the numeric project/repo ID from a scoped repositoryId string.
 * e.g. "gitlab:42" → 42, "github:12345" → 12345
 */
export function parseRepoId(repositoryId: string): number {
  const parts = repositoryId.split(':');
  return parseInt(parts.at(-1) ?? '0', 10);
}

/**
 * Extract the provider prefix from a scoped repositoryId.
 * e.g. "gitlab:42" → "gitlab", "github:12345" → "github"
 */
export function repoIdProvider(repositoryId: string): string {
  return repositoryId.split(':')[0] ?? 'unknown';
}
