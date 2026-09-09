import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  attachReviews,
  parseReviewRequestBody,
  pruneReviewStates,
  readReviewReport,
  readReviewStates,
  reviewFilePath,
  reviewReportPath,
  writeReviewState,
} from '../review-state.ts';
import { setReportByHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rs-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('reviewFilePath', () => {
  test('is deterministic', () => {
    expect(reviewFilePath(URL_A)).toBe(reviewFilePath(URL_A));
    expect(reviewFilePath(URL_A).endsWith('.json')).toBe(true);
  });
});

describe('writeReviewState', () => {
  test('creates a row, sets startedAt on first write, merges on second', () => {
    const p = reviewFilePath(URL_A);
    const first = writeReviewState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'queued', tabId: 'w9:t2' },
      1000,
      db
    );
    expect(first.startedAt).toBe(1000);
    expect(first.status).toBe('queued');
    const second = writeReviewState(p, { status: 'reviewing' }, 2000, db);
    expect(second.startedAt).toBe(1000); // preserved
    expect(second.updatedAt).toBe(2000); // advanced
    expect(second.tabId).toBe('w9:t2'); // preserved
    expect(second.mrUrl).toBe(URL_A); // preserved
    expect(second.status).toBe('reviewing');
  });

  test('a write with no prior row and no identity throws loudly', () => {
    expect(() =>
      writeReviewState(reviewFilePath(URL_A), { status: 'reviewing' }, 1000, db)
    ).toThrow(/no prior row and no identity/);
  });

  test("gateKind survives an interleaving write that doesn't mention it (merge-list widening)", () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(
      p,
      {
        mrUrl: URL_A,
        iid: 4821,
        status: 'reviewing',
        gateId: 'gate-1',
        gateKind: 'review-post',
      },
      1000,
      db
    );
    const second = writeReviewState(
      p,
      { status: 'reviewing', paneId: 'pane-2' },
      2000,
      db
    );
    expect(second.gateId).toBe('gate-1');
    expect(second.gateKind).toBe('review-post');
  });
});

describe('readReviewStates', () => {
  test('maps every state by mrUrl, regardless of age (no age pruning)', () => {
    writeReviewState(
      reviewFilePath(URL_A),
      { mrUrl: URL_A, iid: 4821, status: 'reviewing' },
      10_000,
      db
    );
    // An old row is NOT pruned on read... retention is by board membership now.
    const oldUrl = 'https://gitlab.com/acme/webapp/-/merge_requests/1';
    writeReviewState(
      reviewFilePath(oldUrl),
      { mrUrl: oldUrl, iid: 1, status: 'done' },
      0,
      db
    );
    const map = readReviewStates(db);
    expect(map.get(URL_A)?.status).toBe('reviewing');
    expect(map.has(oldUrl)).toBe(true);
  });

  test('returns empty map when there are no rows', () => {
    expect(readReviewStates(db).size).toBe(0);
  });
});

describe('pruneReviewStates', () => {
  const OTHER = 'https://gitlab.com/acme/webapp/-/merge_requests/1';
  test('keeps states whose MR is on the board, deletes the rest (and their reports)', () => {
    const pathA = reviewFilePath(URL_A);
    writeReviewState(
      pathA,
      { mrUrl: URL_A, iid: 4821, status: 'done' },
      1000,
      db
    );
    setReportByHandle(pathA, '# review A', db);
    const pathOther = reviewFilePath(OTHER);
    writeReviewState(
      pathOther,
      { mrUrl: OTHER, iid: 1, status: 'done' },
      1000,
      db
    );
    setReportByHandle(pathOther, '# review OTHER', db);

    pruneReviewStates(new Set([URL_A]), db); // only URL_A still on the board

    expect(readReviewStates(db).has(URL_A)).toBe(true);
    expect(readReviewReport(URL_A, db)).toBe('# review A');
    expect(readReviewStates(db).has(OTHER)).toBe(false); // pruned
    expect(readReviewReport(OTHER, db)).toBeNull(); // report gone too
  });
});

describe('review report', () => {
  test('reportPath is the state handle with a .md extension', () => {
    expect(reviewReportPath(reviewFilePath(URL_A))).toBe(
      reviewFilePath(URL_A).replace(/\.json$/, '.md')
    );
    expect(reviewReportPath('/s/1.json')).toBe('/s/1.md');
  });

  test('readReviewReport returns the saved markdown, or null when absent', () => {
    expect(readReviewReport(URL_A, db)).toBeNull();
    const p = reviewFilePath(URL_A);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: 'done' }, 1000, db);
    setReportByHandle(p, '# Review\n\nlooks good', db);
    expect(readReviewReport(URL_A, db)).toBe('# Review\n\nlooks good');
  });

  test('readReviewStates flags reportReady when a report is on file', () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(
      p,
      { mrUrl: URL_A, iid: 4821, status: 'done' },
      10_000,
      db
    );
    expect(readReviewStates(db).get(URL_A)?.reportReady).toBe(false);
    setReportByHandle(p, '# Review', db);
    expect(readReviewStates(db).get(URL_A)?.reportReady).toBe(true);
  });
});

describe('parseReviewRequestBody', () => {
  test('accepts a well-formed body', () => {
    expect(parseReviewRequestBody({ mrUrl: URL_A, iid: 4821 })).toEqual({
      mrUrl: URL_A,
      iid: 4821,
    });
  });
  test('rejects bad shapes', () => {
    expect(parseReviewRequestBody({ mrUrl: URL_A })).toBeNull();
    expect(parseReviewRequestBody({ mrUrl: 5, iid: 1 })).toBeNull();
    expect(parseReviewRequestBody(null)).toBeNull();
  });
});

describe('attachReviews', () => {
  test('attaches review by webUrl, leaves others untouched', () => {
    const reviews = new Map([
      [
        URL_A,
        {
          mrUrl: URL_A,
          iid: 4821,
          status: 'reviewing' as const,
          startedAt: 0,
          updatedAt: 0,
        },
      ],
    ]);
    const [a, b] = attachReviews(
      [{ webUrl: URL_A }, { webUrl: 'https://other/mr/9' }],
      reviews
    );
    expect(a!.review?.status).toBe('reviewing');
    expect(b!.review).toBeUndefined();
  });
});
