/**
 * Mock MRDashboardProps fixtures for Storybook stories.
 *
 * These cover the common states any Forge dashboard will need to show:
 * mergeable, blocked (various reasons), draft, merged, and in-progress.
 */
import type { MRDashboardProps } from '@mattstack/glance';

const author = {
  id: 'user:1',
  name: 'Alice Chen',
  username: 'achen',
  avatarUrl: 'https://i.pravatar.cc/40?img=1',
  webUrl: 'https://gitlab.com/achen',
};

const reviewers = [
  {
    id: 'user:2',
    name: 'Bob Smith',
    username: 'bsmith',
    avatarUrl: 'https://i.pravatar.cc/40?img=2',
    webUrl: 'https://gitlab.com/bsmith',
    reviewState: 'APPROVED' as const,
  },
  {
    id: 'user:3',
    name: 'Carol Wu',
    username: 'cwu',
    avatarUrl: 'https://i.pravatar.cc/40?img=3',
    webUrl: 'https://gitlab.com/cwu',
    reviewState: 'REVIEW_STARTED' as const,
  },
  {
    id: 'user:4',
    name: 'Dave Park',
    username: 'dpark',
    avatarUrl: null,
    webUrl: 'https://gitlab.com/dpark',
    reviewState: 'UNREVIEWED' as const,
  },
  {
    id: 'user:5',
    name: 'Eve Torres',
    username: 'etorres',
    avatarUrl: 'https://i.pravatar.cc/40?img=5',
    webUrl: 'https://gitlab.com/etorres',
    reviewState: 'REQUESTED_CHANGES' as const,
  },
  {
    id: 'user:6',
    name: 'Frank Lee',
    username: 'flee',
    avatarUrl: 'https://i.pravatar.cc/40?img=6',
    webUrl: 'https://gitlab.com/flee',
    reviewState: 'REVIEWED' as const,
  },
];

const passingPipeline: MRDashboardProps['pipeline'] = {
  id: 'gl:pipeline:100',
  status: 'success',
  passing: 24,
  failing: 0,
  running: 0,
  total: 24,
  hasWarnings: false,
  jobs: [],
};

const failingPipeline: MRDashboardProps['pipeline'] = {
  id: 'gl:pipeline:101',
  status: 'failed',
  passing: 18,
  failing: 3,
  running: 0,
  total: 24,
  hasWarnings: false,
  jobs: [
    { id: 'gl:1001', name: 'unit-tests', stage: 'test', status: 'failed', allowFailure: false, webUrl: null, duration: 42 },
    { id: 'gl:1002', name: 'integration-tests', stage: 'test', status: 'failed', allowFailure: false, webUrl: null, duration: 118 },
    { id: 'gl:1003', name: 'e2e-chrome', stage: 'test', status: 'failed', allowFailure: false, webUrl: null, duration: 203 },
  ],
};

const runningPipeline: MRDashboardProps['pipeline'] = {
  id: 'gl:pipeline:102',
  status: 'running',
  passing: 10,
  failing: 0,
  running: 6,
  total: 24,
  hasWarnings: false,
  jobs: [
    { id: 'gl:2001', name: 'lint', stage: 'test', status: 'running', allowFailure: false, webUrl: null, duration: null },
    { id: 'gl:2002', name: 'typecheck', stage: 'test', status: 'running', allowFailure: false, webUrl: null, duration: null },
    { id: 'gl:2003', name: 'unit-tests', stage: 'test', status: 'running', allowFailure: false, webUrl: null, duration: null },
    { id: 'gl:2004', name: 'integration-tests', stage: 'test', status: 'pending', allowFailure: false, webUrl: null, duration: null },
    { id: 'gl:2005', name: 'e2e-chrome', stage: 'test', status: 'pending', allowFailure: false, webUrl: null, duration: null },
    { id: 'gl:2006', name: 'deploy-staging', stage: 'deploy', status: 'pending', allowFailure: false, webUrl: null, duration: null },
  ],
};

const diff: MRDashboardProps['diff'] = {
  additions: 142,
  deletions: 38,
  filesChanged: 9,
};

const baseReviews = (
  reviewerSlice = reviewers,
  given = 1,
  required = 2
): MRDashboardProps['reviews'] => ({
  required,
  given,
  remaining: required - given,
  isApproved: given >= required,
  approvedBy: given > 0 ? [reviewers[0]] : [],
  reviewers: reviewerSlice,
  totalAssigned: reviewerSlice.length,
  haveActed: reviewerSlice.filter(r =>
    ['APPROVED', 'REVIEWED', 'REQUESTED_CHANGES'].includes(r.reviewState ?? '')
  ).length,
  havePending: reviewerSlice.filter(r => r.reviewState === 'REVIEW_STARTED')
    .length,
  haveNotStarted: reviewerSlice.filter(r =>
    ['UNREVIEWED', 'UNAPPROVED'].includes(r.reviewState ?? '')
  ).length,
});

const noBlockers: MRDashboardProps['blockers'] = {
  isDraft: false,
  hasConflicts: false,
  needsRebase: false,
  pipelineFailing: false,
  pipelineRunning: false,
  awaitingApprovals: false,
  hasUnresolvedDiscussions: false,
  hasMergeError: false,
  mergeError: null,
  any: false,
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const mergeable: MRDashboardProps = {
  provider: 'gitlab',
  iid: 42,
  title: 'feat: add getMRDashboardProps — headless UI props for MR dashboards',
  webUrl: 'https://gitlab.com/acme/backend/-/merge_requests/42',
  state: 'opened',
  isDraft: false,
  author,
  assignees: [author],
  createdAt: '2026-03-09T14:30:00Z',
  sourceBranch: 'feat/mr-dashboard-props',
  targetBranch: 'main',
  diff,
  pipeline: passingPipeline,
  reviews: baseReviews(reviewers, 2, 2),
  status: 'mergeable',
  statusDetail: 'mergeable',
  isReady: true,
  isCheckingMergeability: false,
  isMerging: false,
  isRebasing: false,
  isLoading: false,
  mergeButton: {
    visible: true,
    disabled: false,
    loading: false,
    label: 'Merge',
  },
  autoMergeButton: {
    visible: true,
    isActive: false,
    strategy: null,
    setBy: null,
    label: 'Auto-merge',
    cancelLabel: 'Cancel auto-merge',
  },
  rebaseButton: {
    visible: false,
    loading: false,
    label: 'Rebase',
    behindBy: 0,
  },
  blockers: noBlockers,
  connection: 'connected',
};

export const pipelineBlocked: MRDashboardProps = {
  ...mergeable,
  iid: 43,
  title: 'fix: resolve memory leak in connection pool',
  pipeline: failingPipeline,
  reviews: baseReviews(reviewers, 0, 2),
  status: 'blocked',
  statusDetail: 'CI_MUST_PASS',
  isReady: false,
  mergeButton: {
    visible: true,
    disabled: true,
    loading: false,
    label: 'Merge',
  },
  blockers: {
    ...noBlockers,
    pipelineFailing: true,
    awaitingApprovals: true,
    any: true,
  },
};

export const draft: MRDashboardProps = {
  ...mergeable,
  iid: 44,
  title: 'Draft: refactor authentication middleware',
  isDraft: true,
  pipeline: runningPipeline,
  reviews: baseReviews([reviewers[2]], 0, 1),
  status: 'draft',
  statusDetail: 'DRAFT_STATUS',
  isReady: false,
  mergeButton: {
    visible: false,
    disabled: true,
    loading: false,
    label: 'Merge',
  },
  blockers: {
    ...noBlockers,
    isDraft: true,
    pipelineRunning: true,
    awaitingApprovals: true,
    any: true,
  },
};

export const needsRebase: MRDashboardProps = {
  ...mergeable,
  iid: 45,
  title: 'chore: upgrade dependencies to latest',
  pipeline: passingPipeline,
  reviews: baseReviews(reviewers, 1, 2),
  status: 'blocked',
  statusDetail: 'NEED_REBASE',
  isReady: false,
  mergeButton: {
    visible: true,
    disabled: true,
    loading: false,
    label: 'Merge',
  },
  rebaseButton: {
    visible: true,
    loading: false,
    label: 'Rebase',
    behindBy: 14,
  },
  blockers: {
    ...noBlockers,
    needsRebase: true,
    awaitingApprovals: true,
    any: true,
  },
};

export const merging: MRDashboardProps = {
  ...mergeable,
  status: 'mergeable',
  isMerging: true,
  isLoading: true,
  mergeButton: {
    visible: true,
    disabled: true,
    loading: true,
    label: 'Merging…',
  },
};

export const merged: MRDashboardProps = {
  ...mergeable,
  iid: 46,
  title: 'feat: dark mode support',
  state: 'merged',
  status: 'merged',
  isReady: false,
  mergeButton: {
    visible: false,
    disabled: false,
    loading: false,
    label: 'Merge',
  },
  rebaseButton: {
    visible: false,
    loading: false,
    label: 'Rebase',
    behindBy: 0,
  },
  blockers: noBlockers,
};

export const conflicts: MRDashboardProps = {
  ...pipelineBlocked,
  iid: 47,
  title: 'refactor: extract shared hooks',
  pipeline: passingPipeline,
  status: 'blocked',
  statusDetail: 'CONFLICT',
  blockers: {
    ...noBlockers,
    hasConflicts: true,
    awaitingApprovals: true,
    any: true,
  },
};

export const autoMergeActive: MRDashboardProps = {
  ...mergeable,
  iid: 48,
  title: 'ci: improve build caching',
  pipeline: runningPipeline,
  status: 'blocked',
  statusDetail: 'CI_MUST_PASS',
  isReady: false,
  autoMergeButton: {
    visible: true,
    isActive: true,
    strategy: 'merge_when_pipeline_succeeds',
    setBy: author,
    label: 'Auto-merge enabled',
    cancelLabel: 'Cancel auto-merge',
  },
  mergeButton: {
    visible: true,
    disabled: true,
    loading: false,
    label: 'Merge',
  },
  blockers: { ...noBlockers, pipelineRunning: true, any: true },
};
