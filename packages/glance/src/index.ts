/**
 * @mattstack/glance — GitHub & GitLab API client.
 *
 * Provides provider-agnostic types, REST/GraphQL clients, and real-time
 * ActionCable subscriptions for GitLab. Designed for use in any Node/Bun
 * runtime.
 *
 * @example
 * import { GitLabProvider, ActionCableClient, type PullRequest } from '@mattstack/glance';
 *
 * const provider = new GitLabProvider('https://gitlab.com', token, { logger: console });
 * const prs = await provider.fetchPullRequests();
 */

// ── Compile-time guards ───────────────────────────────────────────────────────
// providerConformance.ts fails `tsc` when a provider implements a GitProvider
// method with fewer parameters than the interface declares (MAT-13). It emits
// no runtime code, so naming one of its types is what keeps it in the build
// graph: delete the file or drop it from tsconfig's `include` and this line
// breaks, rather than the guard silently switching itself off.
import type { ProviderParameterDrift } from './providerConformance.ts';
type _ProvidersConform = ProviderParameterDrift;

// ── Domain types ──────────────────────────────────────────────────────────────
export type {
  PullRequest,
  PullRequestsSnapshot,
  ApprovalRuleLite,
  MRApprovalRules,
  FetchApprovalRulesOptions,
  MergeabilityCheck,
  CreatePullRequestInput,
  UpdatePullRequestInput,
  MergePullRequestInput,
  MergeMethod,
  ProviderCapabilities,
  BranchProtectionRule,
  Pipeline,
  PipelineJob,
  UserRef,
  Reviewer,
  MergeRequestReviewState,
  ReviewDisplayState,
  DiffStats,
  Discussion,
  Note,
  NoteAuthor,
  NotePosition,
  MRDetail,
  ReviewerSummary,
  FeedEvent,
  FeedSnapshot,
  ServerNotification,
  InvalidationKind,
  InvalidationKey,
  InvalidationBatch,
  EventCursor,
  WatchEventsOptions,
  WatchEventsStatus,
} from './types.ts';
export { getReviewDisplayState, getReviewerSummaries } from './types.ts';
// Exported because mergePullRequest's 405 message now names a
// detailedMergeStatus, and a caller deciding whether to retry needs to classify
// it the way the SDK did rather than keep a copy that can drift (MAT-132). The
// predicate answers that; the list is for callers that need to enumerate the
// values, to render or exhaustively switch on them.
export { TRANSITIONAL_MERGE_STATUSES, isTransitionalMergeStatus } from './types.ts';
export type { MRStatus, MRState, MRDashboardProps, MRDashboardActions } from './types.ts';

// ── Dashboard helpers ─────────────────────────────────────────────────────────
export { getMRDashboardProps, createDashboard } from './MRDashboard.ts';
export type { Dashboard, DashboardGroup, CreateDashboardOptions } from './MRDashboard.ts';

// ── Provider interface ────────────────────────────────────────────────────────
export type {
  GitProvider,
  FetchPullRequestsOptions,
  FetchPullRequestsWarning,
} from './GitProvider.ts';
// `warningTarget` is exported because `FetchPullRequestsWarning.target`'s
// documentation tells a consumer to match on it by building the string with
// this function rather than interpolating its own, which it cannot do unless
// the function is reachable from the package entry point.
export { parseRepoId, repoIdProvider, warningTarget } from './GitProvider.ts';

// ── Logger ────────────────────────────────────────────────────────────────────
export type { ForgeLogger } from './logger.ts';
export { noopLogger } from './logger.ts';

// ── Instrumentation ──────────────────────────────────────────────────────────
export type { RequestInfo, OnRequestHook } from './instrumentation.ts';

// ── Errors ───────────────────────────────────────────────────────────────────
// Exported as a value, not a type: the point of it is the `instanceof` check
// that lets a caller tell a rejected write from a write it cannot read back.
export { ReadBackFailedError } from './errors.ts';

// ── Providers ─────────────────────────────────────────────────────────────────
export {
  GitLabProvider,
  parseGitLabRepoId,
  MR_DASHBOARD_FRAGMENT,
  // The draft marker is GitLab's transport for draft state, and consumers
  // rendering their own draft affordance or composing an update title need
  // the same marker set the SDK strips and writes, not a copy that can
  // drift (MAT-157).
  stripDraftPrefix,
  draftTitle,
} from './GitLabProvider.ts';
export { GitHubProvider } from './GitHubProvider.ts';
export { createProvider, SUPPORTED_PROVIDERS } from './providers.ts';
export type { ProviderSlug } from './providers.ts';

// ── GitLab real-time ──────────────────────────────────────────────────────────
export { ActionCableClient } from './ActionCableClient.ts';
export type { ActionCableCallbacks } from './ActionCableClient.ts';

// ── Realtime watcher (generic self-healing subscribe + poll) ──────────────────
export { createRealtimeWatcher } from './RealtimeWatcher.ts';
export type {
  RealtimeWatcherOptions,
  WatcherSubscribeCallbacks,
  WatcherStatus,
} from './RealtimeWatcher.ts';

// ── Events cursor (GitLab freshness feed) ─────────────────────────────────────
export { EventsPoller, classifyEvent } from './EventsPoller.ts';
export type { GitLabEvent, FetchEvents, TickResult, EventsPollerOptions } from './EventsPoller.ts';
export { startEventsWatcher, startWatcherLoop } from './EventsWatcher.ts';
export type { LoopTick } from './EventsWatcher.ts';

// ── Events cursor (GitHub repo events feed) ───────────────────────────────────
export { GitHubEventsPoller, classifyGitHubEvent, normalizeBranchRef } from './GitHubEventsPoller.ts';
export type {
  GitHubEvent,
  FetchGitHubEventsPage,
  GitHubTickResult,
  GitHubEventsPollerOptions,
} from './GitHubEventsPoller.ts';

// ── GitLab detail + mutations ─────────────────────────────────────────────────
export { MRDetailFetcher } from './MRDetailFetcher.ts';
export { NoteMutator } from './NoteMutator.ts';
export type { CreatedNote } from './NoteMutator.ts';
