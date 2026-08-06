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
   * `request-failed`: a non-ok response. For `search`/`list`/`detail`/
   * `reviews`, whatever it would have returned is missing from the result
   * entirely. For `checks`/`threads`, the PR itself is still in the result;
   * only that one field (`pipeline`/`unresolvedThreadCount`) reads as its
   * existing "unknown" value instead of a measured one -- neither feeds an
   * approval count, so dropping the whole PR over either would be a bigger
   * degradation than the failure itself warrants.
   */
  kind: 'page-cap' | 'request-failed';
  /**
   * Which leg of the fetch: the search API, a repository listing, a per-MR
   * detail fetch, a per-MR reviews fetch (the approvals a failed page here
   * would otherwise under-report), a per-MR checks fetch, or a batched
   * thread-count query.
   */
  source: 'search' | 'list' | 'detail' | 'reviews' | 'checks' | 'threads';
  /** Human-readable summary, always populated. */
  message: string;
  /** The HTTP status, when `kind` is `request-failed`. */
  status?: number;
  /**
   * What the warning is about: a search query, a project path, or (for
   * `detail`/`reviews`/`checks`/`threads`, every single-PR source) exactly
   * `owner/repo#number` -- build it with `warningTarget`, not by hand.
   *
   * One PR per warning even for a thread-count batch that covers many at
   * once: one warning per affected PR, not one warning naming several.
   *
   * This field is the join key `fetchDashboardBatch` (MRDashboard.ts) uses
   * to attribute a warning to a row, by exact string match against
   * `warningTarget(projectPath, iid)`. A `checks` warning once carried
   * `owner/repo@sha` (the commit the check-runs fetch actually failed on,
   * which felt like the more precise thing to name) while every other
   * source carried `owner/repo#number`; that PR's own warning could never
   * match the lookup, and `DashboardGroup.onWarning` silently never fired
   * for it. `warningTarget` exists so every producer and this field's one
   * consumer read the same format from the same place, instead of relying
   * on every call site independently getting the string literal right.
   */
  target?: string;
}

/**
 * The single-PR `target` every `FetchPullRequestsWarning` for `detail`,
 * `reviews`, `checks`, and `threads` must use: `owner/repo#number`.
 *
 * Every producer of a single-PR warning (`GitHubProvider`) and this field's
 * one consumer (`fetchDashboardBatch` in `MRDashboard.ts`) call this rather
 * than interpolating the string themselves, specifically so the two sides
 * cannot drift the way `checks` (`owner/repo@sha`, a different value
 * entirely) and `threads` (a comma-joined list of several) both did before
 * this function existed -- both changes that looked like local improvements
 * (naming the actual failing commit; reporting a whole batch at once) and
 * both silently broke the one thing `target` exists for: being looked up.
 */
export function warningTarget(projectPath: string, iid: number): string {
  return `${projectPath}#${iid}`;
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
   * outstanding, a search page that failed, or a per-PR fetch that failed and
   * either dropped that PR from the result or left one of its fields at its
   * "unknown" value. A quiet fetch made no such compromise.
   *
   * Invoked synchronously during the fetch; a callback that throws is ignored,
   * never surfaced as a fetch failure.
   *
   * GitHub emits these for its search/listing page caps (`search`, `list`) and
   * for the per-PR fetches it assembles a `PullRequest` from: `detail` and
   * `reviews` (either one failing drops the PR from the result), `checks` and
   * `threads` (the PR stays, with `pipeline` / `unresolvedThreadCount` at
   * `null`). Rate limiting reaches a caller this way. GitLab paginates its
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
   * | `onWarning`   | never fires (see below)       | page caps + failed detail/reviews/checks/threads |
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
   *
   * Implementations throw on a partial read failure rather than returning
   * the rules already read: callers gate destructive actions on this list,
   * and once it is returned a partial list cannot be told apart from a
   * complete one, so returning it would be silent data loss wearing the
   * shape of success (MAT-147). If a caller ever needs to act on whatever
   * was readable, the honest fix is a return type that can say which
   * branches were unreadable, not an implementation quietly choosing
   * between the two ways of hiding that fact.
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
   * On GitLab: POST /merge_requests/:iid/unapprove.
   * On GitHub: dismisses the token user's own review (PUT
   * /pulls/:number/reviews/:review_id/dismissals) -- GitHub has no bare
   * "unapprove" endpoint, so this targets the review that currently carries
   * the approval rather than deleting an approval record.
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
   * On GitLab: PUT /merge_requests/:iid/merge with merge_when_pipeline_succeeds.
   * On GitHub: GraphQL `enablePullRequestAutoMerge`. Requires the
   * repository's `allow_auto_merge` setting to be on.
   * Check `capabilities.canAutoMerge` before calling.
   */
  setAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  /**
   * Cancel a previously enabled auto-merge.
   * On GitLab: POST /merge_requests/:iid/cancel_merge_when_pipeline_succeeds.
   * On GitHub: GraphQL `disablePullRequestAutoMerge`.
   * Check `capabilities.canAutoMerge` before calling.
   */
  cancelAutoMerge(projectPath: string, mrIid: number): Promise<void>;

  // ── Discussion mutations ────────────────────────────────────────────────

  /**
   * Resolve a discussion thread on an MR.
   * On GitLab: PUT /merge_requests/:iid/discussions/:discussion_id with
   * resolved=true.
   * On GitHub: GraphQL `resolveReviewThread`.
   * Check `capabilities.canResolveDiscussions` before calling.
   */
  resolveDiscussion(projectPath: string, mrIid: number, discussionId: string): Promise<void>;

  /**
   * Unresolve a previously resolved discussion thread.
   * On GitLab: PUT /merge_requests/:iid/discussions/:discussion_id with
   * resolved=false.
   * On GitHub: GraphQL `unresolveReviewThread`.
   * Check `capabilities.canResolveDiscussions` before calling.
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
   *
   * Both providers throw, rather than resolve, when there is nothing to
   * re-request: no `reviewerUsernames` given and the MR/PR has no existing
   * reviewers. Resolving in that case would be a silent no-op -- the caller
   * would believe reviewers were re-pinged when none were. This contract is
   * shared code's responsibility to keep in sync across providers; do not
   * let one provider throw here while the other resolves.
   */
  requestReReview(projectPath: string, mrIid: number, reviewerUsernames?: string[]): Promise<void>;

  // ── REST pass-through (used by note mutations, job traces, etc.) ────────

  /**
   * Make an authenticated REST API request to the provider.
   * Used for operations that don't have a typed method yet (job traces,
   * pipeline retries, etc.).
   *
   * `path` is always provider-relative -- the same shape on either provider,
   * e.g. `/user`, never `/api/v4/user` or `/api/v3/user`. Implementations
   * translate that path to the provider's actual API URL: GitHub joins it
   * onto its API root (`https://api.github.com`, or the GHES `/api/v3` root);
   * GitLab joins it onto `${baseURL}/api/v4`. A path that already starts with
   * `/api/v4` is rejected by GitLab rather than silently accepted (MAT-130):
   * this method used to concatenate `baseURL + path` verbatim, so every
   * existing GitLab caller had learned to include that prefix itself, and
   * tolerating both shapes would leave that ambiguity in place indefinitely
   * instead of surfacing it once, at the one call site that needs to change.
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
   * Optional, and implemented on both providers today. Still feature-detect
   * with `provider.watchEvents?.(...)` or `capabilities.canWatchEvents`: the
   * interface keeps it optional, so a provider added later may not have it.
   *
   * Known feed blind spots (rely on a slow full refresh for these):
   * metadata-only MR edits and pipeline status transitions emit no event.
   * GitHub is blinder than GitLab on both counts: its feed carries no CI
   * events at all, so `pipelines` never fires, and it retains only hours of
   * history, so a watcher down longer than that must full-sync rather than
   * trust its cursor. It also polls at 60s by default, not 15s.
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
