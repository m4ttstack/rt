import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { openStateDb } from '../state/db.ts';
import { migrateLegacySessions } from '../gates/legacy-session-migration.ts';
import {
  readRespondStates,
  respondFilePath,
  writeRespondState,
} from '../respond-state.ts';
import {
  readReviewStates,
  reviewFilePath,
  writeReviewState,
} from '../review-state.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lsm-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/4822';

function migrateReview(logged: string[]): void {
  migrateLegacySessions(
    'review',
    readReviewStates(db),
    reviewFilePath,
    (path, patch) => writeReviewState(path, patch, Date.now(), db),
    m => logged.push(m)
  );
}

function migrateRespond(logged: string[]): void {
  migrateLegacySessions(
    'respond',
    readRespondStates(db),
    respondFilePath,
    (path, patch) => writeRespondState(path, patch, Date.now(), db),
    m => logged.push(m)
  );
}

describe('migrateLegacySessions', () => {
  test('clears sessionId on a legacy review state (sessionId set, no agentId)', () => {
    writeReviewState(
      reviewFilePath(URL_A),
      { mrUrl: URL_A, iid: 4821, status: 'done', sessionId: 'sess-1' },
      Date.now(),
      db
    );
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(db).get(URL_A)?.sessionId).toBe('');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(URL_A);
  });

  test('clears sessionId on a legacy respond state (sessionId set, no agentId)', () => {
    writeRespondState(
      respondFilePath(URL_A),
      { mrUrl: URL_A, iid: 4821, status: 'done', sessionId: 'sess-1' },
      Date.now(),
      db
    );
    const logged: string[] = [];
    migrateRespond(logged);
    expect(readRespondStates(db).get(URL_A)?.sessionId).toBe('');
    expect(logged).toHaveLength(1);
  });

  test('leaves an agentId-bearing state untouched', () => {
    writeReviewState(
      reviewFilePath(URL_A),
      {
        mrUrl: URL_A,
        iid: 4821,
        status: 'done',
        sessionId: 'sess-1',
        agentId: 'agent-1',
      },
      Date.now(),
      db
    );
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(db).get(URL_A)?.sessionId).toBe('sess-1');
    expect(logged).toHaveLength(0);
  });

  test('no-ops on a clean state with neither sessionId nor agentId', () => {
    writeReviewState(
      reviewFilePath(URL_A),
      { mrUrl: URL_A, iid: 4821, status: 'queued' },
      Date.now(),
      db
    );
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(db).get(URL_A)?.sessionId).toBeUndefined();
    expect(logged).toHaveLength(0);
  });

  test('no-ops on a clean install (no rows at all)', () => {
    const logged: string[] = [];
    migrateReview(logged);
    migrateRespond(logged);
    expect(logged).toHaveLength(0);
  });

  test('preserves other fields, and only migrates the legacy row among several', () => {
    writeReviewState(
      reviewFilePath(URL_A),
      {
        mrUrl: URL_A,
        iid: 4821,
        status: 'done',
        sessionId: 'sess-1',
        tabId: 'w1:t1',
        outcome: 'approve',
      },
      Date.now(),
      db
    );
    writeReviewState(
      reviewFilePath(URL_B),
      {
        mrUrl: URL_B,
        iid: 4822,
        status: 'done',
        sessionId: 'sess-2',
        agentId: 'agent-2',
      },
      Date.now(),
      db
    );
    const logged: string[] = [];
    migrateReview(logged);
    const states = readReviewStates(db);
    expect(states.get(URL_A)?.sessionId).toBe('');
    expect(states.get(URL_A)?.tabId).toBe('w1:t1');
    expect(states.get(URL_A)?.outcome).toBe('approve');
    expect(states.get(URL_B)?.sessionId).toBe('sess-2');
    expect(logged).toHaveLength(1);
  });
});
