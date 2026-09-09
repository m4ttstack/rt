import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  pruneRespondStates,
  readRespondReport,
  readRespondStates,
  respondFilePath,
  respondReportPath,
  writeRespondState,
} from '../respond-state.ts';
import { setReportByHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rp-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('writeRespondState counts', () => {
  test('round-trips posted and threads', () => {
    const p = respondFilePath(URL_A);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'queued' },
      1000,
      db
    );
    const done = writeRespondState(
      p,
      { status: 'done', posted: 2, threads: 3 },
      2000,
      db
    );
    expect(done.posted).toBe(2);
    expect(done.threads).toBe(3);
    expect(readRespondStates(db).get(URL_A)?.posted).toBe(2);
  });

  test('keeps a zero posted count, which a truthiness merge would drop', () => {
    const p = respondFilePath(URL_A);
    const done = writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done', posted: 0, threads: 3 },
      1000,
      db
    );
    expect(done.posted).toBe(0);
    expect(done.threads).toBe(3);
  });

  test('a later write without counts preserves the ones already on file', () => {
    const p = respondFilePath(URL_A);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done', posted: 0, threads: 3 },
      1000,
      db
    );
    const resumed = writeRespondState(
      p,
      { status: 'done', tabId: 'w9:t2' },
      2000,
      db
    );
    expect(resumed.posted).toBe(0);
    expect(resumed.threads).toBe(3);
  });

  test('a run that reports no counts leaves them undefined', () => {
    const p = respondFilePath(URL_A);
    const done = writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done' },
      1000,
      db
    );
    expect(done.posted).toBeUndefined();
    expect(done.threads).toBeUndefined();
  });
});

describe('writeRespondState identity', () => {
  test('a write with no prior row and no identity throws loudly', () => {
    expect(() =>
      writeRespondState(
        respondFilePath(URL_A),
        { status: 'drafting' },
        1000,
        db
      )
    ).toThrow(/no prior row and no identity/);
  });
});

describe('respondReportPath', () => {
  test('swaps the .json state suffix for .md, same slug convention as reviewReportPath', () => {
    expect(respondReportPath(respondFilePath(URL_A))).toBe(
      respondFilePath(URL_A).replace(/\.json$/, '.md')
    );
    expect(respondReportPath('/s/1.json')).toBe('/s/1.md');
  });
});

describe('gate fields (merge-list widening)', () => {
  test("gateId, gateKind, and resumedGateId all survive an interleaving write that doesn't mention them", () => {
    const p = respondFilePath(URL_A);
    writeRespondState(
      p,
      {
        mrUrl: URL_A,
        iid: 4821,
        status: 'implementing',
        gateId: 'gate-1',
        gateKind: 'respond-plan',
      },
      1000,
      db
    );
    const second = writeRespondState(
      p,
      { status: 'implementing', tabId: 'w9:t2' },
      2000,
      db
    );
    expect(second.gateId).toBe('gate-1');
    expect(second.gateKind).toBe('respond-plan');

    const third = writeRespondState(
      p,
      { status: 'implementing', resumedGateId: 'gate-1' },
      3000,
      db
    );
    expect(third.resumedGateId).toBe('gate-1');
    const fourth = writeRespondState(
      p,
      { status: 'drafting', gateKind: 'respond-post', gateId: 'gate-2' },
      4000,
      db
    );
    expect(fourth.resumedGateId).toBe('gate-1'); // preserved across the next gate's own open
    expect(fourth.gateKind).toBe('respond-post');
    expect(fourth.gateId).toBe('gate-2');
  });
});

describe('respond report', () => {
  test('readRespondReport returns the saved markdown, or null when absent', () => {
    expect(readRespondReport(URL_A, db)).toBeNull();
    const p = respondFilePath(URL_A);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'drafting' },
      1000,
      db
    );
    setReportByHandle(p, '# adjudication\n\nlooks good', db);
    expect(readRespondReport(URL_A, db)).toBe('# adjudication\n\nlooks good');
  });

  test('readRespondStates flags reportReady when a report is on file', () => {
    const p = respondFilePath(URL_A);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'drafting' },
      10_000,
      db
    );
    expect(readRespondStates(db).get(URL_A)?.reportReady).toBe(false);
    setReportByHandle(p, '# adjudication', db);
    expect(readRespondStates(db).get(URL_A)?.reportReady).toBe(true);
  });
});

describe('pruneRespondStates', () => {
  const OTHER = 'https://gitlab.com/acme/webapp/-/merge_requests/1';
  test("deletes an off-board state's sibling report with it", () => {
    const pathA = respondFilePath(URL_A);
    writeRespondState(
      pathA,
      { mrUrl: URL_A, iid: 4821, status: 'done' },
      1000,
      db
    );
    setReportByHandle(pathA, '# adjudication A', db);
    const pathOther = respondFilePath(OTHER);
    writeRespondState(
      pathOther,
      { mrUrl: OTHER, iid: 1, status: 'done' },
      1000,
      db
    );
    setReportByHandle(pathOther, '# adjudication OTHER', db);

    pruneRespondStates(new Set([URL_A]), db);

    expect(readRespondStates(db).has(URL_A)).toBe(true);
    expect(readRespondReport(URL_A, db)).toBe('# adjudication A');
    expect(readRespondStates(db).has(OTHER)).toBe(false);
    expect(readRespondReport(OTHER, db)).toBeNull();
  });
});
