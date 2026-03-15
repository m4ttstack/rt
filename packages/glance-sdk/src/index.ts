/**
 * @workforge/glance-sdk — GitHub & GitLab API client.
 *
 * Provides provider-agnostic types, REST/GraphQL clients, and real-time
 * ActionCable subscriptions for GitLab. Designed for use in any Node/Bun
 * runtime.
 *
 * @example
 * import { GitLabProvider, ActionCableClient, type PullRequest } from '@workforge/glance-sdk';
 *
 * const provider = new GitLabProvider('https://gitlab.com', token, { logger: console });
 * const prs = await provider.fetchPullRequests();
 */

// ── Domain types ──────────────────────────────────────────────────────────────
export type {
  PullRequest,
  PullRequestsSnapshot,
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
  ServerNotification
} from './types.ts';
export { getReviewDisplayState, getReviewerSummaries } from './types.ts';
export type { MRStatus, MRState, MRDashboardProps, MRDashboardActions } from './types.ts';

// ── Dashboard helpers ─────────────────────────────────────────────────────────
export { getMRDashboardProps, createDashboard } from './MRDashboard.ts';
export type { Dashboard, DashboardGroup, CreateDashboardOptions } from './MRDashboard.ts';

// ── Provider interface ────────────────────────────────────────────────────────
export type { GitProvider, FetchPullRequestsOptions } from './GitProvider.ts';
export { parseRepoId, repoIdProvider } from './GitProvider.ts';

// ── Logger ────────────────────────────────────────────────────────────────────
export type { ForgeLogger } from './logger.ts';
export { noopLogger } from './logger.ts';

// ── Providers ─────────────────────────────────────────────────────────────────
export {
  GitLabProvider,
  parseGitLabRepoId,
  MR_DASHBOARD_FRAGMENT
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

// ── GitLab detail + mutations ─────────────────────────────────────────────────
export { MRDetailFetcher } from './MRDetailFetcher.ts';
export { NoteMutator } from './NoteMutator.ts';
export type { CreatedNote } from './NoteMutator.ts';
