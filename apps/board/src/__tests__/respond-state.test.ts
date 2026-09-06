import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  pruneRespondStates,
  readRespondReport,
  readRespondStates,
  respondFilePath,
  respondReportPath,
  writeRespondState,
} from '../respond-state.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('writeRespondState counts', () => {
  test('round-trips posted and threads', () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(p, { mrUrl: URL_A, iid: 4821, status: 'queued' }, 1000);
    const done = writeRespondState(
      p,
      { status: 'done', posted: 2, threads: 3 },
      2000
    );
    expect(done.posted).toBe(2);
    expect(done.threads).toBe(3);
    expect(readRespondStates(dir).get(URL_A)?.posted).toBe(2);
  });

  test('keeps a zero posted count, which a truthiness merge would drop', () => {
    const p = respondFilePath(URL_A, dir);
    const done = writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done', posted: 0, threads: 3 },
      1000
    );
    expect(done.posted).toBe(0);
    expect(done.threads).toBe(3);
  });

  test('a later write without counts preserves the ones already on file', () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done', posted: 0, threads: 3 },
      1000
    );
    const resumed = writeRespondState(
      p,
      { status: 'done', tabId: 'w9:t2' },
      2000
    );
    expect(resumed.posted).toBe(0);
    expect(resumed.threads).toBe(3);
  });

  test('a run that reports no counts leaves them undefined', () => {
    const p = respondFilePath(URL_A, dir);
    const done = writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done' },
      1000
    );
    expect(done.posted).toBeUndefined();
    expect(done.threads).toBeUndefined();
  });
});

describe('respondReportPath', () => {
  test('swaps the .json state suffix for .md, same slug convention as reviewReportPath', () => {
    expect(respondReportPath(respondFilePath(URL_A, dir))).toBe(
      respondFilePath(URL_A, dir).replace(/\.json$/, '.md')
    );
    expect(respondReportPath('/s/1.json')).toBe('/s/1.md');
  });
});

describe('gate fields (merge-list widening)', () => {
  test("gateId, gateKind, and resumedGateId all survive an interleaving write that doesn't mention them", () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(
      p,
      {
        mrUrl: URL_A,
        iid: 4821,
        status: 'implementing',
        gateId: 'gate-1',
        gateKind: 'respond-plan',
      },
      1000
    );
    const second = writeRespondState(
      p,
      { status: 'implementing', tabId: 'w9:t2' },
      2000
    );
    expect(second.gateId).toBe('gate-1');
    expect(second.gateKind).toBe('respond-plan');

    const third = writeRespondState(
      p,
      { status: 'implementing', resumedGateId: 'gate-1' },
      3000
    );
    expect(third.resumedGateId).toBe('gate-1');
    const fourth = writeRespondState(
      p,
      { status: 'drafting', gateKind: 'respond-post', gateId: 'gate-2' },
      4000
    );
    expect(fourth.resumedGateId).toBe('gate-1'); // preserved across the next gate's own open
    expect(fourth.gateKind).toBe('respond-post');
    expect(fourth.gateId).toBe('gate-2');
  });
});

describe('respond report', () => {
  test('readRespondReport returns the saved markdown, or null when absent', () => {
    expect(readRespondReport(URL_A, dir)).toBeNull();
    writeFileSync(
      respondReportPath(respondFilePath(URL_A, dir)),
      '# adjudication\n\nlooks good'
    );
    expect(readRespondReport(URL_A, dir)).toBe('# adjudication\n\nlooks good');
  });

  test('readRespondStates flags reportReady when the sibling .md exists', () => {
    const p = respondFilePath(URL_A, dir);
    writeRespondState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'drafting' },
      10_000
    );
    expect(readRespondStates(dir).get(URL_A)?.reportReady).toBe(false);
    writeFileSync(respondReportPath(p), '# adjudication');
    expect(readRespondStates(dir).get(URL_A)?.reportReady).toBe(true);
  });
});

describe('pruneRespondStates', () => {
  const OTHER = 'https://gitlab.com/acme/webapp/-/merge_requests/1';
  test("deletes an off-board state's sibling report with it", () => {
    writeRespondState(respondFilePath(URL_A, dir), {
      mrUrl: URL_A,
      iid: 4821,
      status: 'done',
    });
    writeFileSync(
      respondReportPath(respondFilePath(URL_A, dir)),
      '# adjudication A'
    );
    writeRespondState(respondFilePath(OTHER, dir), {
      mrUrl: OTHER,
      iid: 1,
      status: 'done',
    });
    writeFileSync(
      respondReportPath(respondFilePath(OTHER, dir)),
      '# adjudication OTHER'
    );

    pruneRespondStates(new Set([URL_A]), dir);

    expect(existsSync(respondFilePath(URL_A, dir))).toBe(true);
    expect(existsSync(respondReportPath(respondFilePath(URL_A, dir)))).toBe(
      true
    );
    expect(existsSync(respondFilePath(OTHER, dir))).toBe(false);
    expect(existsSync(respondReportPath(respondFilePath(OTHER, dir)))).toBe(
      false
    );
  });
});
