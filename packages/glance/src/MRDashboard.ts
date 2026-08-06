import type {
  DashboardUpdate,
  MRDashboardActions,
  MRDashboardProps,
  MergePullRequestInput,
  PullRequest,
  Reviewer,
  UserRef
} from './types.ts';
import { isTransitionalMergeStatus } from './types.ts';
import type { FetchPullRequestsWarning, GitProvider } from './GitProvider.ts';
import { repoIdProvider, warningTarget } from './GitProvider.ts';
import { createRealtimeWatcher, type WatcherStatus } from './RealtimeWatcher.ts';

/**
 * Derives a fully-rendered, headless-UI-ready props object from a raw PullRequest.
 *
 * All fields are pre-computed — no conditional logic needed in the component layer.
 * Button labels, disabled states, loading spinners, and blocker flags are all resolved.
 *
 * Works with any source that returns PullRequest:
 *   - watchMR callback (realtime)
 *   - fetchSingleMR (one-shot)
 *   - fetchPullRequests list items (for MR cards)
 *
 * @example
 * provider.watchMR(path, iid, userId, (mr) => {
 *   const props = getMRDashboardProps(mr);
 *   renderDashboard(props);
 * });
 */
export function getMRDashboardProps(
  mr: PullRequest,
  connection: MRDashboardProps['connection'] = 'idle'
): MRDashboardProps {
  // ── Pipeline breakdown ────────────────────────────────────────────────────
  const pipelineJobs = mr.pipeline?.jobs ?? [];
  const passing = pipelineJobs.filter(j => j.status === 'success').length;
  const failing = pipelineJobs.filter(
    j => j.status === 'failed' && !j.allowFailure
  ).length;
  const running = pipelineJobs.filter(
    j => j.status === 'running' || j.status === 'pending'
  ).length;
  const hasWarnings = pipelineJobs.some(
    j => j.status === 'failed' && j.allowFailure
  );

  // ── Reviewer activity breakdown ───────────────────────────────────────────
  // GitLab clears the `reviewers` list after an MR is merged/closed, but
  // keeps `approvedBy` populated.  When we have no reviewers on a terminal-
  // state MR, synthesize Reviewer entries from approvedBy so the UI can
  // still show who approved.
  const isTerminal = mr.state === 'merged' || mr.state === 'closed';
  const effectiveReviewers: Reviewer[] =
    mr.reviewers.length > 0 || !isTerminal
      ? mr.reviewers
      : (mr.approvedBy ?? []).map((u): Reviewer => ({
          ...u,
          reviewState: 'APPROVED'
        }));

  const haveActed = effectiveReviewers.filter(
    r =>
      r.reviewState === 'APPROVED' ||
      r.reviewState === 'REVIEWED' ||
      r.reviewState === 'REQUESTED_CHANGES'
  ).length;
  const havePending = effectiveReviewers.filter(
    r => r.reviewState === 'REVIEW_STARTED'
  ).length;
  const haveNotStarted = effectiveReviewers.filter(
    r =>
      r.reviewState === 'UNREVIEWED' ||
      r.reviewState === 'UNAPPROVED' ||
      r.reviewState === null
  ).length;

  // ── Blockers ──────────────────────────────────────────────────────────────
  const isDraft = mr.draft;
  const hasConflicts = mr.conflicts;
  const needsRebase = mr.shouldBeRebased || (mr.divergedCommitsCount ?? 0) > 0;
  const pipelineFailing = mr.pipeline?.status === 'failed';
  const pipelineRunning =
    mr.pipeline?.status === 'running' || mr.pipeline?.status === 'pending';
  const awaitingApprovals = !mr.approved;
  // An unknown thread count (null) is not a blocker: we cannot claim threads
  // are outstanding any more than we can claim they are all resolved.
  const hasUnresolvedDiscussions = (mr.unresolvedThreadCount ?? 0) > 0;
  const hasMergeError = mr.mergeError != null;

  const anyBlocker =
    isDraft ||
    hasConflicts ||
    needsRebase ||
    pipelineFailing ||
    awaitingApprovals ||
    hasUnresolvedDiscussions ||
    hasMergeError;

  // ── Simplified cross-platform status ─────────────────────────────────────
  // GitLab runs async merge-checks after pipeline completion. During this window
  // it returns one of TRANSITIONAL_MERGE_STATUSES rather than 'mergeable',
  // causing a false BLOCKED flash. Treat these transitional states
  // as "not yet decided" and fall back to our own blocker signals.
  // The set is shared with GitLabProvider's merge-refusal diagnostics because
  // both are answering "has GitLab decided yet?" about the same strings, and
  // it includes 'preparing' because GitLab emits that ahead of 'unchecked' on
  // a just-created MR, the earliest part of this same window.
  const isCheckingMergeability = isTransitionalMergeStatus(mr.detailedMergeStatus);
  const isReady = mr.detailedMergeStatus === 'mergeable'
    || (isCheckingMergeability && !isDraft && !hasConflicts && !pipelineFailing);
  let status: MRDashboardProps['status'];
  if (mr.state === 'merged') status = 'merged';
  else if (mr.state === 'closed') status = 'closed';
  else if (isDraft) status = 'draft';
  else if (isReady) status = 'mergeable';
  else status = 'blocked';

  // ── In-progress states ────────────────────────────────────────────────────
  const isMerging = mr.mergeOngoing;
  const isRebasing = mr.rebaseInProgress;

  // Genuine approval only: GitLab reports approved=true for MRs with no
  // applicable approval rules (stack MRs targeting a parent branch), before
  // anyone has looked at them. An approval nobody gave is not an approval.
  // Mergeability keeps reading the raw flag via blockers.awaitingApprovals.
  const genuinelyApproved =
    mr.approved && !(mr.approvalsRequired === 0 && mr.approvedBy.length === 0);

  return {
    // Identity
    provider: repoIdProvider(mr.repositoryId),
    iid: mr.iid,
    title: mr.title,
    webUrl: mr.webUrl,
    state: mr.state === 'merged' ? 'merged'
      : mr.state === 'closed' ? 'closed'
      : isDraft ? 'draft'
      : 'opened' as MRDashboardProps['state'],
    isDraft,
    author: mr.author,
    assignees: mr.assignees,
    createdAt: mr.createdAt,

    // Branch
    sourceBranch: mr.sourceBranch,
    targetBranch: mr.targetBranch,
    isStacked: mr.isStacked ?? false,

    // Diff
    diff: mr.diffStats
      ? {
          additions: mr.diffStats.additions,
          deletions: mr.diffStats.deletions,
          filesChanged: mr.diffStats.filesChanged
        }
      : null,

    // Pipeline
    pipeline: mr.pipeline
      ? {
          id: mr.pipeline.id,
          status: mr.pipeline.status,
          passing,
          failing,
          running,
          total: pipelineJobs.length,
          hasWarnings,
          jobs: pipelineJobs
        }
      : null,

    // Reviews
    reviews: {
      required: mr.approvalsRequired,
      given: mr.approvedBy.length,
      remaining: mr.approvalsLeft,
      isApproved: genuinelyApproved,
      approvedBy: mr.approvedBy as Reviewer[],
      reviewers: effectiveReviewers,
      totalAssigned: effectiveReviewers.length,
      haveActed,
      havePending,
      haveNotStarted
    },

    // Status
    status,
    statusDetail: mr.detailedMergeStatus ?? '',
    isReady,
    isCheckingMergeability,

    // Spinner states
    isMerging,
    isRebasing,
    isLoading: isMerging || isRebasing,

    // Merge button
    mergeButton: {
      visible: mr.state === 'opened' && !isDraft,
      disabled: !isReady || isMerging,
      loading: isMerging,
      label: isMerging ? 'Merging...' : 'Merge'
    },

    // Auto-merge button
    autoMergeButton: {
      visible: mr.state === 'opened' && !isDraft,
      isActive: mr.autoMergeEnabled,
      strategy: mr.autoMergeStrategy,
      setBy: mr.mergeUser,
      label: mr.autoMergeEnabled ? 'Auto-merge enabled' : 'Auto-merge',
      cancelLabel: 'Cancel auto-merge'
    },

    // Rebase button
    rebaseButton: {
      visible: needsRebase && mr.state === 'opened',
      loading: isRebasing,
      label: isRebasing ? 'Rebasing...' : 'Rebase',
      behindBy: mr.divergedCommitsCount ?? 0
    },

    // Blockers
    blockers: {
      isDraft,
      hasConflicts,
      needsRebase,
      pipelineFailing,
      pipelineRunning,
      awaitingApprovals,
      hasUnresolvedDiscussions,
      hasMergeError,
      mergeError: mr.mergeError,
      any: anyBlocker
    },

    connection
  };
}

/**
 * A live MR dashboard binding for a single MR.
 *
 * Returned by `createDashboard()` when `mrIid` is a number.
 * - `actions` — pre-bound mutations, available immediately
 * - `subscribe(cb)` — register a listener for real-time MR updates
 * - `dispose()` — stop the subscription and clean up
 */
export interface Dashboard {
  /** Pre-bound mutation methods for this MR. Stable reference. */
  actions: MRDashboardActions;
  /** True until the first data payload arrives from the subscription. */
  readonly isInitialLoading: boolean;
  /**
   * Register a listener for real-time MR updates.
   * The callback receives the latest `MRDashboardProps` on every change.
   */
  subscribe: (listener: (mr: MRDashboardProps) => void) => void;
  /**
   * Register a listener for connection status changes.
   * Fires when WebSocket connects/disconnects, fetch fails/recovers.
   */
  onStatusChange: (listener: (status: WatcherStatus) => void) => void;
  /** Stop the real-time subscription and clean up. */
  dispose: () => void;
}

/**
 * A live MR dashboard binding for multiple MRs.
 *
 * Returned by `createDashboard()` when `mrIid` is an array.
 * All MRs share a single WebSocket connection.
 */
export interface DashboardGroup {
  /** Get pre-bound actions for a specific MR by IID. */
  actionsFor: (iid: number) => MRDashboardActions;
  /** True until the first data payload arrives from the subscription. */
  readonly isInitialLoading: boolean;
  /**
   * Register a listener for real-time updates across all MRs.
   * The callback receives a Map of IID → MRDashboardProps on any change.
   */
  subscribe: (listener: (mrs: Map<number, MRDashboardProps>) => void) => void;
  /**
   * Update the set of tracked IIDs — React setState style.
   *
   * Accepts either a new array or an updater function that receives the
   * current IID list and returns the new list. Tears down watchers for
   * removed IIDs, spins up watchers for added IIDs, prunes stale state,
   * and re-fetches. No-ops if the set is unchanged.
   *
   * @example
   * // Overwrite entirely
   * group.updateIids([42, 43, 44]);
   *
   * // Functional update — add an IID
   * group.updateIids(prev => [...prev, 45]);
   *
   * // Functional update — remove an IID
   * group.updateIids(prev => prev.filter(id => id !== 43));
   */
  updateIids: (iidsOrUpdater: number[] | ((prev: number[]) => number[])) => void;
  /**
   * Register a listener for connection status changes.
   */
  onStatusChange: (listener: (status: WatcherStatus) => void) => void;
  /**
   * Register a listener for per-row degradation: one MR in the group did
   * not refresh cleanly on a batch fetch that otherwise succeeded for the
   * rest.
   *
   * Fires in two different situations, both worth the same signal to a
   * consumer: the MR can be missing from `subscribe`'s Map entirely (a
   * `reviews`/`detail` failure drops it rather than showing wrong data), or
   * it can be present with one field silently at its "unknown" value
   * because its `checks`/`threads` fetch failed -- `pipeline: null` on the
   * `PullRequest`, which reads as "no CI"; `unresolvedThreadCount: null`,
   * which `getMRDashboardProps`'s `?? 0` folds into "no unresolved
   * discussions" for the rendered props, not merely "count unknown."
   * `subscribe`'s Map has no room to say either on its own -- a missing,
   * stale, or falsely-clean entry all look identical to one nothing ever
   * went wrong with -- which is exactly why this fires for both rather
   * than only the "missing" case.
   *
   * Optional (unlike `onStatusChange`, added earlier) even though the real
   * implementation always provides it: `DashboardGroup` is a published,
   * versioned interface, and a consumer with their own test double for it
   * (mocking `createDashboard`'s return value, a normal thing to do around
   * a hook) would fail to compile against a new required member on an
   * otherwise-additive change. Optional costs nothing here -- every real
   * `DashboardGroup` still has it -- and avoids that break.
   */
  onWarning?: (listener: (iid: number, warning: FetchPullRequestsWarning) => void) => void;
  /** Stop all subscriptions and clean up. */
  dispose: () => void;
}

/** Options for `createDashboard`. */
export interface CreateDashboardOptions {
  provider: GitProvider;
  projectPath: string;
  /** A single MR IID or an array of IIDs to watch. */
  mrIid?: number | number[];
  /**
   * Source branch name — alternative to `mrIid`.
   * The dashboard resolves the IID via `fetchPullRequestByBranch` and
   * re-resolves on each poll, so it picks up new MRs on the same branch.
   */
  branch?: string;
  userId: number | null;
}

// ── Overloads ─────────────────────────────────────────────────────────────────

/** Create a live dashboard for a single MR by IID. */
export function createDashboard(
  options: Omit<CreateDashboardOptions, 'mrIid' | 'branch'> & { mrIid: number }
): Dashboard;
/** Create a live dashboard for multiple MRs (shared WebSocket). */
export function createDashboard(
  options: Omit<CreateDashboardOptions, 'mrIid' | 'branch'> & { mrIid: number[] }
): DashboardGroup;
/** Create a live dashboard by source branch name. */
export function createDashboard(
  options: Omit<CreateDashboardOptions, 'mrIid' | 'branch'> & { branch: string }
): Dashboard;

/**
 * Create a live MR dashboard — pre-bound actions + real-time subscription.
 *
 * Accepts a single IID, an array of IIDs, or a branch name:
 *
 * @example
 * // Single MR by IID
 * const { actions, subscribe, dispose } = createDashboard({
 *   provider, projectPath: 'group/project', mrIid: 42, userId
 * });
 * subscribe((mr) => renderUI(mr, actions));
 *
 * @example
 * // Multiple MRs — one shared WebSocket
 * const { actionsFor, subscribe, dispose } = createDashboard({
 *   provider, projectPath: 'group/project', mrIid: [42, 43, 44], userId
 * });
 * subscribe((mrs) => {
 *   for (const [iid, mr] of mrs) renderRow(mr, actionsFor(iid));
 * });
 *
 * @example
 * // By branch — resolves IID automatically
 * const { actions, subscribe, dispose } = createDashboard({
 *   provider, projectPath: 'group/project', branch: 'feat/my-feature', userId
 * });
 */
export function createDashboard(
  options: CreateDashboardOptions
): Dashboard | DashboardGroup {
  const { provider, projectPath, mrIid, branch, userId } = options;

  if (branch) {
    return createBranchDashboard(provider, projectPath, branch, userId);
  }

  if (Array.isArray(mrIid)) {
    return createDashboardGroup(provider, projectPath, mrIid, userId);
  }
  return createSingleDashboard(provider, projectPath, mrIid!, userId);
}

// ── Single MR ─────────────────────────────────────────────────────────────────

function buildActions(
  provider: GitProvider,
  projectPath: string,
  iid: number
): MRDashboardActions {
  return {
    merge: (input?: MergePullRequestInput) =>
      provider.mergePullRequest(projectPath, iid, input),
    rebase: () => provider.rebasePullRequest(projectPath, iid),
    approve: () => provider.approvePullRequest(projectPath, iid),
    unapprove: () => provider.unapprovePullRequest(projectPath, iid),
    setAutoMerge: () => provider.setAutoMerge(projectPath, iid),
    cancelAutoMerge: () => provider.cancelAutoMerge(projectPath, iid),
    retryPipeline: (pipelineId: number) =>
      provider.retryPipeline(projectPath, pipelineId),
    retryJob: (jobId: number) =>
      provider.retryJob(projectPath, jobId),
    fetchJobTrace: (jobId: number) =>
      provider.fetchJobTrace(projectPath, jobId),
    fetchDownstreamPipeline: (jobId: number) =>
      provider.fetchDownstreamPipeline(projectPath, jobId),
    fetchJobDetail: (jobId: number, pipelineId?: number) =>
      provider.fetchJobDetail(projectPath, jobId, pipelineId),
    requestReReview: (usernames?: string[]) =>
      provider.requestReReview(projectPath, iid, usernames),
    toggleDraft: (draft: boolean) =>
      provider.updatePullRequest(projectPath, iid, { draft }),
    can: provider.capabilities
  };
}

function createSingleDashboard(
  provider: GitProvider,
  projectPath: string,
  mrIid: number,
  userId: number | null
): Dashboard {
  const actions = buildActions(provider, projectPath, mrIid);
  let disposeWatcher: (() => void) | null = null;
  let statusListener: ((status: WatcherStatus) => void) | null = null;
  let connectionState: MRDashboardProps['connection'] = 'connecting';
  let _isInitialLoading = true;

  return {
    actions,
    get isInitialLoading() { return _isInitialLoading; },
    subscribe(listener: (mr: MRDashboardProps) => void) {
      disposeWatcher = provider.watchMR(
        projectPath,
        mrIid,
        userId,
        (pr: PullRequest) => {
          _isInitialLoading = false;
          listener(getMRDashboardProps(pr, connectionState));
        }
      );
    },
    onStatusChange(listener: (status: WatcherStatus) => void) {
      statusListener = (s) => {
        connectionState = s.connection;
        listener(s);
      };
    },
    dispose() {
      disposeWatcher?.();
      disposeWatcher = null;
      statusListener = null;
    }
  };
}

// ── Branch-based single MR ────────────────────────────────────────────────────

function createBranchDashboard(
  provider: GitProvider,
  projectPath: string,
  branch: string,
  userId: number | null
): Dashboard {
  let resolvedIid: number | null = null;
  let actions: MRDashboardActions | null = null;
  let disposeWatcher: (() => void) | null = null;
  let statusListener: ((status: WatcherStatus) => void) | null = null;
  let connectionState: MRDashboardProps['connection'] = 'connecting';
  let _isInitialLoading = true;

  // Lazy-build actions once we know the IID
  const getActions = (): MRDashboardActions => {
    if (!actions) {
      throw new Error(`Dashboard for branch '${branch}' has not resolved an MR yet`);
    }
    return actions;
  };

  return {
    get actions() { return getActions(); },
    get isInitialLoading() { return _isInitialLoading; },
    subscribe(listener: (mr: MRDashboardProps) => void) {
      disposeWatcher = createRealtimeWatcher<PullRequest>({
        fetch: async () => {
          const pr = await provider.fetchPullRequestByBranch(projectPath, branch, 'all');
          if (pr && pr.iid !== resolvedIid) {
            resolvedIid = pr.iid;
            actions = buildActions(provider, projectPath, pr.iid);
          }
          return pr;
        },
        subscribe: ({ onConnected }) => {
          // No ActionCable for branch-based — IID not known upfront.
          onConnected();
          return () => {};
        },
        onUpdate: (pr) => {
          _isInitialLoading = false;
          listener(getMRDashboardProps(pr, connectionState));
        },
        onStatusChange: (s) => {
          connectionState = s.connection;
          statusListener?.(s);
        },
        options: {
          logContext: `dashboard-branch:${projectPath}:${branch}`
        }
      });
    },
    onStatusChange(listener: (status: WatcherStatus) => void) {
      statusListener = listener;
    },
    dispose() {
      disposeWatcher?.();
      disposeWatcher = null;
      statusListener = null;
    }
  };
}

// ── Multi-MR ──────────────────────────────────────────────────────────────────

/**
 * One batched `fetchPullRequests({ iids })` call, split into what came back
 * and which requested IIDs `onWarning` named, with why.
 *
 * Exported (rather than kept as a closure inside `createDashboardGroup`) so
 * the degradation split can be tested directly against a fake provider,
 * without driving `createRealtimeWatcher`'s timers to reach it.
 *
 * `degraded` is keyed by every iid a warning named, present in `prs` or
 * not -- it is not, despite an earlier version of this function assuming
 * so, the same set as "missing from `prs`". A `reviews`/`detail` failure
 * drops the PR entirely (missing from `prs`, present in `degraded`); a
 * `checks`/`threads` failure keeps the PR (present in `prs` with that one
 * field at its "unknown" value, ALSO present in `degraded`). Skipping the
 * lookup whenever `prs.has(iid)` -- the earlier version's mistake -- made
 * every `checks`/`threads` warning unreachable: `DashboardGroup.onWarning`
 * never fired for either, because the PR they are about is never missing.
 * Both are "this row is not what it looks like," which is what a consumer
 * needs to know regardless of whether the row is absent or just incomplete.
 */
export async function fetchDashboardBatch(
  provider: GitProvider,
  projectPath: string,
  iids: number[]
): Promise<{
  prs: Map<number, PullRequest>;
  degraded: Map<number, FetchPullRequestsWarning>;
}> {
  const warnings: FetchPullRequestsWarning[] = [];
  const fetched = await provider.fetchPullRequests({
    iids,
    projectPath,
    state: ['opened', 'merged', 'closed'],
    onWarning: w => warnings.push(w)
  });

  const prs = new Map<number, PullRequest>();
  for (const pr of fetched) prs.set(pr.iid, pr);

  const warningByTarget = new Map(warnings.map(w => [w.target, w]));
  const degraded = new Map<number, FetchPullRequestsWarning>();
  for (const iid of iids) {
    // `warningTarget` -- the same function every producer in GitHubProvider
    // builds `target` with -- not a hand-rolled template string here. A
    // `checks` warning once used `owner/repo@sha` while this lookup used
    // `owner/repo#iid`; both were "obviously correct" read on their own,
    // and neither side's own tests caught that they had quietly stopped
    // agreeing. Reading the join key from one function removes that as a
    // way for a future source to repeat it.
    const warning = warningByTarget.get(warningTarget(projectPath, iid));
    if (warning) degraded.set(iid, warning);
  }

  return { prs, degraded };
}

function createDashboardGroup(
  provider: GitProvider,
  projectPath: string,
  initialIids: number[],
  userId: number | null
): DashboardGroup {
  // Mutable state — updated by updateIids
  let currentIids = [...initialIids];

  // Pre-build actions for each MR — lazily extended by updateIids
  const actionsMap = new Map<number, MRDashboardActions>();
  for (const iid of currentIids) {
    actionsMap.set(iid, buildActions(provider, projectPath, iid));
  }

  // Live state map — updated as the watcher fires
  const state = new Map<number, MRDashboardProps>();
  let listener: ((mrs: Map<number, MRDashboardProps>) => void) | null = null;
  let disposeWatcher: (() => void) | null = null;
  let statusListener: ((status: WatcherStatus) => void) | null = null;
  let warningListener:
    | ((iid: number, warning: FetchPullRequestsWarning) => void)
    | null = null;
  let connectionState: MRDashboardProps['connection'] = 'connecting';
  let _isInitialLoading = true;

  /**
   * Batched fetch: uses fetchPullRequests with iids option for a single
   * GraphQL call. Includes all states so merged/closed MRs are visible.
   *
   * No try/catch here: `createRealtimeWatcher.runFetch` already wraps this
   * call and turns a rejection into `lastError`/`consecutiveErrors` on
   * `onStatusChange`, which is a real signal a consumer can act on. Catching
   * to `null` here instead -- the previous behavior -- discarded that
   * signal: one PR's failed reviews fetch used to reject the whole batch
   * (`fetchPullRequests` had nowhere else to put that failure), and this
   * function turned that single-row problem into "nothing updated, and
   * nothing said why." `fetchPullRequests` now excludes just the PR it
   * could not verify instead of rejecting for it, so the row-level case no
   * longer reaches here as an exception at all; `fetchDashboardBatch`
   * reports it (and a `checks`/`threads` failure, which keeps the PR
   * present rather than excluding it) through `degraded`, forwarded to
   * `warningListener` below.
   */
  const batchFetch = async (): Promise<Map<number, PullRequest> | null> => {
    const { prs, degraded } = await fetchDashboardBatch(
      provider,
      projectPath,
      currentIids
    );
    for (const [iid, warning] of degraded) {
      warningListener?.(iid, warning);
    }
    return prs;
  };

  /** Start (or restart) the watcher for the current IID set. */
  const startWatcher = () => {
    // Tear down existing watcher
    disposeWatcher?.();
    disposeWatcher = null;

    if (!listener || currentIids.length === 0) return;

    disposeWatcher = createRealtimeWatcher<Map<number, PullRequest>>({
      fetch: batchFetch,

      subscribe: ({ onConnected }) => {
        const subs: (() => void)[] = [];
        for (const iid of currentIids) {
          const dispose = provider.watchMR(
            projectPath, iid, userId,
            () => { /* data comes from batched fetch, not individual watchers */ }
          );
          subs.push(dispose);
        }
        onConnected();

        return () => {
          for (const d of subs) d();
        };
      },

      onUpdate: (freshMap) => {
        _isInitialLoading = false;
        for (const [iid, pr] of freshMap) {
          state.set(iid, getMRDashboardProps(pr, connectionState));
        }
        listener?.(state);
      },

      onStatusChange: (s) => {
        connectionState = s.connection;
        statusListener?.(s);
      },

      options: {
        logContext: `dashboard-group:${projectPath}`
      }
    });
  };

  return {
    actionsFor(iid: number) {
      // Lazily build actions for IIDs that were added after initial creation
      let a = actionsMap.get(iid);
      if (!a) {
        if (!currentIids.includes(iid)) {
          throw new Error(`No dashboard for MR !${iid}`);
        }
        a = buildActions(provider, projectPath, iid);
        actionsMap.set(iid, a);
      }
      return a;
    },

    get isInitialLoading() { return _isInitialLoading; },

    subscribe(cb: (mrs: Map<number, MRDashboardProps>) => void) {
      listener = cb;
      startWatcher();
    },

    updateIids(iidsOrUpdater: number[] | ((prev: number[]) => number[])) {
      const newIids = typeof iidsOrUpdater === 'function'
        ? iidsOrUpdater(currentIids)
        : iidsOrUpdater;

      // Dedupe and sort for stable comparison
      const dedupedNew = [...new Set(newIids)];
      const dedupedOld = [...new Set(currentIids)];
      if (
        dedupedNew.length === dedupedOld.length &&
        dedupedNew.sort().every((id, i) => id === dedupedOld.sort()[i])
      ) {
        return; // No change — skip restart
      }

      // Prune stale state entries for removed IIDs
      const newSet = new Set(dedupedNew);
      for (const iid of state.keys()) {
        if (!newSet.has(iid)) state.delete(iid);
      }

      // Build actions for any new IIDs
      for (const iid of dedupedNew) {
        if (!actionsMap.has(iid)) {
          actionsMap.set(iid, buildActions(provider, projectPath, iid));
        }
      }

      currentIids = dedupedNew;

      // Restart the watcher if we have a subscriber
      if (listener) {
        startWatcher();
      }
    },

    onStatusChange(listener: (status: WatcherStatus) => void) {
      statusListener = listener;
    },

    onWarning(listener: (iid: number, warning: FetchPullRequestsWarning) => void) {
      warningListener = listener;
    },

    dispose() {
      disposeWatcher?.();
      disposeWatcher = null;
      listener = null;
      statusListener = null;
      warningListener = null;
    }
  };
}
