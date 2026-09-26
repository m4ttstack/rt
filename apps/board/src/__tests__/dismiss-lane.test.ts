import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { laneDismissed } from '../client/board/row-status.ts';
import {
  dismissByHandle,
  insertAgentState,
  mintHandle,
  readStates,
  updateByHandle,
} from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

const URL = 'https://gitlab.example.com/g/p/-/merge_requests/7';

function db() {
  return openStateDb(
    join(mkdtempSync(join(tmpdir(), 'board-dl-')), 'state.db')
  );
}

function stuckRow() {
  const d = db();
  const h = mintHandle('doctor', URL, '/tmp/fake-root');
  insertAgentState(
    'doctor',
    URL,
    7,
    {
      mrUrl: URL,
      iid: 7,
      status: 'error',
      message: 'flake',
      startedAt: 1,
      updatedAt: 1,
    },
    h,
    d
  );
  return { d, h };
}

test('a lane is dismissed while it carries the stamp, and not before', () => {
  expect(laneDismissed(undefined)).toBe(false);
  expect(laneDismissed({ status: 'error' } as never)).toBe(false);
  expect(laneDismissed({ status: 'error', dismissedAt: 100 } as never)).toBe(
    true
  );
});

test('dismissByHandle stamps without touching the status or the message', () => {
  const { d, h } = stuckRow();
  const stamped = dismissByHandle(h, 500, d) as {
    status: string;
    message: string;
    dismissedAt: number;
  };
  expect(stamped).toMatchObject({
    status: 'error',
    message: 'flake',
    dismissedAt: 500,
  });
  expect(laneDismissed(readStates('doctor', d).get(URL) as never)).toBe(true);
  expect(dismissByHandle('/nope/state/doctors/x.json', 500, d)).toBeNull();
});

test('any later write drops the stamp, even in the same millisecond', () => {
  const { d, h } = stuckRow();
  dismissByHandle(h, 500, d);
  // The relaunch lands on the same clock tick as the dismissal: presence of
  // the stamp is what counts, so there is no tie to lose.
  const revived = updateByHandle(h, { status: 'queued' }, 500, d) as {
    dismissedAt?: number;
  };
  expect('dismissedAt' in revived).toBe(false);
  expect(laneDismissed(readStates('doctor', d).get(URL) as never)).toBe(false);
});
