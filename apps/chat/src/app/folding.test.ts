import type { ChatMessage } from '@mattstack/rt-client';
import { expect, test } from 'vitest';

import { firstBlockOf, foldPlan, readBoundary } from './folding';

function msg(id: number, body: string): ChatMessage {
  return {
    id,
    room: 'build',
    handle: 'fred',
    body,
    mentions: [],
    postedAt: id,
  };
}

test('readBoundary matches messages.length - unreadCount, clamped', () => {
  expect(readBoundary(5, 2)).toBe(3);
  expect(readBoundary(5, undefined)).toBe(5);
  expect(readBoundary(5, 0)).toBe(5);
  expect(readBoundary(5, 9)).toBe(0);
});

test('messages before the boundary fold, those at or after it render whole', () => {
  const msgs = [msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd')];
  const plan = foldPlan(msgs, 2);
  expect(readBoundary(msgs.length, 2)).toBe(2);
  expect(plan.get(1)?.folded).toBe(true);
  expect(plan.get(2)?.folded).toBe(true);
  expect(plan.get(3)?.folded).toBe(false);
  expect(plan.get(4)?.folded).toBe(false);
});

test('an undefined or zero unreadCount folds every message', () => {
  const msgs = [msg(1, 'a'), msg(2, 'b')];
  expect([...foldPlan(msgs, undefined).values()].every(e => e.folded)).toBe(
    true
  );
  expect([...foldPlan(msgs, 0).values()].every(e => e.folded)).toBe(true);
});

test('an unreadCount covering every message folds none', () => {
  const msgs = [msg(1, 'a'), msg(2, 'b')];
  const plan = foldPlan(msgs, 5);
  expect([...plan.values()].every(e => !e.folded)).toBe(true);
});

test('the anchored message never folds, even before the boundary', () => {
  const msgs = [msg(1, 'a'), msg(2, 'b'), msg(3, 'c')];
  const plan = foldPlan(msgs, 1, 'm-1');
  expect(plan.get(1)?.folded).toBe(false);
  expect(plan.get(2)?.folded).toBe(true);
});

test('moreLines counts the second paragraph, not the first', () => {
  const plan = foldPlan([msg(1, 'first line\n\nsecond\nthird')], undefined);
  expect(plan.get(1)).toEqual({ folded: true, moreLines: 2 });
});

test('moreLines is 0 for a single-block body', () => {
  const plan = foldPlan([msg(1, 'one line, no blank split')], undefined);
  expect(plan.get(1)).toEqual({ folded: true, moreLines: 0 });
});

test('a blank line inside a fenced block never splits the fence into a further block', () => {
  const body = 'heads up:\n\n```\nfirst\n\nsecond\n```';
  const plan = foldPlan([msg(1, body)], undefined);
  // Two blocks: the paragraph, then the whole fence (5 lines) as one block
  // despite the blank line inside it.
  expect(plan.get(1)?.moreLines).toBe(5);
  expect(firstBlockOf(body)).toBe('heads up:');
});

test('firstBlockOf returns only the first paragraph of a multi-block body', () => {
  expect(firstBlockOf('para one\nstill one\n\npara two')).toBe(
    'para one\nstill one'
  );
});

test('firstBlockOf returns the whole body when it is a single block', () => {
  expect(firstBlockOf('just one line')).toBe('just one line');
});

test('a fence starts its own block even with no blank line before it', () => {
  // A lead line running straight into a fence -- no blank line -- is how
  // agents actually post; the fence must still fold away, not leak into
  // the first block.
  const body = 'heads up:\n```\nfirst\n```';
  const plan = foldPlan([msg(1, body)], undefined);
  expect(firstBlockOf(body)).toBe('heads up:');
  expect(plan.get(1)?.moreLines).toBe(3);
});
