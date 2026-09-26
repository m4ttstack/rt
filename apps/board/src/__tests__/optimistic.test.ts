import { expect, test } from 'bun:test';

import {
  anyActive,
  clearServerTruth,
  EMPTY_OPTIMISTIC,
  MERGE_HOLD_MS,
  nextMergeLapse,
  overlay,
  overlayMerging,
  rollback,
  setQueued,
  settleMerging,
} from '../client/board/optimistic.ts';
import type { BoardMRWithReview } from '../client/types.ts';

const mr = (webUrl: string, extra: Partial<BoardMRWithReview> = {}) =>
  ({
    webUrl,
    iid: 1,
    author: { username: 'm' },
    ...extra,
  }) as BoardMRWithReview;

test('setQueued marks one axis/url queued without touching others', () => {
  const s = setQueued(EMPTY_OPTIMISTIC, 'review', 'u1');
  expect(s.review['u1']).toEqual({ status: 'queued' });
  expect(s.respond).toEqual({});
});

test('rollback removes exactly that entry', () => {
  let s = setQueued(EMPTY_OPTIMISTIC, 'review', 'u1');
  s = setQueued(s, 'review', 'u2');
  s = rollback(s, 'review', 'u1');
  expect(Object.keys(s.review)).toEqual(['u2']);
});

test('clearServerTruth drops an optimistic entry once the server reports that axis, and returns the same reference when nothing changed', () => {
  let s = setQueued(EMPTY_OPTIMISTIC, 'review', 'u1');
  const cleared = clearServerTruth(s, [
    mr('u1', { review: { status: 'reviewing' } }),
  ]);
  expect(cleared.review['u1']).toBeUndefined();
  const untouched = clearServerTruth(cleared, [
    mr('u1', { review: { status: 'reviewing' } }),
  ]);
  expect(untouched).toBe(cleared);
  // a server respond does NOT clear an optimistic review
  const s2 = setQueued(EMPTY_OPTIMISTIC, 'review', 'u1');
  expect(
    clearServerTruth(s2, [mr('u1', { respond: { status: 'triaging' } })])
      .review['u1']
  ).toBeDefined();
});

test('anyActive: optimistic queued counts; server done does not; server triaging does', () => {
  expect(anyActive(setQueued(EMPTY_OPTIMISTIC, 'doctor', 'u'), [])).toBe(true);
  expect(
    anyActive(EMPTY_OPTIMISTIC, [mr('u', { review: { status: 'done' } })])
  ).toBe(false);
  expect(
    anyActive(EMPTY_OPTIMISTIC, [mr('u', { respond: { status: 'triaging' } })])
  ).toBe(true);
  expect(
    anyActive(EMPTY_OPTIMISTIC, [mr('u', { doctor: { status: 'watching' } })])
  ).toBe(true);
});

test('overlay: server state wins over optimistic; optimistic fills gaps only', () => {
  const s = setQueued(
    setQueued(EMPTY_OPTIMISTIC, 'review', 'u1'),
    'respond',
    'u1'
  );
  const [out] = overlay([mr('u1', { review: { status: 'error' } })], s);
  expect(out!.review).toEqual({ status: 'error' }); // server wins
  expect(out!.respond).toEqual({ status: 'queued' }); // optimistic fills
});

const IDLE = { visible: true, disabled: false, loading: false, label: 'Merge' };
const open = (webUrl: string, blockers: Record<string, unknown> = {}) =>
  mr(webUrl, {
    mergeButton: IDLE,
    blockers: { any: false, ...blockers },
  } as Partial<BoardMRWithReview>);

test('overlayMerging: a fired merge reads as GitLab merging on that row only', () => {
  const rows = [open('u1'), open('u2')];
  const [one, two] = overlayMerging(rows, new Map([['u1', 0]]));
  expect(one!.mergeButton).toEqual({ ...IDLE, loading: true });
  expect(two).toBe(rows[1]);
  expect(overlayMerging(rows, new Map())).toBe(rows);
});

test('settleMerging holds through a lagging sync and lets go once the MR leaves or GitLab records a merge error', () => {
  const held = new Map([
    ['u1', 0],
    ['u2', 0],
    ['u3', 0],
  ]);
  const settled = settleMerging(
    held,
    [open('u1'), open('u3', { any: true, hasMergeError: true })],
    1000
  );
  expect([...settled.keys()]).toEqual(['u1']);
  const still = new Map([['u1', 0]]);
  expect(settleMerging(still, [open('u1')], 1000)).toBe(still);
});

test('settleMerging lets go of a merge still open after the hold limit', () => {
  const held = new Map([
    ['old', 0],
    ['new', MERGE_HOLD_MS],
  ]);
  const settled = settleMerging(
    held,
    [open('old'), open('new')],
    MERGE_HOLD_MS + 1
  );
  expect([...settled.keys()]).toEqual(['new']);
});

test('nextMergeLapse waits for the earliest held merge to pass the hold limit', () => {
  const held = new Map([
    ['a', 1000],
    ['b', 500],
  ]);
  const wait = nextMergeLapse(held, 600);
  expect(wait).toBe(500 + MERGE_HOLD_MS - 600 + 1);
  const later = 600 + wait!;
  expect([
    ...settleMerging(held, [open('a'), open('b')], later).keys(),
  ]).toEqual(['a']);
  expect(nextMergeLapse(held, 10 * MERGE_HOLD_MS)).toBe(0);
  expect(nextMergeLapse(new Map(), 0)).toBeNull();
});
