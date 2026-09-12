/** Whether a row needs the board's seat to move, and what kind of move: the
    predicate behind the "Needs me" tab and its grouping. Hot rows are read
    off the status line so the tab and the row can never disagree; the rest
    is the seat's standing relationship to the MR (author or assigned
    reviewer), which the status line only shows when nothing hotter is on. */
import { hasChangesRequested } from '../../data.ts';
import type { BoardMRWithReview } from '../types.ts';
import { rowStatus, type Verb } from './row-status.ts';

export type Need =
  'decide' | 'unstick' | 'respond' | 'fix' | 're-review' | 'review' | 'merge';

/** Group order on the tab: what blocks an agent first, then what blocks the
    author, then the reviewer's queue, then the pleasant one. */
export const NEED_ORDER: readonly Need[] = [
  'decide',
  'unstick',
  'respond',
  'fix',
  're-review',
  'review',
  'merge',
];

export const NEED_LABEL: Record<Need, string> = {
  decide: 'decide',
  unstick: 'unstick',
  respond: 'respond',
  fix: 'fix',
  're-review': 're-review',
  review: 'review',
  merge: 'merge',
};

type Resolved = ReadonlyMap<string, 'posted' | 'dismissed'>;

const DECIDE_VERBS = new Set<Verb['kind']>(['answer', 'read-note']);

/** What the status line says about the seat's move: a hot line is always
    theirs (its verb says which kind); a working line means an agent has the
    row for now, so nothing standing counts either; anything else defers to
    the seat's standing relationship. */
function lineNeed(
  mr: BoardMRWithReview,
  now: number,
  resolved: Resolved,
  self: string
): Need | null | 'busy' {
  const { line, bar } = rowStatus(mr, now, resolved, self);
  if (line.tone === 'work') return 'busy';
  if (!bar) return null;
  if (line.tone === 'bad') return 'unstick';
  const kind = line.verbs[0]?.kind;
  if (kind === 're-review') return 're-review';
  if (kind && DECIDE_VERBS.has(kind)) return 'decide';
  return 'unstick';
}

function authorNeed(mr: BoardMRWithReview): Need | null {
  const b = mr.blockers;
  if ((mr.threadSummary?.awaiting ?? 0) > 0 || hasChangesRequested(mr))
    return 'respond';
  if (b.hasConflicts || b.needsRebase || b.pipelineFailing) return 'fix';
  if (mr.reviews.isApproved && !b.any) return 'merge';
  return null;
}

/** Only an assigned reviewer has a move on someone else's MR: a review not
    started or left mid-way, an approval GitLab reset on a new push, or
    threads of theirs the author has answered or resolved (a re-review).
    Their own thread still awaiting the author is the author's move. */
function reviewerNeed(mr: BoardMRWithReview, self: string): Need | null {
  const me = mr.reviews.reviewers.find(r => r.username === self);
  if (!me) return null;
  const state = me.reviewState;
  if (state === 'APPROVED') return null;
  if (state === 'UNAPPROVED') return 're-review';
  const mine = mr.myThreads;
  if (mine && mine.awaiting > 0) return null;
  if (mine && mine.replied + mine.resolved > 0) return 're-review';
  if (state === 'UNREVIEWED' || state === 'REVIEW_STARTED') return 'review';
  return null;
}

export function needOf(
  mr: BoardMRWithReview,
  self: string,
  now: number,
  resolved: Resolved
): Need | null {
  const fromLine = lineNeed(mr, now, resolved, self);
  if (fromLine === 'busy') return null;
  return (
    fromLine ??
    (mr.author.username === self ? authorNeed(mr) : reviewerNeed(mr, self))
  );
}
