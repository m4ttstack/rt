import type { BoardMR } from '../../../data.ts';
import type { BoardMRWithReview } from '../../types.ts';
import type { ActionEnv } from '../row-actions.ts';

export const MR_URL = (iid: number) =>
  `https://gitlab.example.com/acme/webapp/-/merge_requests/${iid}`;

export function mrx(
  iid: number,
  over: Record<string, unknown> = {}
): BoardMRWithReview {
  return {
    iid,
    title: 'Port the flows',
    webUrl: MR_URL(iid),
    sourceBranch: `f-${iid}`,
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 0, given: 0, reviewers: [] },
    reviewerComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 0,
    isDraft: false,
    isStacked: false,
    gates: [],
    ...over,
  } as never;
}

export interface MenuEnv {
  self: string | null;
  local?: boolean;
  slackEnabled?: boolean;
  roster?: string[];
  peers?: string[];
  allMrs?: BoardMR[];
}

export const ROSTER = ['pat', 'kim', 'jo'];

export const ownIdle = mrx(1418, {
  mergeButton: { visible: true, disabled: false, loading: false },
  behindTarget: 3,
  autoMergeButton: { visible: true, isActive: false },
  slack: { status: 'notfound', reactions: [], posted: false },
});
export const ownEnv: MenuEnv = {
  self: 'pat',
  slackEnabled: true,
  roster: ROSTER,
};

export const teammateReviewed = mrx(1419, {
  author: { username: 'kim', name: 'Kim' },
  reviews: { isApproved: false, required: 0, given: 1, reviewers: [] },
  review: {
    status: 'done',
    outcome: 'comment',
    reportReady: true,
    sessionId: 'rev-1',
  },
  slack: {
    status: 'found',
    reactions: ['white_check_mark'],
    permalink: 'https://slack.example.com/archives/C1/p1',
    posted: true,
  },
});

export const ownBusy = mrx(1420, {
  isDraft: true,
  blockers: { any: true, pipelineFailing: true },
  review: { status: 'reviewing', sessionId: 'rev-2' },
  respond: { status: 'implementing', sessionId: 'resp-2' },
  orphan: { state: 'gone', sessionId: 'resp-2' },
  note: 'check the flags first',
});
const stackedOnBusy = mrx(1421, { isStacked: true, targetBranch: 'f-1420' });
export const busyEnv: MenuEnv = {
  self: 'pat',
  roster: ROSTER,
  allMrs: [ownBusy, stackedOnBusy],
};

export const failedLanes = mrx(1422, {
  blockers: { any: true, hasConflicts: true },
  review: { status: 'error', message: 'nothing to review' },
  respond: { status: 'done', sessionId: 'resp-3' },
  doctor: { status: 'error' },
  standDown: true,
  peerReviews: [
    {
      mrUrl: MR_URL(1422),
      iid: 1422,
      reviewer: 'kim',
      status: 'done',
      outcome: 'comment',
      updatedAt: 1,
    },
  ],
});
export const failedEnv: MenuEnv = {
  self: 'pat',
  slackEnabled: true,
  roster: ROSTER,
};

export function actionEnvOf(env: MenuEnv, mr: BoardMR): ActionEnv {
  return {
    local: env.local ?? true,
    slackEnabled: env.slackEnabled ?? false,
    self: env.self,
    roster: env.roster ?? [],
    peers: env.peers,
    allMrs: env.allMrs ?? [mr],
  };
}
