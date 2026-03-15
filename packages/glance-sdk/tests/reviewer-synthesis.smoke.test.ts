#!/usr/bin/env bun
/**
 * Smoke test: getMRDashboardProps reviewer synthesis for terminal-state MRs.
 *
 * GitLab clears the `reviewers` list after an MR is merged/closed, but keeps
 * `approvedBy` populated.  getMRDashboardProps now synthesizes Reviewer entries
 * from approvedBy so the UI can still display who approved.
 *
 * This test validates:
 *  1. Merged MR with empty reviewers → synthesizes from approvedBy
 *  2. Closed MR with empty reviewers → same behavior
 *  3. Merged MR with empty reviewers AND empty approvedBy → graceful empty
 *  4. Open MR with empty reviewers → NOT synthesized (open MRs unaffected)
 *  5. Merged MR with existing reviewers → uses original list, no synthesis
 *  6. Multiple approvers → all synthesized correctly
 *  7. Computed fields (isApproved, given, remaining) stay correct
 */

import { getMRDashboardProps } from '@workforge/glance-sdk';
import type { PullRequest, Reviewer, UserRef } from '@workforge/glance-sdk';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

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

console.log('\n▶ Reviewer synthesis: merged MR, empty reviewers');
{
  const props = getMRDashboardProps(stubPR());
  assert(props.reviews.reviewers.length === 1, 'synthesizes 1 reviewer from approvedBy');
  assert(props.reviews.reviewers[0]!.username === 'reviewer1', 'preserves username');
  assert(props.reviews.reviewers[0]!.reviewState === 'APPROVED', 'sets reviewState to APPROVED');
  assert(props.reviews.totalAssigned === 1, 'totalAssigned reflects synthesized count');
  assert(props.reviews.haveActed === 1, 'haveActed counts the synthesized reviewer');
  assert(props.reviews.havePending === 0, 'havePending is 0');
  assert(props.reviews.haveNotStarted === 0, 'haveNotStarted is 0');
}

console.log('\n▶ Reviewer synthesis: closed MR, empty reviewers');
{
  const props = getMRDashboardProps(stubPR({ state: 'closed' }));
  assert(props.reviews.reviewers.length === 1, 'synthesizes reviewers for closed MRs too');
  assert(props.reviews.reviewers[0]!.reviewState === 'APPROVED', 'reviewState is APPROVED');
}

console.log('\n▶ Reviewer synthesis: merged MR, empty reviewers AND empty approvedBy');
{
  const props = getMRDashboardProps(stubPR({ approvedBy: [] }));
  assert(props.reviews.reviewers.length === 0, 'reviewers stays empty (no crash)');
  assert(props.reviews.totalAssigned === 0, 'totalAssigned is 0');
  assert(props.reviews.haveActed === 0, 'haveActed is 0');
}

console.log('\n▶ Reviewer synthesis: open MR, empty reviewers → no synthesis');
{
  const props = getMRDashboardProps(stubPR({ state: 'opened' }));
  assert(props.reviews.reviewers.length === 0, 'does NOT synthesize for open MRs');
  assert(props.reviews.totalAssigned === 0, 'totalAssigned stays 0');
}

console.log('\n▶ Reviewer synthesis: merged MR with existing reviewers → no synthesis');
{
  const existing: Reviewer = { ...user(3, 'existing'), reviewState: 'REVIEWED' };
  const props = getMRDashboardProps(stubPR({ reviewers: [existing] }));
  assert(props.reviews.reviewers.length === 1, 'uses original reviewer list');
  assert(props.reviews.reviewers[0]!.reviewState === 'REVIEWED', 'preserves original reviewState');
  assert(props.reviews.reviewers[0]!.username === 'existing', 'preserves original username');
}

console.log('\n▶ Reviewer synthesis: multiple approvers');
{
  const props = getMRDashboardProps(
    stubPR({ approvedBy: [user(2, 'alice'), user(3, 'bob'), user(4, 'carol')] })
  );
  assert(props.reviews.reviewers.length === 3, 'synthesizes all 3 approvers');
  assert(props.reviews.haveActed === 3, 'haveActed counts all 3');
  assert(props.reviews.totalAssigned === 3, 'totalAssigned is 3');
  const usernames = props.reviews.reviewers.map(r => r.username);
  assert(usernames.includes('alice'), 'includes alice');
  assert(usernames.includes('bob'), 'includes bob');
  assert(usernames.includes('carol'), 'includes carol');
}

console.log('\n▶ Reviewer synthesis: computed approval fields stay correct');
{
  const props = getMRDashboardProps(
    stubPR({ approved: true, approvalsLeft: 0, approvalsRequired: 2 })
  );
  assert(props.reviews.isApproved === true, 'isApproved passes through');
  assert(props.reviews.given === 1, 'given reflects approvedBy.length');
  assert(props.reviews.remaining === 0, 'remaining reflects approvalsLeft');
  assert(props.reviews.required === 2, 'required reflects approvalsRequired');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
