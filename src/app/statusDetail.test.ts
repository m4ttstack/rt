import { expect, test } from 'vitest';

import { STATUS_WORD, statusDetail } from './statusDetail';

const now = 1_700_000_000_000;

test("statusDetail explains the daemon's status; it never contradicts it", () => {
  expect(
    statusDetail({ status: 'live', lastSeenAt: now - 12_000 }, now)
  ).toBe('seen 12s ago');
  expect(
    statusDetail({ status: 'idle', lastSeenAt: now - 9 * 60_000 }, now)
  ).toBe('seen 9m ago');
  expect(
    statusDetail({ status: 'offline', signedOutAt: now - 2 * 60 * 60_000 }, now)
  ).toBe('signed out 2h ago');
  expect(STATUS_WORD.live).toBe('working');
});

test('a live row with no lastSeenAt reads mid-turn rather than inventing a heartbeat', () => {
  expect(statusDetail({ status: 'live' }, now)).toBe('mid-turn');
});

test('rows missing every optional field still produce a phrase, never throw', () => {
  expect(statusDetail({ status: 'live' }, now)).toBe('mid-turn');
  expect(statusDetail({ status: 'idle' }, now)).toBe('idle');
  expect(statusDetail({ status: 'offline' }, now)).toBe('signed out');
});
