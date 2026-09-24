import { expect, test } from 'bun:test';

import { gateContext, gateOrigin } from '../gates/wait-meta.ts';

const waitMeta = {
  runId: 'r1',
  presentation: 'wait',
  context: 'log in at localhost:4001',
  paneId: 'w4:pC',
  worktree: '/work/aspen',
};

test('the row context wins over meta', () => {
  expect(gateContext({ context: 'row prose', meta: waitMeta })).toBe(
    'row prose'
  );
});

test('an empty row context falls back to meta.context', () => {
  expect(gateContext({ context: null, meta: waitMeta })).toBe(
    'log in at localhost:4001'
  );
  expect(gateContext({ context: '', meta: waitMeta })).toBe(
    'log in at localhost:4001'
  );
});

test('no context anywhere reads as undefined', () => {
  expect(gateContext({ meta: { context: 42 } })).toBeUndefined();
  expect(gateContext({ meta: null })).toBeUndefined();
});

test('the row origin wins over meta', () => {
  expect(gateOrigin({ origin: { paneId: 'p1' }, meta: waitMeta })).toEqual({
    paneId: 'p1',
  });
});

test('a missing row origin is built from meta.paneId and meta.worktree', () => {
  expect(gateOrigin({ origin: null, meta: waitMeta })).toEqual({
    paneId: 'w4:pC',
    worktree: '/work/aspen',
  });
  expect(gateOrigin({ meta: { worktree: '/work/aspen' } })).toEqual({
    worktree: '/work/aspen',
  });
});

test('a row origin with no pane or worktree takes them from meta', () => {
  expect(
    gateOrigin({ origin: { presentation: 'wait' }, meta: waitMeta })
  ).toEqual({
    presentation: 'wait',
    paneId: 'w4:pC',
    worktree: '/work/aspen',
  });
});

test('meta with no pane or worktree yields no origin', () => {
  expect(gateOrigin({ meta: { runId: 'r1' } })).toBeUndefined();
  expect(gateOrigin({})).toBeUndefined();
});
