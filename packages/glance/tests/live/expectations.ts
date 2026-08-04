/**
 * What each provider owes a caller, per GitProvider method.
 *
 * `Record<ProviderMethod, Expectation>` is exhaustive, so adding a method to
 * GitProvider fails `tsc` here until both providers declare what it does.
 * That is deliberate: MAT-13 and MAT-14 both shipped because a method could
 * land GitHub-shaped or GitLab-shaped with nothing forcing the question.
 */

import type { GitProvider } from '../../src/GitProvider.ts';
import type { ProviderCapabilities } from '../../src/types.ts';

export type Support = 'supported' | 'unsupported' | 'approximate' | 'absent';

export interface Expectation {
  /**
   * `absent` means the optional interface method is not implemented at all,
   * so the property is `undefined` rather than a function that throws. That
   * is a distinct failure mode: callers feature-detect with `provider.x?.()`
   * and silently take a fallback path, which is why it needs its own state
   * rather than being folded into `unsupported`.
   */
  support: Support;
  /** The capability flag this method is gated on, when it has one. */
  capability?: keyof ProviderCapabilities;
  /** Required for anything not plainly `supported`. Explains the divergence. */
  note?: string;
}

type AnyMethod = (...args: never[]) => unknown;

export type ProviderMethod = {
  [K in keyof GitProvider]-?: NonNullable<GitProvider[K]> extends AnyMethod ? K : never;
}[keyof GitProvider];

export const GITHUB_EXPECTATIONS: Record<ProviderMethod, Expectation> = {
  validateToken: { support: 'supported' },
  fetchPullRequests: { support: 'supported' },
  fetchSingleMR: { support: 'supported' },
  fetchPullRequestByBranch: { support: 'supported' },
  fetchPullRequestsByBranches: {
    support: 'absent',
    note: 'Not implemented on GitHub, so callers fall back to sequential fetchPullRequestByBranch calls: N round-trips where GitLab batches into one. A performance gap rather than a correctness one.'
  },
  createPullRequest: { support: 'supported' },
  updatePullRequest: { support: 'supported' },
  fetchBranchProtectionRules: { support: 'supported' },
  deleteBranch: { support: 'supported' },
  fetchMRDiscussions: { support: 'supported' },
  mergePullRequest: { support: 'supported', capability: 'canMerge' },
  approvePullRequest: {
    support: 'approximate',
    capability: 'canApprove',
    note: 'GitHub rejects self-approval with 422. With one identity the accept path is unverifiable, so the harness asserts the rejection instead.'
  },
  unapprovePullRequest: {
    support: 'unsupported',
    capability: 'canUnapprove',
    note: 'Phase 4 implements this via the review dismissal endpoint.'
  },
  rebasePullRequest: {
    support: 'unsupported',
    capability: 'canRebase',
    note: 'Permanent. GitHub update-branch merges base into head, which is not a rebase.'
  },
  setAutoMerge: {
    support: 'unsupported',
    capability: 'canAutoMerge',
    note: 'Phase 4 implements this via GraphQL enablePullRequestAutoMerge.'
  },
  cancelAutoMerge: {
    support: 'unsupported',
    capability: 'canAutoMerge',
    note: 'Phase 4 implements this via GraphQL disablePullRequestAutoMerge.'
  },
  resolveDiscussion: {
    support: 'unsupported',
    capability: 'canResolveDiscussions',
    note: 'MAT-27. Phase 4 implements this via GraphQL resolveReviewThread.'
  },
  unresolveDiscussion: {
    support: 'unsupported',
    capability: 'canResolveDiscussions',
    note: 'MAT-27. Phase 4 implements this via GraphQL unresolveReviewThread.'
  },
  retryPipeline: { support: 'supported', capability: 'canRetryPipeline' },
  retryJob: { support: 'supported', capability: 'canRetryPipeline' },
  fetchJobTrace: { support: 'supported' },
  fetchDownstreamPipeline: {
    support: 'approximate',
    note: 'Always null. GitHub Actions has no child pipeline concept, so absence is the correct answer rather than a gap.'
  },
  fetchJobDetail: {
    support: 'approximate',
    note: 'Always returns { type: "trace" }. GitHub Actions has no bridge job concept.'
  },
  requestReReview: { support: 'supported', capability: 'canRequestReReview' },
  restRequest: { support: 'supported' },
  watchMR: {
    support: 'unsupported',
    note: 'Permanent. GitHub has no push channel equivalent to ActionCable.'
  },
  watchEvents: {
    support: 'absent',
    capability: 'canWatchEvents',
    note: 'Not implemented on GitHub: the property is undefined, not a throwing stub. Phase 4 implements it by polling the repository events feed.'
  }
};

export const GITLAB_EXPECTATIONS: Record<ProviderMethod, Expectation> = {
  validateToken: { support: 'supported' },
  fetchPullRequests: { support: 'supported' },
  fetchSingleMR: { support: 'supported' },
  fetchPullRequestByBranch: { support: 'supported' },
  fetchPullRequestsByBranches: { support: 'supported' },
  createPullRequest: { support: 'supported' },
  updatePullRequest: { support: 'supported' },
  fetchBranchProtectionRules: { support: 'supported' },
  deleteBranch: { support: 'supported' },
  fetchMRDiscussions: { support: 'supported' },
  mergePullRequest: { support: 'supported', capability: 'canMerge' },
  approvePullRequest: { support: 'supported', capability: 'canApprove' },
  unapprovePullRequest: { support: 'supported', capability: 'canUnapprove' },
  rebasePullRequest: { support: 'supported', capability: 'canRebase' },
  setAutoMerge: { support: 'supported', capability: 'canAutoMerge' },
  cancelAutoMerge: { support: 'supported', capability: 'canAutoMerge' },
  resolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  unresolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  retryPipeline: { support: 'supported', capability: 'canRetryPipeline' },
  retryJob: { support: 'supported', capability: 'canRetryPipeline' },
  fetchJobTrace: { support: 'supported' },
  fetchDownstreamPipeline: { support: 'supported' },
  fetchJobDetail: { support: 'supported' },
  requestReReview: { support: 'supported', capability: 'canRequestReReview' },
  restRequest: { support: 'supported' },
  watchMR: { support: 'supported' },
  watchEvents: { support: 'supported', capability: 'canWatchEvents' }
};

export function expectationFor(
  provider: 'github' | 'gitlab',
  method: ProviderMethod
): Expectation {
  return provider === 'github' ? GITHUB_EXPECTATIONS[method] : GITLAB_EXPECTATIONS[method];
}
