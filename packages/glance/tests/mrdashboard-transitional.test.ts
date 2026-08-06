#!/usr/bin/env bun
/**
 * MAT-132 made the "GitLab has not decided yet" vocabulary a single shared
 * list, `TRANSITIONAL_MERGE_STATUSES` behind `isTransitionalMergeStatus`, read
 * by `getMRDashboardProps`, `GitLabProvider`'s merge-refusal diagnostics, and
 * the live harness's merge-readiness poll. The dashboard's own copy of
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
    // The consequence worth being explicit about: isReady feeds
    // mergeButton.disabled, so an MR GitLab has not finished deciding on
    // offers a Merge button, and pressing it during this window is what
    // returns the ambiguous 405 MAT-132 now explains.
    expect(props.isReady).toBe(true);
    expect(props.mergeButton.disabled).toBe(false);
  });

  // Written out rather than derived, deliberately. The test.each above reads
  // the same set production reads, so it cannot notice a wrong member: adding
  // `ci_must_pass` there would keep it green while turning a hard blocker into
  // a mergeable MR with an enabled Merge button. This literal is the only
  // thing in the suite that would object.
  test('the set is exactly these four values', () => {
    expect([...TRANSITIONAL_MERGE_STATUSES].sort()).toEqual(
      ['approvals_syncing', 'checking', 'preparing', 'unchecked'].sort()
    );
  });

  test('the exported set cannot be repointed by a consumer', () => {
    expect(Object.isFrozen(TRANSITIONAL_MERGE_STATUSES)).toBe(true);
  });

  test.each(['discussions_not_resolved', 'ci_must_pass', 'conflict', 'not_open'])(
    '%s is a blocker, not a transitional state',
    status => {
      const props = getMRDashboardProps(stubPR(status));

      expect(props.isCheckingMergeability).toBe(false);
      expect(props.status).toBe('blocked');
      expect(props.mergeButton.disabled).toBe(true);
    }
  );
});
