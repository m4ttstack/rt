import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

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
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lsm-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/4822';

function migrateReview(logged: string[]): void {
  migrateLegacySessions(
    'review',
    readReviewStates(dir),
    url => reviewFilePath(url, dir),
    writeReviewState,
    m => logged.push(m)
  );
}

function migrateRespond(logged: string[]): void {
  migrateLegacySessions(
    'respond',
    readRespondStates(dir),
    url => respondFilePath(url, dir),
    writeRespondState,
    m => logged.push(m)
  );
}

describe('migrateLegacySessions', () => {
  test('clears sessionId on a legacy review state (sessionId set, no agentId)', () => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'done',
      sessionId: 'sess-1',
    });
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(dir).get(URL_A)?.sessionId).toBe('');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(URL_A);
  });

  test('clears sessionId on a legacy respond state (sessionId set, no agentId)', () => {
    writeRespondState(respondFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'done',
      sessionId: 'sess-1',
    });
    const logged: string[] = [];
    migrateRespond(logged);
    expect(readRespondStates(dir).get(URL_A)?.sessionId).toBe('');
    expect(logged).toHaveLength(1);
  });

  test('leaves an agentId-bearing state untouched', () => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'done',
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(dir).get(URL_A)?.sessionId).toBe('sess-1');
    expect(logged).toHaveLength(0);
  });

  test('no-ops on a clean state with neither sessionId nor agentId', () => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'queued',
    });
    const logged: string[] = [];
    migrateReview(logged);
    expect(readReviewStates(dir).get(URL_A)?.sessionId).toBeUndefined();
    expect(logged).toHaveLength(0);
  });

  test('no-ops on a clean install (no state files at all)', () => {
    const logged: string[] = [];
    migrateReview(logged);
    migrateRespond(logged);
    expect(logged).toHaveLength(0);
  });

  test('preserves other fields, and only migrates the legacy row among several', () => {
    writeReviewState(reviewFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'done',
      sessionId: 'sess-1',
      tabId: 'w1:t1',
      outcome: 'approve',
    });
    writeReviewState(reviewFilePath(URL_B, dir), {
      mrUrl: URL_B,
      iid: 4822,
      status: 'done',
      sessionId: 'sess-2',
      agentId: 'agent-2',
    });
    const logged: string[] = [];
    migrateReview(logged);
    const states = readReviewStates(dir);
    expect(states.get(URL_A)?.sessionId).toBe('');
    expect(states.get(URL_A)?.tabId).toBe('w1:t1');
    expect(states.get(URL_A)?.outcome).toBe('approve');
    expect(states.get(URL_B)?.sessionId).toBe('sess-2');
    expect(logged).toHaveLength(1);
  });
});
