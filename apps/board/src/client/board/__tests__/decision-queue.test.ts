import { expect, test } from 'bun:test';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import {
  advance,
  advanceOrWrap,
  backTo,
  forwardTo,
  queueView,
  reconcile,
  stepBack,
  stepForward,
  type QueueEntry,
  type QueueSession,
} from '../decision-queue.ts';

function entry(
  gateId: string,
  iid: number,
  title = 'fix the thing'
): QueueEntry {
  return {
    gate: { gateId, status: 'open' } as GateRow,
    mr: { iid, title } as BoardMRWithReview,
  };
}
const session = (over: Partial<QueueSession> = {}): QueueSession => ({
  order: ['g1', 'g2', 'g3'],
  answered: [],
  activeId: 'g1',
  ...over,
});
const entries = [entry('g1', 1), entry('g2', 2), entry('g3', 3)];

test('view maps order to states and 1-based position', () => {
  const v = queueView(session({ answered: ['g1'], activeId: 'g2' }), entries);
  expect(v.states).toEqual(['done', 'active', 'todo']);
  expect(v.position).toBe(2);
  expect(v.nextPeek).toBe('!3 · fix the thing');
});

test('advance skips answered gates, never wraps backwards', () => {
  expect(advance(session({ answered: ['g2'] }), entries, 'g1')).toBe('g3');
  expect(advance(session({ answered: ['g2'] }), entries, 'g3')).toBeNull();
});

test('reconcile appends new gates without reshuffling', () => {
  const next = reconcile(session(), [...entries, entry('g4', 4)]);
  expect(next.order).toEqual(['g1', 'g2', 'g3', 'g4']);
});

test('reconcile retires a vanished active gate the data shows answered', () => {
  const next = reconcile(
    session(),
    [entry('g2', 2), entry('g3', 3)],
    null,
    new Set(['g1'])
  );
  expect(next.answered).toContain('g1');
  expect(next.activeId).toBe('g2');
});

test('reconcile keeps a vanished active gate absent without answer evidence', () => {
  // A transient snapshot (server restart warming its gate cache, a failed
  // poll) must never silently retire a real gate.
  const next = reconcile(session(), [entry('g2', 2), entry('g3', 3)]);
  expect(next.activeId).toBe('g1');
  expect(next.answered).not.toContain('g1');
});

test('reconcile keeps the whole queue through an empty snapshot', () => {
  const next = reconcile(session(), []);
  expect(next.activeId).toBe('g1');
  expect(next.answered).toEqual([]);
});

test('complete when nothing is left', () => {
  const v = queueView(
    session({ answered: ['g1', 'g2', 'g3'], activeId: null }),
    entries
  );
  expect(v.complete).toBe(true);
});

test('a held vanished active stays active even with answer evidence', () => {
  // Hold outranks evidence: the CAS-loss face is showing the winning answer
  // and must survive the refresh that reports the gate answered.
  const next = reconcile(
    session(),
    [entry('g2', 2), entry('g3', 3)],
    'g1',
    new Set(['g1'])
  );
  expect(next.activeId).toBe('g1');
  expect(next.answered).not.toContain('g1');
});

test('hold cleared then reconcile retires the answered vanished active gate', () => {
  const next = reconcile(
    session(),
    [entry('g2', 2), entry('g3', 3)],
    null,
    new Set(['g1'])
  );
  expect(next.answered).toContain('g1');
  expect(next.activeId).toBe('g2');
});

test('advanceOrWrap wraps to the first remaining gate rather than completing', () => {
  // openAt a middle gate, then answer/skip forward off the end of order.
  const s = session({ answered: ['g2', 'g3'], activeId: 'g3' });
  expect(advanceOrWrap(s, entries, 'g3')).toBe('g1');
});

test('advanceOrWrap completes only once every gate is retired', () => {
  const s = session({ answered: ['g1', 'g2', 'g3'], activeId: 'g3' });
  expect(advanceOrWrap(s, entries, 'g3')).toBeNull();
});

test('nextPeek names the successor in order, and nothing on the last gate', () => {
  const middle = session({ answered: ['g3'], activeId: 'g2' });
  expect(queueView(middle, entries).nextPeek).toBe('!3 · fix the thing');
  const last = session({ answered: ['g1', 'g2'], activeId: 'g3' });
  expect(queueView(last, entries).nextPeek).toBeUndefined();
});

test('forward is positional: it steps onto answered and undecided gates alike', () => {
  const s = session({ answered: ['g3'], activeId: 'g1' });
  expect(forwardTo(s, entries, 'g1')).toBe('g2');
  expect(forwardTo(s, entries, 'g2')).toBe('g3');
  expect(forwardTo(s, entries, 'g3')).toBeNull();
  expect(forwardTo(s, entries, null)).toBeNull();
});

test('paging forward to the end and back to the start leaves every gate undecided', () => {
  // The reported path: next 1 -> 4, back three times to 1, next again. It
  // must land on 2, and paging must never change a gate's state.
  const four = ['g1', 'g2', 'g3', 'g4'];
  const fourEntries = four.map((id, i) => entry(id, i + 1));
  let s: QueueSession = { order: four, answered: [], activeId: 'g1' };
  for (let i = 0; i < 3; i++) s = stepForward(s, fourEntries);
  expect(s.activeId).toBe('g4');
  for (let i = 0; i < 3; i++) s = stepBack(s, fourEntries);
  expect(s.activeId).toBe('g1');
  s = stepForward(s, fourEntries);
  expect(s.activeId).toBe('g2');
  expect(queueView(s, fourEntries).states).toEqual([
    'todo',
    'active',
    'todo',
    'todo',
  ]);
});

test('back from the second gate returns to the first', () => {
  expect(backTo(session({ activeId: 'g2' }), entries, 'g2')).toBe('g1');
});

test('back is unavailable at the first', () => {
  expect(backTo(session({ activeId: 'g1' }), entries, 'g1')).toBeNull();
  expect(backTo(session(), entries, null)).toBeNull();
});

test('back passes over a gate that has left the queue, as next does', () => {
  // An answered gate drops out of entries, so there is nothing to show
  // for it; landing there would leave the queue open with no face.
  const s = session({ answered: ['g2'], activeId: 'g3' });
  const left = [entry('g1', 1), entry('g3', 3)];
  expect(backTo(s, left, 'g3')).toBe('g1');
  expect(backTo(s, [entry('g3', 3)], 'g3')).toBeNull();
  expect(stepBack(s, [entry('g3', 3)])).toBe(s);
});

test('each chevron is enabled only when it has a gate to land on', () => {
  const middle = session({ activeId: 'g2' });
  expect(queueView(middle, entries)).toMatchObject({
    canBack: true,
    canNext: true,
  });
  // g1 answered and g3 answered, both gone from entries: position still
  // reads 2 of 3, but neither direction has anywhere to go.
  expect(queueView(middle, [entry('g2', 2)])).toMatchObject({
    position: 2,
    canBack: false,
    canNext: false,
  });
});

test('next on the last gate changes nothing', () => {
  const last = session({ activeId: 'g3' });
  expect(stepForward(last, entries)).toBe(last);
});

test('answering after paging past gates wraps back to the first undecided one', () => {
  // Page to the last gate and answer it: the queue returns to gate 1, not
  // the done face, because paging never decided anything.
  const s = session({ answered: ['g3'], activeId: 'g3' });
  expect(advanceOrWrap(s, entries, 'g3')).toBe('g1');
});

test('the active pip reads "you are here" even on an answered gate', () => {
  const v = queueView(session({ answered: ['g1'], activeId: 'g2' }), entries);
  expect(v.states).toEqual(['done', 'active', 'todo']);
  const back = { ...session({ answered: ['g1'] }), activeId: 'g1' };
  expect(queueView(back, entries).states).toEqual(['active', 'todo', 'todo']);
});
