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
  /**
   * Only meaningful for `approvePullRequest`. The HTTP status this
   * provider's API rejects a self-approval attempt with, when it does.
   *
   * `support: 'supported'` says the accept path works, which is only
   * provable with a second identity. Without one, this field lets the
   * harness fall back to a weaker but still real probe -- attempting (and
   * expecting a rejection of) self-approval -- instead of a single
   * `support` value having to mean both "the happy path" and "the fallback
   * that applies when a precondition for the happy path is missing". A
   * provider that has no such rejection (or where the harness has not
   * verified one) leaves this undefined, and the harness skips outright
   * rather than asserting a status it never confirmed.
   */
  selfApprovalRejectionStatus?: number;
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
    support: 'supported',
    capability: 'canApprove',
    selfApprovalRejectionStatus: 422
  },
  unapprovePullRequest: {
    support: 'supported',
    capability: 'canUnapprove',
    note: 'Implemented as a review dismissal, which leaves a DISMISSED review in the list rather than removing the approval record as GitLab does.'
  },
  rebasePullRequest: {
    support: 'unsupported',
    capability: 'canRebase',
    note: 'Permanent. GitHub update-branch merges base into head, which is not a rebase.'
  },
  setAutoMerge: {
    support: 'approximate',
    capability: 'canAutoMerge',
    note: 'setAutoMerge itself works: run 1 armed it and a re-read confirmed autoMergeEnabled. But GitHub refuses enablePullRequestAutoMerge at both ends of the mergeability range -- "clean" (nothing left to wait for) and "unstable" (won\'t queue behind failing/pending checks) -- so the round trip is only provable when a run happens to land the pull request inside the armable window between them. The conformance harness therefore reports inconclusive rather than passing whenever a run misses that window, which three of four live runs did.'
  },
  cancelAutoMerge: {
    support: 'supported',
    capability: 'canAutoMerge',
    note: 'Task 7\'s live spike measured that once armed, GitHub can complete a real merge before a subsequent cancelAutoMerge call lands, if the fixture\'s required check settles first. When that happens the call legitimately fails with "Can\'t disable auto-merge for this pull request"; the conformance harness records that as a skip, not a defect, since there is nothing left to cancel.'
  },
  resolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  unresolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
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
    support: 'supported',
    capability: 'canWatchEvents',
    note: 'polls the repository events feed as an accelerator, not a replacement for a full poll: the feed carries no CI events, so pipelines invalidations never fire on GitHub.'
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
  setAutoMerge: {
    support: 'supported',
    capability: 'canAutoMerge',
    // A note on a plainly-supported entry, which the field's own docstring
    // reserves for divergences, because this one is a divergence in what it
    // takes to OBSERVE the method rather than in what the method does:
    // "auto-merge" is not one behaviour across the two providers, and a
    // reader comparing this row against GitHub's needs to know that before
    // concluding they were tested the same way.
    note: 'Exercised live by runGitLabMutationConformance, which arms it and re-reads autoMergeEnabled. GitLab semantics are "merge when the pipeline succeeds", so arming is only possible while a pipeline is active; the harness commits a sleeping CI job onto its own throwaway source branch to make that precondition deterministic rather than a race against the fixture\'s ~15-second pipelines.'
  },
  cancelAutoMerge: {
    support: 'supported',
    capability: 'canAutoMerge',
    note: 'Exercised live by runGitLabMutationConformance, but only on runs where setAutoMerge actually armed something: with nothing armed, a re-read confirming auto-merge is off is satisfied by a merge request that never had it, so that case is reported as a skip instead.'
  },
  resolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  unresolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  retryPipeline: { support: 'supported', capability: 'canRetryPipeline' },
  retryJob: { support: 'supported', capability: 'canRetryPipeline' },
  fetchJobTrace: { support: 'supported' },
  fetchDownstreamPipeline: {
    support: 'approximate',
    note: 'The bridge branch is not reachable through the declared interface. Task 5\'s live spike built a real parent/child pipeline on the fixture and measured: the bridge job 404s at GET /jobs/:id, GET /pipelines/:id/jobs lists no bridges at all, and fetchDownstreamPipeline(projectPath, jobId) returned null for a genuine bridge with a live downstream pipeline. GitLabProvider can answer it -- fetchJobDetail(projectPath, bridgeId, pipelineId) returned type "bridge" in the same spike -- but only via the third argument that GitProvider.fetchDownstreamPipeline does not declare, so no fixture work can close the gap. Widening the signature to fetchDownstreamPipeline(projectPath, jobId, pipelineId?) is its own ticket. Until then the harness can only assert the non-bridge answer, null.'
  },
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

/**
 * Every `ProviderMethod`, for callers (the coverage assertion in report.ts)
 * that need the full set rather than one provider's expectation. Derived
 * from `GITHUB_EXPECTATIONS` rather than declared separately, since the two
 * tables are already asserted to share the same key set (see
 * live-expectations.test.ts) and a third hand-maintained list would just be
 * one more place for that set to drift.
 */
export const ALL_METHODS: ProviderMethod[] = Object.keys(
  GITHUB_EXPECTATIONS
) as ProviderMethod[];
