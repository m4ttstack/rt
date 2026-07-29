#!/usr/bin/env bun
/**
 * isApproved narrows to genuine approval (stacked MR classification, task 1).
 *
 * GitLab reports `approved: true` for MRs with no applicable approval rules
 * (stack MRs targeting a parent branch, zero required approvals) before
 * anyone has reviewed them. props.reviews.isApproved must only be true for
 * a genuine approval: either non-zero required approvals were met, or at
 * least one approver actually approved.
 */
import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import type { PullRequest, UserRef } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const user = (id: number, username: string): UserRef => ({
  id: `gitlab:user:${id}`,
  username,
  name: username,
  avatarUrl: null,
});

/** Minimal PullRequest stub with safe defaults. */
function stubPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'gitlab:mr:1',
    iid: 1,
    repositoryId: 'gitlab:42',
    title: 'Test MR',
    description: null,
    state: 'merged',
    draft: false,
    conflicts: false,
    webUrl: null,
    sourceBranch: 'feat',
    targetBranch: 'main',
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: user(1, 'author'),
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: true,
    approvedBy: [user(2, 'reviewer1')],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isApproved narrows to genuine approval', () => {
  test('vacuous approval (0 required, 0 approvers) is not approved', () => {
    const props = getMRDashboardProps(
      stubPR({ approved: true, approvalsRequired: 0, approvedBy: [] })
    );
    expect(props.reviews.isApproved).toBe(false);
  });

  test('genuine approval with rules is approved', () => {
    const props = getMRDashboardProps(
      stubPR({ approved: true, approvalsRequired: 1, approvedBy: [user(2, 'reviewer1')] })
    );
    expect(props.reviews.isApproved).toBe(true);
  });

  test('genuine approval with zero required (GitHub shape) is approved', () => {
    const props = getMRDashboardProps(
      stubPR({ approved: true, approvalsRequired: 0, approvedBy: [user(2, 'reviewer1')] })
    );
    expect(props.reviews.isApproved).toBe(true);
  });

  test('unapproved MR stays unapproved regardless of approvers', () => {
    const props = getMRDashboardProps(
      stubPR({ approved: false, approvalsRequired: 2, approvedBy: [user(2, 'reviewer1')] })
    );
    expect(props.reviews.isApproved).toBe(false);
  });

  test('awaitingApprovals blocker still reads the raw flag in the vacuous case', () => {
    const props = getMRDashboardProps(
      stubPR({ approved: true, approvalsRequired: 0, approvedBy: [] })
    );
    expect(props.blockers.awaitingApprovals).toBe(false);
  });
});
