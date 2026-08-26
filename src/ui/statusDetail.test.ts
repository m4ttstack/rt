import { expect, test } from 'vitest';

import { STATUS_WORD, statusDetail } from './statusDetail';

const now = 1_700_000_000_000;

test("statusDetail explains the daemon's status; it never contradicts it", () => {
  expect(
    statusDetail(
      { status: 'live', armedAt: now - 1000, tailSeenAt: now - 12_000 },
      now
    )
  ).toBe('armed · touched 12s ago');
  expect(
    statusDetail({ status: 'idle', lastSeenAt: now - 9 * 60_000 }, now)
  ).toBe('no tail · prompted 9m ago');
  expect(
    statusDetail(
      {
        status: 'deaf',
        armedAt: now - 30 * 60_000,
        tailSeenAt: now - 22 * 60_000,
      },
      now
    )
  ).toBe('armed, silent 22m — tail died');
  expect(
    statusDetail({ status: 'deaf', tailSeenAt: now - 2 * 60 * 60_000 }, now)
  ).toBe('silent 2h');
  expect(
    statusDetail({ status: 'offline', signedOutAt: now - 2 * 60 * 60_000 }, now)
  ).toBe('signed out 2h ago');
  expect(STATUS_WORD.live).toBe('listening');
});

test('a live row with no armedAt drops the "armed" fragment rather than inventing one', () => {
  expect(statusDetail({ status: 'live', tailSeenAt: now - 5000 }, now)).toBe(
    'touched 5s ago'
  );
});

test('rows missing every optional field still produce a phrase, never throw', () => {
  expect(statusDetail({ status: 'live' }, now)).toBe('no tail');
  expect(statusDetail({ status: 'idle' }, now)).toBe('no tail');
  expect(statusDetail({ status: 'deaf' }, now)).toBe('silent');
  expect(statusDetail({ status: 'offline' }, now)).toBe('signed out');
});
