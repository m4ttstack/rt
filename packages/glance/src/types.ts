/**
 * Provider-agnostic domain types.
 *
 * These are the canonical types sent to Swift clients via the WebSocket protocol.
 * No raw provider payloads leave the provider layer — only these types.
 *
 * Field names match the Swift DomainXxx structs in Sources/GlanceLib/Models/Domain/.
 */

export interface UserRef {
  /** Scoped provider ID, e.g. "gitlab:12345". */
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * GitLab's native review state — surfaced exactly as the API defines it.
 * Comes from `mergeRequestInteraction.reviewState` on each reviewer.
 */
export type MergeRequestReviewState =
  | 'APPROVED' // clicked Approve
  | 'REQUESTED_CHANGES' // clicked Request changes
  | 'REVIEWED' // submitted review comments without approving ("left review comments")
  | 'REVIEW_STARTED' // started a review but hasn't submitted yet
  | 'UNAPPROVED' // previously approved, then un-approved
  | 'UNREVIEWED'; // assigned reviewer, no action taken

/**
 * UI-friendly review display state — derived from the raw GitLab flags.
 * Matches GitLab's own UI language for consistency.
 */
export type ReviewDisplayState =
  | 'approved'
  | 'commented'
  | 'changes_requested'
  | 'reviewing'
  | 'awaiting_review';

/** Map raw GitLab review state → UI display state */
export function getReviewDisplayState(
  raw: MergeRequestReviewState | null
): ReviewDisplayState {
  switch (raw) {
    case 'APPROVED':
      return 'approved';
    case 'REVIEWED':
      return 'commented';
    case 'REQUESTED_CHANGES':
      return 'changes_requested';
    case 'REVIEW_STARTED':
      return 'reviewing';
    case 'UNAPPROVED':
    case 'UNREVIEWED':
    case null:
    default:
      return 'awaiting_review';
  }
}

/**
 * An assigned MR reviewer with their current review state.
 */
export interface Reviewer extends UserRef {
  /** The reviewer's current state on this MR. Null only on providers that don't support review states. */
  reviewState: MergeRequestReviewState | null;
  /** UI-friendly display state, derived from reviewState via getReviewDisplayState() */
  displayState?: ReviewDisplayState;
}

export interface PipelineJob {
  /** Scoped provider ID, e.g. "gitlab:12345". */
  id: string;
  name: string;
  stage: string;
  /** Normalized status: "success" | "failed" | "running" | "pending" | "canceled" | "skipped" | "manual" | etc. */
  status: string;
  allowFailure: boolean;
  /** Duration in seconds, null if not yet completed. */
  duration: number | null;
  webUrl: string | null;
  /** If this job triggered a child/downstream pipeline, its details are here. */
  downstreamPipeline?: Pipeline | null;
}

export interface Pipeline {
  /** Scoped provider ID, e.g. "gitlab:pipeline:12345". */
  id: string;
  /** Normalized status. */
  status: string;
  createdAt: string | null;
  webUrl: string | null;
  jobs: PipelineJob[];
}

/**
 * Discriminated union returned by `fetchJobDetail`.
 * Callers switch on `type` — no guessing needed.
 */
export type JobDetail =
  | { type: 'trace'; content: string }
  | { type: 'bridge'; downstreamPipeline: Pipeline };

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

/**
 * GitLab `detailedMergeStatus` values that mean "mergeability is not decided
 * yet" rather than naming something that blocks the merge. GitLab's own
 * `MergeRequests::Mergeability::DetailedMergeStatusService` returns
 * `preparing`, then `unchecked`, then `checking` before it runs a single
 * check, and `approvals_syncing` while an approval rule is re-evaluated;
 * every other value is either `mergeable` or the identifier of a check that
 * actually failed.
 *
 * One list, because three readers ask the same question of these strings and
 * must not answer it differently: the dashboard decides whether to render
 * BLOCKED, `GitLabProvider.mergePullRequest` decides whether a refused merge
 * is worth retrying, and the live conformance harness decides whether an MR is
 * still settling. GitHub has no equivalent pre-merge state and always reports
 * `detailedMergeStatus` as null, so none of the three arises there.
 *
 * A frozen array rather than a `ReadonlySet`, because this is public API and
 * that type is erased at compile time: `Object.freeze` on a `Set` does not
 * stop `.add`, since a Set's contents are not properties, so a consumer could
 * silently repoint both the dashboard's BLOCKED rule and the provider's retry
 * hint. A frozen array actually refuses.
 */
export const TRANSITIONAL_MERGE_STATUSES: readonly string[] = Object.freeze([
  'preparing',
  'unchecked',
  'checking',
  'approvals_syncing',
]);

/** True when GitLab has not finished deciding whether this MR can merge. */
export function isTransitionalMergeStatus(status: string | null | undefined): boolean {
  return status != null && TRANSITIONAL_MERGE_STATUSES.includes(status);
}

export interface PullRequest {
  /** Scoped provider ID, e.g. "gitlab:12345". */
  id: string;
  /** Numeric MR/PR number within the project. */
  iid: number;
  /** Scoped repository ID, e.g. "gitlab:42". */
  repositoryId: string;
  title: string;
  /** Full MR description body. Used by AI summarization and the MR header. */
  description: string | null;
  /** "opened" | "merged" | "closed" */
  state: string;
  draft: boolean;
  conflicts: boolean;
  webUrl: string | null;
  sourceBranch: string;
  targetBranch: string;
  /** True when targetBranch differs from the repo's default branch (a stack
      MR pointed at its parent). False/absent when the default branch is
      unknown. */
  isStacked?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** Head commit SHA. */
  sha: string | null;

  author: UserRef;
  assignees: UserRef[];
  reviewers: Reviewer[];
  /** Roles the current authenticated user has on this MR. Values: "author" | "reviewer" | "assignee". */
  roles: string[];

  pipeline: Pipeline | null;
  /**
   * Open review threads. `null` means the provider could not determine the
   * count, which is not the same as zero. Never render it as "all resolved".
   * GitLab always reports a number. GitHub reports null when the GraphQL
   * review-thread query fails or the PR carries more threads than one page.
   */
  unresolvedThreadCount: number | null;
  approvalsLeft: number;
  /** True when the MR has met its approval requirements. */
  approved: boolean;
  approvedBy: UserRef[];
  diffStats: DiffStats | null;
  /**
   * Raw GitLab detailedMergeStatus value, e.g. "mergeable", "conflict",
   * "not_approved", "discussions_not_resolved". Null for non-GitLab providers.
   */
  detailedMergeStatus: string | null;

  // ── Auto-merge status ────────────────────────────────────────────────

  /** Whether auto-merge (merge when pipeline succeeds) is currently enabled. */
  autoMergeEnabled: boolean;
  /** The merge strategy that will be used when auto-merge fires, e.g. "merge", "squash", "rebase_merge". */
  autoMergeStrategy: string | null;
  /** The user who merged or enabled auto-merge. */
  mergeUser: UserRef | null;
  /** ISO timestamp after which the MR is eligible to merge (scheduled merge). */
  mergeAfter: string | null;
  /**
   * Number of commits the source branch is behind the target, or null when
   * the fetch path did not request it. Null means "not asked", never "zero".
   *
   * GitLab populates it only where the REST
   * `?include_diverged_commits_count=true` call is made: `fetchSingleMR`
   * (and `fetchPullRequestByBranch`, which is backed by it) and the
   * role-based mode of `fetchPullRequests`. The `iids`, `authorUsernames`,
   * and `projectPath` modes of `fetchPullRequests`, plus
   * `fetchPullRequestsByBranches`, all leave it null. GitHub always leaves it
   * null: it would need a `GET /compare/{base}...{head}` per PR.
   *
   * Collapsing that null into zero is what MAT-164 fixed. Do not reintroduce
   * a `?? 0` on this field.
   */
  divergedCommitsCount: number | null;

  // ── Merge in-progress / realtime states ──────────────────────────────

  /** True while a rebase is being run on the source branch (show spinner). */
  rebaseInProgress: boolean;
  /** True while the merge itself is being processed after clicking merge (show spinner). */
  mergeOngoing: boolean;
  /** Non-null while merge is actively running — GitLab sets this during the merge process. */
  inProgressMergeCommitSha: string | null;
  /** Error message set when an auto-merge or merge-train merge fails. */
  mergeError: string | null;
  /** True if the source branch should be rebased before merge (diverged / not up to date). */
  shouldBeRebased: boolean;

  // ── Mergeability checklist ────────────────────────────────────────────

  /**
   * Individual merge readiness checks — mirrors the GitLab "Ready to merge" checklist.
   * GitLab only. Empty array on GitHub.
   */
  mergeabilityChecks: MergeabilityCheck[];
  /** Number of open blocking merge requests that must merge first. */
  blockingMergeRequestsCount: number;

  // ── Squash / approval counts ──────────────────────────────────────────

  /** Total number of required approvals (complements approvalsLeft). GitLab only. */
  approvalsRequired: number;
  /** Whether the MR is configured to squash commits on merge. */
  squash: boolean;
  /** True if the project's merge method forces squash regardless of per-MR setting. */
  squashOnMerge: boolean;
  /** Zero-based position in the merge train queue. Null if not in a merge train. */
  mergeTrainIndex: number | null;
}

// ── MR Dashboard props ────────────────────────────────────────────────────────

/** Simplified cross-platform merge status for list/queue views. */
export type MRStatus = 'mergeable' | 'blocked' | 'draft' | 'closed' | 'merged';

/** Normalized MR lifecycle state — provider-agnostic. */
export type MRState = 'opened' | 'merged' | 'closed' | 'draft';

/**
 * A fully-derived, headless-UI-ready props object for rendering an MR dashboard.
 *
 * All fields are pre-computed — no conditional logic needed in the component layer.
 * Obtain via `getMRDashboardProps(mr)` from any source that returns `PullRequest`.
 */
export interface MRDashboardProps {
  // ── Identity ────────────────────────────────────────────────────────────
  /** Provider slug: "gitlab" | "github" — use to pick the correct brand icon. */
  provider: string;
  iid: number;
  title: string;
  webUrl: string | null;
  state: MRState;
  isDraft: boolean;
  author: UserRef;
  assignees: UserRef[];
  /** ISO 8601 timestamp of when the MR was created. */
  createdAt: string | null;

  // ── Branch ──────────────────────────────────────────────────────────────
  sourceBranch: string;
  targetBranch: string;
  /** True when targetBranch differs from the repo's default branch (a stack
      MR pointed at its parent). False/absent when the default branch is
      unknown. */
  isStacked?: boolean;
  /**
   * Commits the source branch is behind `targetBranch`, or null when the
   * fetch path that produced this MR never asked for the count.
   *
   * Informational, deliberately not a blocker (MAT-164): on a
   * `merge_method: merge` project a moved target branch does not stop a
   * merge, and GitLab's own UI offers no rebase button for it. The blocker
   * question is `blockers.needsRebase`.
   *
   * Null is not zero. A consumer rendering "behind by N" must treat null as
   * unknown rather than as "up to date", or the same MR will appear to fall
   * in and out of being behind as the caller alternates between fetch paths.
   * `PullRequest.divergedCommitsCount` documents which paths populate it.
   */
  behindTarget: number | null;

  // ── Diff ────────────────────────────────────────────────────────────────
  diff: { additions: number; deletions: number; filesChanged: number } | null;

  // ── Pipeline ────────────────────────────────────────────────────────────
  pipeline: {
    /** Scoped provider ID, e.g. \"gitlab:pipeline:12345\". */
    id: string;
    status: string;
    passing: number;
    failing: number;
    running: number;
    total: number;
    /** Any job where allowFailure=true that has failed — warning icon. */
    hasWarnings: boolean;
    /** Individual job results for detailed display. */
    jobs: PipelineJob[];
  } | null;

  // ── Reviews & Approvals ─────────────────────────────────────────────────
  reviews: {
    required: number;
    given: number;
    remaining: number;
    isApproved: boolean;
    approvedBy: UserRef[];
    /** All assigned reviewers with their individual reviewState. */
    reviewers: Reviewer[];
    totalAssigned: number;
    /** APPROVED | REVIEWED | REQUESTED_CHANGES */
    haveActed: number;
    /** REVIEW_STARTED */
    havePending: number;
    /** UNREVIEWED | UNAPPROVED */
    haveNotStarted: number;
  };

  // ── Status ──────────────────────────────────────────────────────────────
  status: MRStatus;
  /** Raw GitLab detailedMergeStatus for power-user rendering. */
  statusDetail: string;
  isReady: boolean;
  /**
   * True when GitLab is asynchronously re-evaluating mergeability
   * (detailedMergeStatus is one of TRANSITIONAL_MERGE_STATUSES: "preparing",
   * "unchecked", "checking", or "approvals_syncing").
   * The MR may become mergeable momentarily — show a spinner rather than a hard BLOCKED state.
   */
  isCheckingMergeability: boolean;

  // ── In-progress spinners ────────────────────────────────────────────────
  isMerging: boolean;
  isRebasing: boolean;
  isLoading: boolean;

  // ── Button props ─────────────────────────────────────────────────────────
  mergeButton: {
    visible: boolean;
    disabled: boolean;
    loading: boolean;
    label: string;
  };
  autoMergeButton: {
    visible: boolean;
    isActive: boolean;
    strategy: string | null;
    setBy: UserRef | null;
    label: string;
    cancelLabel: string;
  };
  /**
   * `visible` tracks `PullRequest.shouldBeRebased` -- GitLab's own answer to
   * whether this project's merge method requires a rebase first -- so the
   * button appears where GitLab shows one and nowhere else. Behind-ness alone
   * does not raise it (MAT-164); read `behindTarget` and render your own
   * affordance if you want one.
   */
  rebaseButton: {
    visible: boolean;
    loading: boolean;
    label: string;
  };

  // ── Blockers ─────────────────────────────────────────────────────────────
  blockers: {
    isDraft: boolean;
    hasConflicts: boolean;
    /**
     * GitLab requires a rebase before this MR can merge
     * (`PullRequest.shouldBeRebased`). Not "the target branch has moved" --
     * that is `behindTarget`, which is not a blocker (MAT-164).
     */
    needsRebase: boolean;
    pipelineFailing: boolean;
    pipelineRunning: boolean;
    awaitingApprovals: boolean;
    hasUnresolvedDiscussions: boolean;
    hasMergeError: boolean;
    mergeError: string | null;
    /** Convenience: true if any blocker above is true. */
    any: boolean;
  };

  // ── Connection health ───────────────────────────────────────────────────
  /**
   * WebSocket / push connection state for the dashboard subscription.
   * Embedded directly so every consumer has connection health without
   * needing to wire a separate `onStatusChange` callback.
   *
   * - `'connecting'` — initial fetch in progress, no data yet
   * - `'connected'`  — push subscription healthy, data is live
   * - `'disconnected'` — push lost, falling back to polling
   * - `'reconnecting'` — push lost + fetch errors, retrying with backoff
   * - `'idle'`         — not subscribed (e.g. from `getMRDashboardProps` directly)
   */
  connection: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'idle';
}

/**
 * Pre-bound mutation callbacks for an MR dashboard component.
 * The write-side companion to MRDashboardProps (read-side).
 *
 * All methods are pre-scoped to a specific (projectPath, mrIid) pair.
 * Obtain via `createDashboard()`.
 */
export interface MRDashboardActions {
  merge: (input?: MergePullRequestInput) => Promise<PullRequest>;
  rebase: () => Promise<void>;
  approve: () => Promise<void>;
  unapprove: () => Promise<void>;
  setAutoMerge: () => Promise<void>;
  cancelAutoMerge: () => Promise<void>;
  retryPipeline: (pipelineId: number) => Promise<void>;
  /** Retry a single failed/canceled job. */
  retryJob: (jobId: number) => Promise<void>;
  /** Fetch the trace/log output for a job. Returns plain text. */
  fetchJobTrace: (jobId: number) => Promise<string>;
  /** Fetch child/downstream pipeline for a bridge/trigger job. */
  fetchDownstreamPipeline: (jobId: number) => Promise<Pipeline | null>;
  /**
   * Unified job detail fetch. Returns a discriminated union:
   * - `{ type: 'trace', content }` for regular jobs
   * - `{ type: 'bridge', downstreamPipeline }` for trigger/bridge jobs
   *
   * Pass `pipelineId` as a hint so bridge jobs (which 404 on /jobs/:id)
   * can be found via the /pipelines/:id/bridges fallback.
   */
  fetchJobDetail: (jobId: number, pipelineId?: number) => Promise<JobDetail>;
  requestReReview: (usernames?: string[]) => Promise<void>;
  /** Toggle draft / ready-for-review status. */
  toggleDraft: (draft: boolean) => Promise<PullRequest>;
  /** Capability flags — UI uses these to show/hide action buttons. */
  can: ProviderCapabilities;
}

/**
 * Payload delivered on each `createDashboard` update.
 */
export interface DashboardUpdate {
  /** Render-ready MR props, derived from the latest PullRequest. */
  mr: MRDashboardProps;
  /** Pre-bound mutation methods for this MR. */
  actions: MRDashboardActions;
}

/**
 * A single entry in the GitLab merge-readiness checklist.
 * Mirrors the "Ready to merge" UI checklist row.
 */
export interface MergeabilityCheck {
  /**
   * Stable identifier for the check, e.g. "CI_MUST_PASS", "NOT_APPROVED",
   * "CONFLICT", "DISCUSSIONS_NOT_RESOLVED", "DRAFT_STATUS", "NOT_OPEN",
   * "NEED_REBASE", "LOCKED_PATHS", "STATUS_CHECKS_MUST_PASS", etc.
   */
  identifier: string;
  /** "SUCCESS" | "CHECKING" | "FAILED" | "INACTIVE" | "WARNING" */
  status: string;
}

// ── MR/PR mutation inputs ─────────────────────────────────────────────────────

/** Input for creating a new merge request / pull request. */
export interface CreatePullRequestInput {
  /** Project path (GitLab: "group/project") or owner/repo (GitHub: "owner/repo"). */
  projectPath: string;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  draft?: boolean;
  /** Usernames to assign as reviewers. */
  reviewers?: string[];
  /** Usernames to assign. */
  assignees?: string[];
  /** Labels to apply (string names). */
  labels?: string[];
}

/** Input for updating an existing merge request / pull request. */
export interface UpdatePullRequestInput {
  title?: string;
  description?: string;
  /** Set draft status. */
  draft?: boolean;
  /** Change the target branch. */
  targetBranch?: string;
  /** Usernames to assign as reviewers (replaces current set). */
  reviewers?: string[];
  /** Usernames to assign (replaces current set). */
  assignees?: string[];
  /** Labels (replaces current set). */
  labels?: string[];
  /** Set MR state: "close" or "reopen". */
  stateEvent?: 'close' | 'reopen';
}

/**
 * Merge strategy override.
 * - "merge"  — Standard merge commit.
 * - "squash" — Squash all commits into one before merging.
 * - "rebase" — Rebase the source branch onto the target (fast-forward).
 *
 * When omitted, what happens differs by provider: GitLab's merge endpoint
 * defers to the project's configured default merge method, matching its web
 * UI. GitHub's REST merge endpoint has no such deference; it defaults
 * `merge_method` to "merge" regardless of the repository's configured
 * default, which only the web UI honors.
 */
export type MergeMethod = 'merge' | 'squash' | 'rebase';

/**
 * Input for merging (accepting) a pull request / merge request.
 *
 * All fields are **optional**. On GitLab, omitting them defers to the
 * project-level settings configured in the forge UI (merge method, squash
 * policy, delete-source-branch, etc.), matching how the web UI works. On
 * GitHub, the REST merge endpoint does not defer to those settings the way
 * the web UI does: for example, an omitted `mergeMethod` becomes "merge",
 * not the repository's configured default.
 */
export interface MergePullRequestInput {
  /** Merge commit message. Omit to use the provider/project default. */
  commitMessage?: string;
  /** Squash commit message (when merge method is "squash"). */
  squashCommitMessage?: string;
  /** Whether to squash commits. Omit to use the MR / project default. */
  squash?: boolean;
  /** Merge strategy override. Omit to use the project's default merge method. */
  mergeMethod?: MergeMethod;
  /**
   * Delete source branch after merge. Omit to use project default.
   *
   * On GitHub, this is not always honorable as written: a repository with
   * `delete_branch_on_merge` enabled deletes the branch regardless of what
   * this field says, including when it is explicitly `false`.
   */
  shouldRemoveSourceBranch?: boolean;
  /** SHA that HEAD must match for the merge to proceed (optimistic locking). */
  sha?: string;
}

/**
 * Reports which mutation operations a provider supports.
 *
 * Callers should check these flags before invoking vendor-specific methods
 * so they can conditionally show/hide UI affordances without
 * knowing which provider they're talking to.
 */
export interface ProviderCapabilities {
  /** Can merge / accept a pull request. */
  canMerge: boolean;
  /** Can approve a pull request. */
  canApprove: boolean;
  /** Can revoke an existing approval. */
  canUnapprove: boolean;
  /** Can rebase the source branch onto the target. */
  canRebase: boolean;
  /** Can enable automatic merge when pipeline succeeds. */
  canAutoMerge: boolean;
  /** Can resolve / unresolve discussion threads. */
  canResolveDiscussions: boolean;
  /** Can retry a pipeline. */
  canRetryPipeline: boolean;
  /** Can re-request review attention from reviewers. */
  canRequestReReview: boolean;
  /** Can watch the project events feed for cache invalidations. */
  canWatchEvents: boolean;
}

/** Branch protection rule (provider-agnostic). */
export interface BranchProtectionRule {
  /** Branch name or pattern, e.g. "main" or "release/*". */
  pattern: string;
  /** Whether force-pushes are allowed. */
  allowForcePush: boolean;
  /** Whether branch deletions are allowed. */
  allowDeletion: boolean;
  /** Number of required approving reviews (0 = none required). */
  requiredApprovals: number;
  /** Whether the branch requires status checks to pass before merge. */
  requireStatusChecks: boolean;
  /** Raw provider-specific data for fields not covered above. */
  raw?: Record<string, unknown>;
}

/** Snapshot payload sent when a client first connects. */
export interface PullRequestsSnapshot {
  items: PullRequest[];
}

/** One approval rule as returned by GitLab's `approvalState`. */
export interface ApprovalRuleLite {
  type: string;
  approved: boolean;
  section: string | null;
}

/** Approval rules for a single MR, keyed by IID rather than global ID. */
export interface MRApprovalRules {
  iid: number;
  rules: ApprovalRuleLite[];
}

/**
 * Options for `GitLabProvider.fetchApprovalRules`. `updatedAfter` and `iids`
 * are mutually exclusive: the former drives windowed discovery, the latter
 * the targeted events-heal path.
 */
export interface FetchApprovalRulesOptions {
  projectPath: string;
  /** ISO timestamp; windowed mode. Mutually exclusive with iids... enforced at runtime. */
  updatedAfter?: string;
  /** Targeted mode: just these MRs (the events-heal path). Mutually exclusive with updatedAfter... enforced at runtime. */
  iids?: number[];
  /** Page size, default 100. */
  pageSize?: number;
}

/** Feed event emitted as `feed_event` (incremental) or inside `feed_snapshot` (initial batch). */
export interface FeedEvent {
  /** Stable event ID, e.g. "note-1234" or "projEvent-5678". */
  id: string;
  /** MR IID within the project. */
  mrIid: number;
  /** Scoped repository ID, e.g. "gitlab:42". */
  repositoryId: string;
  /** Actor's GitLab username. */
  actor: string;
  actorAvatarUrl: string | null;
  body: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /**
   * View scope the event was fetched under.
   * "authored_by_me" | "reviewing" | "assigned_to_me" | "any"
   */
  scope: string;
  /** Normalized action: "commented" | "approved" | "merged" | "closed" | etc. */
  action: string;
  /** Normalized target type, e.g. "merge_request". */
  targetType: string;
  /** Note ID when the event originates from a note; null for action-only events. */
  noteId: number | null;
  /** MR title — the primary title shown in the Swift feed row. */
  title: string;
  /** Short human-readable line, e.g. "username commented". */
  subtitle: string;
  /** MR web URL for deep-linking. */
  webUrl: string | null;
  /**
   * True for events within the initial history window (not new since last poll).
   * Swift uses this to set event state to `.read` on insertion.
   */
  isHistorical: boolean;
}

/** Payload for a `feed_snapshot` event sent on first connect. */
export interface FeedSnapshot {
  items: FeedEvent[];
}

// ---------------------------------------------------------------------------
// D3: MR Detail types (discussions, notes, positions)
// ---------------------------------------------------------------------------

export interface NoteAuthor {
  /** Scoped provider ID, e.g. "gitlab:user:12345". */
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

export interface NotePosition {
  newPath: string | null;
  oldPath: string | null;
  newLine: number | null;
  oldLine: number | null;
  positionType: string | null;
}

export interface Note {
  id: number;
  body: string;
  author: NoteAuthor;
  createdAt: string;
  system: boolean;
  /** "DiffNote" | "DiscussionNote" | null */
  type: string | null;
  resolvable: boolean | null;
  resolved: boolean | null;
  position: NotePosition | null;
}

export interface Discussion {
  id: string;
  resolvable: boolean | null;
  resolved: boolean | null;
  notes: Note[];
}

export interface MRDetail {
  mrIid: number;
  /** Scoped repository ID, e.g. "gitlab:42". */
  repositoryId: string;
  discussions: Discussion[];
}

/**
 * A reviewer paired with all discussion threads they have authored on this MR.
 *
 * Build this list with `getReviewerSummaries(mr, discussions)`.
 * `discussions` comes from `MRDetailFetcher.fetchMRDetail()`.
 *
 * Note: `REVIEWED` state means the reviewer submitted a formal review
 * ("left review comments"), which is distinct from standalone comments
 * that any participant can leave.
 */
export interface ReviewerSummary {
  reviewer: Reviewer;
  /** Number of discussion threads this reviewer has authored. */
  commentCount: number;
  /** The actual discussion threads authored by this reviewer. */
  discussions: Discussion[];
}

/**
 * Merges reviewer state (from `mr.reviewers`) with discussion threads
 * (from `MRDetailFetcher`) into a unified list for rendering a reviewer panel.
 *
 * @param mr          - The PullRequest from `watchMR` / `fetchSingleMR`
 * @param discussions - From `MRDetailFetcher.fetchMRDetail().discussions`
 */
export function getReviewerSummaries(
  mr: { reviewers: Reviewer[] },
  discussions: Discussion[]
): ReviewerSummary[] {
  return mr.reviewers.map(reviewer => {
    const authoredThreads = discussions.filter(
      d => d.notes[0]?.author.id === reviewer.id
    );
    return {
      reviewer,
      commentCount: authoredThreads.length,
      discussions: authoredThreads
    };
  });
}

/**
 * Payload for a `notification` event emitted by the server to connected clients.
 *
 * Rules are intentionally simple for Phase A6 (prefs stubbed).
 * When per-user preferences land (Phase B), the server will evaluate a proper
 * rules engine before deciding whether to emit this event.
 */
export interface ServerNotification {
  title: string;
  body: string;
  /** Scoped PR id, e.g. "gitlab:mr:12345". Omitted for non-MR notifications. */
  mrId?: string;
  /** Deep-link URL to open when the notification is tapped. */
  webUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Events cursor / cache invalidation (GitLab events API)
// ---------------------------------------------------------------------------

/** What kind of cached thing an event invalidates. */
export type InvalidationKind = 'mr' | 'notes' | 'pipelines' | 'branch';

/** One cache-invalidation hint derived from a forge event. */
export interface InvalidationKey {
  kind: InvalidationKind;
  /** MR iid, branch name, or '*' (all pipelines for the project). */
  ref: string;
  /** The GitLab action_name that caused it. For logging only. */
  cause: string;
}

/**
 * Persistent resume point for the events feed.
 * `since` is for reporting and for computing the day-exclusive `after`
 * request parameter. The dedup key is provider-specific: GitLab uses
 * `lastEventId` as a numeric high-water mark; GitHub uses `seenIds` (a
 * bounded set of recently-seen event ids) and treats `lastEventId` as
 * reporting-only.
 *
 * On-disk compat: readers must treat a persisted cursor whose shape they
 * do not recognize (e.g. a string `lastEventId` read by a GitLab-only
 * reader, or a missing `seenIds`) as absent -- falling back to a cold
 * start -- never as an error.
 */
export interface EventCursor {
  since: string | null;
  /** GitLab: numeric high-water mark. GitHub: the newest seen id, as a string
   *  (reporting only; dedup uses seenIds). */
  lastEventId: number | string | null;
  /** GitHub only: bounded set of recently-seen event ids, oldest first.
   *  Absent on GitLab cursors. */
  seenIds?: string[];
}

/** One delivery from watchEvents: everything fresh since the last tick. */
export interface InvalidationBatch {
  /** Deduped within the tick by kind:ref. Never empty. */
  invalidations: InvalidationKey[];
  /** ISO timestamp of when the tick completed. */
  syncedAt: string;
  /** Post-tick cursor (also delivered via onCursor). */
  cursor: EventCursor;
}

/**
 * Health of a watchEvents loop. NOT purely state-transition-triggered:
 * `degraded` fires on EVERY failed tick (including consecutive ones), each
 * time with a freshly recomputed `nextRetryAt`, so consumers can always read
 * the latest retry estimate rather than diffing against the previous state.
 * `live` fires once, only on the tick that recovers from a degraded run.
 */
export interface WatchEventsStatus {
  state: 'live' | 'degraded';
  /** Present when degraded. */
  cause?: 'rate-limited' | 'network' | 'http-error';
  /** ISO timestamp of the last successful tick, null before the first. */
  lastSyncedAt: string | null;
  /** ISO timestamp of the next retry attempt. Present when degraded. */
  nextRetryAt?: string;
}

export interface WatchEventsOptions {
  /**
   * Resume point from a previous run. Omit for a cold start: the first tick
   * establishes a cursor (2-day lookback) and fires NO invalidations, since
   * consumers are expected to do a full refresh on boot anyway.
   *
   * Empty-feed cold start: if that first tick finds nothing in the lookback
   * window, the established cursor is still non-null -- it becomes
   * `{ since: <anchor>, lastEventId: null }`, a clock-skew-padded time
   * anchor rather than both fields staying null. Callers persist this
   * exactly like any other cursor (via `onCursor`) and pass it back in on
   * the next resume; passing a cursor with both fields null is equivalent
   * to omitting `cursor` entirely (another cold start).
   */
  cursor?: EventCursor;
  /** Called after every tick that advanced the cursor. Callers persist it. */
  onCursor?: (cursor: EventCursor) => void;
  /**
   * Poll cadence. Default 15_000 on GitLab, 60_000 on GitHub (which asks for
   * that cadence itself, and can raise a given interval further when it asks
   * for a slower one). A ±10% jitter is applied to every tick.
   */
  intervalMs?: number;
  /** State-transition callback (live/degraded). Silent when omitted. */
  onStatus?: (status: WatchEventsStatus) => void;
  /** Events page size. Default 100 (the GitLab cap). */
  perPage?: number;
  /** Max pages walked per tick on a busy feed. Default 5. */
  maxPagesPerTick?: number;
}
