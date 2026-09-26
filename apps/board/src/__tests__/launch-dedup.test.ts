import { expect, test } from 'bun:test';

import { dedupInFlight, REVIEW_IN_FLIGHT } from '../launch-dedup.ts';

const live = { status: 'reviewing', tabId: 't1', paneId: 'p1' };
const focusOk = { focusPane: async () => ({ focused: true }) };
const focusGone = {
  focusPane: async () => {
    throw new Error('tab not found');
  },
};

test('a live in-flight lane is focused, whatever the click asked for', async () => {
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, false, focusOk)).toEqual({
    kind: 'focused',
  });
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, true, focusOk)).toEqual({
    kind: 'focused',
  });
});

test('a launch click falls through to a fresh launch when nothing is running or the pane is gone', async () => {
  expect(
    await dedupInFlight(undefined, REVIEW_IN_FLIGHT, false, focusOk)
  ).toEqual({ kind: 'launch' });
  expect(
    await dedupInFlight(
      { status: 'done', tabId: 't1' },
      REVIEW_IN_FLIGHT,
      false,
      focusOk
    )
  ).toEqual({ kind: 'launch' });
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, false, focusGone)).toEqual(
    { kind: 'launch' }
  );
});

test('a focus click never launches: it refuses with the reason', async () => {
  expect(await dedupInFlight(live, REVIEW_IN_FLIGHT, true, focusGone)).toEqual({
    kind: 'refused',
    reason: 'pane is gone',
  });
  expect(
    await dedupInFlight(undefined, REVIEW_IN_FLIGHT, true, focusOk)
  ).toEqual({ kind: 'refused', reason: 'nothing running to focus' });
  expect(
    await dedupInFlight(
      { status: 'reviewing' },
      REVIEW_IN_FLIGHT,
      true,
      focusOk
    )
  ).toEqual({ kind: 'refused', reason: 'nothing running to focus' });
});
