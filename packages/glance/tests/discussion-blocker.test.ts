#!/usr/bin/env bun
/**
 * `blockers.hasUnresolvedDiscussions` answers "do open threads stop this
 * merge?", which only GitLab can decide: a project without "all threads must
 * be resolved" merges with threads open. GitLab states it through the
 * DISCUSSIONS_NOT_RESOLVED mergeability check (FAILED when the setting is on
 * and a thread is open, SUCCESS when it is on and none are, INACTIVE when it
 * is off). The raw thread count is only the fallback for when that check is
 * absent or undecided.
 */
import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import type { MergeabilityCheck, PullRequest, UserRef } from '../src/types.ts';

const user: UserRef = {
  id: 'gitlab:user:1',
  username: 'author',
  name: 'author',
  avatarUrl: null,
};

/** An otherwise unblocked MR, so `blockers.any` answers only the thread question. */
function stubPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'gitlab:mr:1',
    iid: 1,
    repositoryId: 'gitlab:1',
    title: 'MR 1',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: null,
    sourceBranch: 'feat/1',
    targetBranch: 'main',
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: user,
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: true,
    approvedBy: [user],
    diffStats: null,
    detailedMergeStatus: 'mergeable',
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
  } as unknown as PullRequest;
}

function discussionCheck(status: string): MergeabilityCheck[] {
  return [
    { identifier: 'CI_MUST_PASS', status: 'SUCCESS' },
    { identifier: 'DISCUSSIONS_NOT_RESOLVED', status },
  ];
}

describe('hasUnresolvedDiscussions follows GitLab discussion check', () => {
  test('open threads on a project that does not require resolution do not block', () => {
    const props = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 3, mergeabilityChecks: discussionCheck('INACTIVE') })
    );

    expect(props.blockers.hasUnresolvedDiscussions).toBe(false);
    expect(props.blockers.any).toBe(false);
  });

  test('open threads on a project that requires resolution block', () => {
    const props = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 1, mergeabilityChecks: discussionCheck('FAILED') })
    );

    expect(props.blockers.hasUnresolvedDiscussions).toBe(true);
    expect(props.blockers.any).toBe(true);
  });

  test('a FAILED check blocks even when the thread count reads zero', () => {
    const props = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 0, mergeabilityChecks: discussionCheck('FAILED') })
    );

    expect(props.blockers.hasUnresolvedDiscussions).toBe(true);
  });

  test('a SUCCESS check does not block', () => {
    const props = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 0, mergeabilityChecks: discussionCheck('SUCCESS') })
    );

    expect(props.blockers.hasUnresolvedDiscussions).toBe(false);
  });

  test('the thread count still decides the flag while the check is CHECKING', () => {
    const open = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 2, mergeabilityChecks: discussionCheck('CHECKING') })
    );
    const clear = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: 0, mergeabilityChecks: discussionCheck('CHECKING') })
    );

    expect(open.blockers.hasUnresolvedDiscussions).toBe(true);
    expect(clear.blockers.hasUnresolvedDiscussions).toBe(false);
  });

  test('without the check (GitHub, or an empty list) the thread count decides', () => {
    const open = getMRDashboardProps(stubPR({ unresolvedThreadCount: 2, mergeabilityChecks: [] }));
    const unknown = getMRDashboardProps(
      stubPR({ unresolvedThreadCount: null, mergeabilityChecks: [] })
    );

    expect(open.blockers.hasUnresolvedDiscussions).toBe(true);
    expect(unknown.blockers.hasUnresolvedDiscussions).toBe(false);
  });
});
