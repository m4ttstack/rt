#!/usr/bin/env bun
/**
 * MAT-132 made the "GitLab has not decided yet" vocabulary a single shared
 * set, `TRANSITIONAL_MERGE_STATUSES`, read by both `getMRDashboardProps` and
 * `GitLabProvider`'s merge-refusal diagnostics. The dashboard's own copy of
 * that list omitted `preparing`, which GitLab emits ahead of `unchecked` on a
 * just-created merge request (its DetailedMergeStatusService returns it
 * first, and phase 4's live poll observed exactly that order), so the one
 * state closest to "we just opened this" flashed BLOCKED through the rule
 * written to prevent that. These pin the whole set, so re-splitting it into
 * two lists that disagree fails here.
 */
import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import { TRANSITIONAL_MERGE_STATUSES } from '../src/types.ts';
import type { PullRequest, UserRef } from '../src/types.ts';

const user: UserRef = {
  id: 'gitlab:user:1',
  username: 'author',
  name: 'author',
  avatarUrl: null,
};

/** An otherwise unblocked MR, so `status` turns purely on the merge status. */
function stubPR(detailedMergeStatus: string | null): PullRequest {
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
    detailedMergeStatus,
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
  } as unknown as PullRequest;
}

describe('transitional merge statuses', () => {
  test.each([...TRANSITIONAL_MERGE_STATUSES])('%s reads as still checking, not blocked', status => {
    const props = getMRDashboardProps(stubPR(status));

    expect(props.isCheckingMergeability).toBe(true);
    expect(props.status).toBe('mergeable');
  });

  test('preparing is in the set', () => {
    expect(TRANSITIONAL_MERGE_STATUSES.has('preparing')).toBe(true);
  });

  test('a named blocker is not transitional', () => {
    const props = getMRDashboardProps(stubPR('discussions_not_resolved'));

    expect(props.isCheckingMergeability).toBe(false);
  });
});
