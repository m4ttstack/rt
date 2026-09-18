import { expect, test } from 'bun:test';

import {
  ago,
  cleanTitle,
  doctorItemLabel,
  firstReviewTargets,
  gitlabMenuItems,
  laneInterrupted,
  respondItemLabel,
  reviewLogged,
  reviewMenuItems,
  rowTitle,
} from '../client/board/format.ts';
import { statusReasons } from '../client/board/row-status.ts';

test('ago buckets minutes, hours, days', () => {
  const now = Date.parse('2026-08-19T12:00:00Z');
  expect(ago('2026-08-19T11:30:00Z', now)).toBe('30m');
  expect(ago('2026-08-19T02:00:00Z', now)).toBe('10h');
  expect(ago('2026-08-14T12:00:00Z', now)).toBe('5d');
  expect(ago(null, now)).toBe('');
});

test('cleanTitle strips ticket prefix and draft marker', () => {
  expect(cleanTitle('ACME-2369: add the thing')).toBe('add the thing');
  expect(cleanTitle('Draft: ACME-1: x')).toBe('x');
});

test("statusReasons is 'ready to merge' with no blockers", () => {
  expect(
    statusReasons({
      blockers: { any: false },
      reviews: { given: 0, required: 0 },
      unresolvedThreads: 0,
    } as never)
  ).toBe('ready to merge');
});

test('gitlabMenuItems: mergeable MR offers merge and auto-merge arming', () => {
  const items = gitlabMenuItems({
    mergeButton: { visible: true, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: true, isActive: false },
    behindTarget: 0,
  } as never);
  expect(items).toEqual([
    { kind: 'merge', label: 'merge', disabled: false },
    { kind: 'setAutoMerge', label: 'set auto-merge', disabled: false },
  ]);
});

test('gitlabMenuItems: armed auto-merge flips to cancel', () => {
  const items = gitlabMenuItems({
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: true, isActive: true },
    behindTarget: null,
  } as never);
  expect(items).toEqual([
    { kind: 'cancelAutoMerge', label: 'cancel auto-merge', disabled: false },
  ]);
});

test('gitlabMenuItems: rebase offered when GitLab raises the button', () => {
  const items = gitlabMenuItems({
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: true, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: null,
  } as never);
  expect(items).toEqual([
    { kind: 'rebase', label: 'rebase on target', disabled: false },
  ]);
});

test('gitlabMenuItems: rebase also offered when merely behind target', () => {
  const items = gitlabMenuItems({
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 4,
  } as never);
  expect(items.map(i => i.kind)).toEqual(['rebase']);
});

test('gitlabMenuItems: disabled merge carries through, rebase loading disables', () => {
  const items = gitlabMenuItems({
    mergeButton: { visible: true, disabled: true, loading: false },
    rebaseButton: { visible: true, loading: true },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: null,
  } as never);
  expect(items).toEqual([
    { kind: 'merge', label: 'merge', disabled: true },
    { kind: 'rebase', label: 'rebase on target', disabled: true },
  ]);
});

test('gitlabMenuItems: nothing raised means an empty list', () => {
  expect(
    gitlabMenuItems({
      mergeButton: { visible: false, disabled: false, loading: false },
      rebaseButton: { visible: false, loading: false },
      autoMergeButton: { visible: false, isActive: false },
      behindTarget: null,
    } as never)
  ).toEqual([]);
});

test('laneInterrupted: a gone orphan cuts the lane its sessionId names', () => {
  const orphan = { state: 'gone', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(orphan, { sessionId: 'sess-1' })).toBe(true);
  // A lane on a DIFFERENT session (relaunched since) is not interrupted.
  expect(laneInterrupted(orphan, { sessionId: 'sess-2' })).toBe(false);
});

test('laneInterrupted: subject-matched orphans (no session tie) cut any lane', () => {
  const orphan = { state: 'gone', sessionId: 'sess-1' } as never;
  // The lane never recorded a session id (queued): the orphan still applies.
  expect(laneInterrupted(orphan, {})).toBe(true);
});

test('laneInterrupted: hidden or missing orphans and missing lanes never cut', () => {
  const hidden = { state: 'hidden', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(hidden, { sessionId: 'sess-1' })).toBe(false);
  expect(laneInterrupted(undefined, { sessionId: 'sess-1' })).toBe(false);
  const gone = { state: 'gone', sessionId: 'sess-1' } as never;
  expect(laneInterrupted(gone, undefined)).toBe(false);
});

test('reviewMenuItems: worded like the row; an interrupted running review offers relaunch instead of focus', () => {
  expect(reviewMenuItems('reviewing', true)).toEqual([
    { kind: 'launch', label: 'relaunch review' },
  ]);
  expect(reviewMenuItems('queued', true)).toEqual([
    { kind: 'launch', label: 'relaunch review' },
  ]);
  // Not running: the flag changes nothing.
  expect(reviewMenuItems('done', true)).toEqual([
    { kind: 're-review', label: 're-review' },
  ]);
  expect(reviewMenuItems('reviewing')).toEqual([
    { kind: 'launch', label: 'focus review' },
  ]);
});

test('reviewMenuItems: re-review is offered cold only once a review is logged', () => {
  expect(reviewMenuItems(undefined)).toEqual([
    { kind: 'launch', label: 'review' },
  ]);
  expect(reviewMenuItems('error', false, false)).toEqual([
    { kind: 'launch', label: 'review' },
  ]);
  expect(reviewMenuItems(undefined, false, true)).toEqual([
    { kind: 'launch', label: 'review' },
    { kind: 're-review', label: 're-review' },
  ]);
});

test('reviewLogged: an approval, a reviewer thread, or a reviewer state counts; an untouched MR does not', () => {
  const base = {
    reviews: { isApproved: false, required: 2, given: 0, reviewers: [] },
    reviewerComments: 0,
  } as never;
  expect(reviewLogged(base)).toBe(false);
  expect(
    reviewLogged({ ...(base as object), reviewerComments: 2 } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: { isApproved: false, required: 2, given: 1, reviewers: [] },
      reviewerComments: 0,
    } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'tom', reviewState: 'REQUESTED_CHANGES' }],
      },
      reviewerComments: 0,
    } as never)
  ).toBe(true);
  expect(
    reviewLogged({
      reviews: {
        isApproved: false,
        required: 2,
        given: 0,
        reviewers: [{ username: 'tom', reviewState: 'UNREVIEWED' }],
      },
      reviewerComments: 0,
    } as never)
  ).toBe(false);
});

test('respondItemLabel and doctorItemLabel are worded like the row', () => {
  expect(respondItemLabel(undefined)).toBe('respond');
  expect(respondItemLabel('implementing', true)).toBe('relaunch response');
  expect(respondItemLabel('implementing')).toBe('focus response');
  expect(respondItemLabel('done', true)).toBe('restart response');
  expect(doctorItemLabel(undefined)).toBe('call doctor');
  expect(doctorItemLabel('done')).toBe('call doctor again');
  expect(doctorItemLabel('rebasing')).toBe('focus doctor');
});

test('rowTitle also drops the ticket the facts line carries, with or without a colon; Slack titles keep it', () => {
  expect(rowTitle('ACME-2214 Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('ACME-2214: Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('acme-2214 - Port the flows', 'ACME-2214')).toBe(
    'Port the flows'
  );
  expect(rowTitle('ACME-22140 is not the ticket', 'ACME-2214')).toBe(
    'ACME-22140 is not the ticket'
  );
  expect(rowTitle('Port the flows', null)).toBe('Port the flows');
  expect(cleanTitle('ACME-2214 Port the flows')).toBe(
    'ACME-2214 Port the flows'
  );
});

test('a title that is only the ticket keeps the ticket rather than going blank', () => {
  expect(rowTitle('ACME-2214', 'ACME-2214')).toBe('ACME-2214');
  expect(rowTitle('ACME-2214 -', 'ACME-2214')).toBe('ACME-2214 -');
  expect(rowTitle('ACME-2214:', 'ACME-2214')).toBe('ACME-2214:');
  expect(cleanTitle('ACME-2214:')).toBe('ACME-2214:');
  expect(cleanTitle('Draft: ACME-2214:')).toBe('ACME-2214:');
});

test('firstReviewTargets: roster minus author, engaged peers, and gated by an outstanding ask', () => {
  const mrx = {
    author: { username: 'ada' },
    peerReviews: [
      { reviewer: 'grace', status: 'reviewing', updatedAt: 1 },
      { reviewer: 'linus', status: 'done', outcome: 'comment', updatedAt: 1 },
    ],
  } as never;
  const roster = ['ada', 'grace', 'linus', 'kim'];
  expect(firstReviewTargets(mrx, roster)).toEqual(['kim']);

  const outstanding = {
    ...(mrx as object),
    sentNudge: { display: 'requested', reviewer: 'kim' },
  } as never;
  expect(firstReviewTargets(outstanding, roster)).toEqual([]);

  const retryable = {
    ...(mrx as object),
    sentNudge: { display: 'no-response', reviewer: 'kim' },
  } as never;
  expect(firstReviewTargets(retryable, roster)).toEqual(['kim']);
});
