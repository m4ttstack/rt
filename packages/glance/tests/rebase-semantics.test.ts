#!/usr/bin/env bun
/**
 * MAT-164. `getMRDashboardProps` used to derive
 *
 *   needsRebase = mr.shouldBeRebased || (mr.divergedCommitsCount ?? 0) > 0
 *
 * which had two defects these pin.
 *
 * `divergedCommitsCount` is only populated by the paths that make the REST
 * `include_diverged_commits_count` call -- `fetchSingleMR` (and
 * `fetchPullRequestByBranch` behind it) and the role-based mode of
 * `fetchPullRequests`. Every other path, including the `iids` mode that
 * `DashboardGroup` polls with and `fetchPullRequestsByBranches`, leaves it
 * null. `?? 0` turned that "we did not ask" into "not behind", so one MR read
 * true on a single-MR refresh and false on the next bulk poll. A consumer
 * watching the false -> true edge to notify (rt does) re-fires forever.
 *
 * And being behind the target branch is not a merge blocker: on a
 * `merge_method: merge` project it never stops a merge and GitLab's own UI
 * never offers a rebase button for it, yet it fed `blockers.any`.
 */
import { describe, expect, test } from 'bun:test';
import { getMRDashboardProps } from '../src/MRDashboard.ts';
import type { PullRequest, UserRef } from '../src/types.ts';

const user: UserRef = {
  id: 'gitlab:user:1',
  username: 'author',
  name: 'author',
  avatarUrl: null,
};

/**
 * An otherwise entirely unblocked MR: approved by a real approver, no
 * threads, no pipeline, no conflicts. Every blocker is false unless an
 * override turns it on, so `blockers.any` answers exactly one question here.
 */
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

describe('needsRebase tracks shouldBeRebased, not behind-ness', () => {
  test('a real rebase requirement survives an unfetched behind count', () => {
    const props = getMRDashboardProps(
      stubPR({ shouldBeRebased: true, divergedCommitsCount: null })
    );

    expect(props.blockers.needsRebase).toBe(true);
    expect(props.blockers.any).toBe(true);
    expect(props.rebaseButton.visible).toBe(true);
    // The blocker is known even though the count is not. These are two
    // different facts and only one of them was fetched.
    expect(props.behindTarget).toBeNull();
  });

  test('behind the target branch is reported, but is not a blocker', () => {
    const props = getMRDashboardProps(
      stubPR({ shouldBeRebased: false, divergedCommitsCount: 7 })
    );

    expect(props.behindTarget).toBe(7);
    expect(props.blockers.needsRebase).toBe(false);
    // The whole point of MAT-164: an otherwise clean MR that merely sits
    // behind its target is not blocked, and GitLab shows no rebase button
    // for it on a merge_method: merge project.
    expect(props.blockers.any).toBe(false);
    expect(props.rebaseButton.visible).toBe(false);
  });

  test('a closed MR never offers the rebase button, even when a rebase is required', () => {
    const props = getMRDashboardProps(
      stubPR({ state: 'closed', shouldBeRebased: true })
    );

    expect(props.rebaseButton.visible).toBe(false);
  });

  test('an unfetched count is distinguishable from a count of zero', () => {
    const unknown = getMRDashboardProps(stubPR({ divergedCommitsCount: null }));
    const zero = getMRDashboardProps(stubPR({ divergedCommitsCount: 0 }));

    // The assertion the old shape could not have passed: `?? 0` collapsed
    // these two into the same props.
    expect(unknown.behindTarget).toBeNull();
    expect(zero.behindTarget).toBe(0);
    expect(unknown.behindTarget).not.toBe(zero.behindTarget);
  });

  test('needsRebase does not vary with which fetch path produced the MR', () => {
    // Two payloads for the same MR: one from a path that made the REST
    // include_diverged_commits_count call, one from a path that did not.
    const fromBulkPoll = getMRDashboardProps(stubPR({ divergedCommitsCount: null }));
    const fromSingleRefresh = getMRDashboardProps(stubPR({ divergedCommitsCount: 7 }));

    // This equality is the notification storm, stated directly. Under the old
    // derivation these were false and true, and a consumer watching the edge
    // saw a transition every time the caller alternated.
    expect(fromBulkPoll.blockers.needsRebase).toBe(fromSingleRefresh.blockers.needsRebase);
    expect(fromBulkPoll.blockers.any).toBe(fromSingleRefresh.blockers.any);
    expect(fromBulkPoll.rebaseButton.visible).toBe(fromSingleRefresh.rebaseButton.visible);
  });
});
