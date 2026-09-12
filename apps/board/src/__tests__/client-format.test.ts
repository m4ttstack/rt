import { expect, test } from 'bun:test';

import {
  ago,
  CHIP_CELL_WORDS,
  cleanTitle,
  DOCTOR_LABEL,
  gitlabMenuItems,
  laneInterrupted,
  nudgeChipText,
  PEER_PHRASE,
  peerState,
  RESPOND_LABEL,
  respondItemLabel,
  REVIEW_LABEL,
  reviewMenuItems,
  statusReasons,
} from '../client/board/format.ts';
import { respondOutcome } from '../respond-outcome.ts';

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

test('nudgeChipText covers every display state', () => {
  expect(nudgeChipText({ display: 'requested', reviewer: 'a' })).toBe(
    're-review requested'
  );
  expect(
    nudgeChipText({ display: 'rejected', reviewer: 'a', reason: 'busy' })
  ).toBe('nudge: busy');
  expect(nudgeChipText({ display: 'no-response', reviewer: 'a' })).toBe(
    'no response, retry?'
  );
});

test('peerState maps done+outcome, hides unknown statuses', () => {
  const base = { mrUrl: 'u', iid: 1, reviewer: 'r', updatedAt: 0 };
  expect(peerState({ ...base, status: 'reviewing' })).toBe('reviewing');
  expect(peerState({ ...base, status: 'done', outcome: 'approve' })).toBe(
    'approved'
  );
  expect(peerState({ ...base, status: 'someday-new-word' })).toBeNull();
});

// The stamped-word half of the chip cell contract (format.ts's CHIP_CELL_WORDS
// header carries the whole argument). The compiler already pins each list to
// its state union in both directions; what it CANNOT see is style.css's
// selectors, and what this catches is the drift a rename causes: a word
// renamed in one vocabulary and not the other leaves the two key sets unequal
// here long before anyone notices an uncoloured chip on the board.
test('every chip cell word list equals the vocabulary it stamps', () => {
  const sorted = (words: readonly string[]) => [...words].sort();
  expect(sorted(CHIP_CELL_WORDS.review)).toEqual(
    sorted(Object.keys(REVIEW_LABEL))
  );
  expect(sorted(CHIP_CELL_WORDS.doctor)).toEqual(
    sorted(Object.keys(DOCTOR_LABEL))
  );
  expect(sorted(CHIP_CELL_WORDS.peer)).toEqual(
    sorted(Object.keys(PEER_PHRASE))
  );
  // A respond cell is the unfinished run's raw status (RESPOND_LABEL is keyed
  // on exactly those, `done` deliberately absent) or the finished run's derived
  // outcome, so the vocabulary is the union of the two — every ending
  // respondOutcome can actually return, driven through its real inputs rather
  // than restated as a list.
  const outcomes = [
    respondOutcome(),
    respondOutcome(0, 0),
    respondOutcome(0, 3),
    respondOutcome(1, 3),
    respondOutcome(3, 3),
  ];
  expect(sorted(CHIP_CELL_WORDS.respond)).toEqual(
    sorted([...new Set([...Object.keys(RESPOND_LABEL), ...outcomes])])
  );
  // Nudge has no label map of its own: nudgeChipText's switch IS the
  // vocabulary, and it is exhaustive by type, so every listed word must render
  // some text through it.
  for (const display of CHIP_CELL_WORDS.nudge) {
    expect(nudgeChipText({ display, reviewer: 'r' })).toBeTruthy();
  }
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

test('reviewMenuItems: an interrupted running review offers relaunch instead of focus', () => {
  expect(reviewMenuItems('reviewing', true)).toEqual([
    { kind: 'launch', label: 'relaunch review pane' },
  ]);
  expect(reviewMenuItems('queued', true)).toEqual([
    { kind: 'launch', label: 'relaunch review pane' },
  ]);
  // Not running: the flag changes nothing.
  expect(reviewMenuItems('done', true)).toEqual([
    { kind: 're-review', label: 're-review' },
  ]);
  expect(reviewMenuItems('reviewing')).toEqual([
    { kind: 'launch', label: 'focus review tab' },
  ]);
});

test('respondItemLabel: an interrupted in-flight response offers relaunch', () => {
  expect(respondItemLabel('implementing', true)).toBe('relaunch response pane');
  expect(respondItemLabel('implementing')).toBe('focus response tab');
  expect(respondItemLabel('done', true)).toBe('restart response');
});
