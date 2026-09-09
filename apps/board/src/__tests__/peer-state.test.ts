import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  markNudgeHandled,
  NUDGE_NO_RESPONSE_MS,
  pruneNudges,
  pruneSentNudges,
  readNudges,
  readSentNudges,
  resolveSentNudge,
  retireSentNudge,
  sentNudgeDisplay,
  writeNudge,
  writeSentNudge,
  type NudgeState,
  type SentNudge,
} from '../peer/nudges.ts';
import {
  attachPeerReviews,
  peerReviewFilePath,
  prunePeerReviews,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from '../peer/peer-reviews.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ps-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/1';

describe('peerReviewFilePath', () => {
  test('is deterministic and lives under the dir', () => {
    expect(peerReviewFilePath(URL_A, 'grace', dir)).toBe(
      peerReviewFilePath(URL_A, 'grace', dir)
    );
    expect(peerReviewFilePath(URL_A, 'grace', dir).startsWith(dir)).toBe(true);
    expect(peerReviewFilePath(URL_A, 'grace', dir).endsWith('.json')).toBe(
      true
    );
  });
});

describe('writePeerReview', () => {
  const base = (over: Partial<PeerReviewState> = {}): PeerReviewState => ({
    mrUrl: URL_A,
    iid: 4821,
    reviewer: 'grace',
    status: 'reviewing',
    updatedAt: 1000,
    ...over,
  });

  test('first write returns true and persists', () => {
    expect(writePeerReview(base(), dir)).toBe(true);
    expect(readPeerReviews(dir).get(URL_A)?.[0]?.status).toBe('reviewing');
  });

  test('a newer write wins over an older one', () => {
    writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), dir);
    expect(
      writePeerReview(base({ updatedAt: 2000, status: 'done' }), dir)
    ).toBe(true);
    expect(readPeerReviews(dir).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('an older (stale) write returns false and does not clobber the newer state', () => {
    writePeerReview(base({ updatedAt: 2000, status: 'done' }), dir);
    expect(
      writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), dir)
    ).toBe(false);
    expect(readPeerReviews(dir).get(URL_A)?.[0]?.status).toBe('done');
  });
});

describe('readPeerReviews', () => {
  test('groups two reviewers under one mrUrl', () => {
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'grace',
        status: 'reviewing',
        updatedAt: 1,
      },
      dir
    );
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'ada',
        status: 'done',
        updatedAt: 1,
      },
      dir
    );
    const map = readPeerReviews(dir);
    const reviewers = map
      .get(URL_A)
      ?.map(r => r.reviewer)
      .sort();
    expect(reviewers).toEqual(['ada', 'grace']);
  });

  test('returns empty map when dir is missing', () => {
    expect(readPeerReviews(join(dir, 'nope')).size).toBe(0);
  });
});

describe('prunePeerReviews', () => {
  test('keeps states whose MR is kept, deletes the rest', () => {
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'grace',
        status: 'reviewing',
        updatedAt: 1,
      },
      dir
    );
    writePeerReview(
      {
        mrUrl: URL_B,
        iid: 1,
        reviewer: 'grace',
        status: 'reviewing',
        updatedAt: 1,
      },
      dir
    );

    prunePeerReviews(new Set([URL_A]), dir);

    expect(existsSync(peerReviewFilePath(URL_A, 'grace', dir))).toBe(true);
    expect(existsSync(peerReviewFilePath(URL_B, 'grace', dir))).toBe(false);
  });
});

describe('attachPeerReviews', () => {
  test('attaches peerReviews by webUrl, leaves others untouched', () => {
    const map = new Map<string, PeerReviewState[]>([
      [
        URL_A,
        [
          {
            mrUrl: URL_A,
            iid: 4821,
            reviewer: 'grace',
            status: 'reviewing',
            updatedAt: 1,
          },
        ],
      ],
    ]);
    const [a, b] = attachPeerReviews(
      [{ webUrl: URL_A }, { webUrl: 'https://other/mr/9' }],
      map
    );
    expect(a!.peerReviews?.length).toBe(1);
    expect(b!.peerReviews).toBeUndefined();
  });
});

describe('writeNudge / readNudges', () => {
  const n = (over: Partial<NudgeState> = {}): NudgeState => ({
    id: 'n1',
    mrUrl: URL_A,
    iid: 4821,
    from: 'ada',
    receivedAt: 1,
    ...over,
  });

  test('dedupes by id -- second write with same id is a no-op', () => {
    writeNudge(n({ note: 'first' }), db);
    writeNudge(n({ note: 'second' }), db);
    const all = readNudges(db);
    expect(all.length).toBe(1);
    expect(all[0]!.note).toBe('first');
  });

  test('readNudges returns empty array with no rows', () => {
    expect(readNudges(db)).toEqual([]);
  });
});

describe('markNudgeHandled', () => {
  test('round-trips the handled result and reason', () => {
    writeNudge(
      { id: 'n1', mrUrl: URL_A, iid: 4821, from: 'ada', receivedAt: 1 },
      db
    );
    markNudgeHandled('n1', 'launched', 'checked out and ran it', db, 5000);
    const handled = readNudges(db).find(x => x.id === 'n1');
    expect(handled?.handled).toEqual({
      at: 5000,
      result: 'launched',
      reason: 'checked out and ran it',
    });
  });
});

describe('pruneNudges', () => {
  test('keeps nudges whose MR is kept, deletes the rest', () => {
    writeNudge(
      { id: 'n1', mrUrl: URL_A, iid: 4821, from: 'ada', receivedAt: 1 },
      db
    );
    writeNudge(
      { id: 'n2', mrUrl: URL_B, iid: 1, from: 'ada', receivedAt: 1 },
      db
    );
    pruneNudges(new Set([URL_A]), db);
    const ids = readNudges(db).map(x => x.id);
    expect(ids).toEqual(['n1']);
  });
});

describe('writeSentNudge / readSentNudges', () => {
  test('one row per MR, keyed by mrUrl on read', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    const map = readSentNudges(db);
    expect(map.get(URL_A)?.nudgeId).toBe('n1');
  });
});

describe('resolveSentNudge', () => {
  test('is a no-op when no row exists for the MR', () => {
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    expect(readSentNudges(db).size).toBe(0);
  });

  test('merges the resolution into the existing sent-nudge row', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 10,
    });
  });

  test('does not overwrite an existing terminal resolution', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'rejected', at: 20 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 10,
    });
  });

  test("a 'confirmed' resolution may still be replaced by a later terminal result", () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'confirmed', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'launched', at: 20 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 20,
    });
  });
});

describe('retireSentNudge', () => {
  test('is a no-op when no row exists for the MR', () => {
    retireSentNudge(URL_A, 10, db);
    expect(readSentNudges(db).size).toBe(0);
  });

  test('deletes the sent nudge when it was sent before the cutoff', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 5 }, db);
    retireSentNudge(URL_A, 10, db);
    expect(readSentNudges(db).has(URL_A)).toBe(false);
  });

  test("keeps a nudge sent at or after the cutoff, so a redelivered old 'done' cannot clear a fresh ask", () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 20 },
      db
    );
    retireSentNudge(URL_A, 10, db);
    expect(readSentNudges(db).has(URL_A)).toBe(true);
    retireSentNudge(URL_A, 20, db);
    expect(readSentNudges(db).has(URL_A)).toBe(true);
  });

  test('only retires the named MR', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_B, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    retireSentNudge(URL_A, 10, db);
    const map = readSentNudges(db);
    expect(map.has(URL_A)).toBe(false);
    expect(map.has(URL_B)).toBe(true);
  });
});

describe('pruneSentNudges', () => {
  test('keeps sent nudges whose MR is kept, deletes the rest', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_B, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    pruneSentNudges(new Set([URL_A]), db);
    const map = readSentNudges(db);
    expect(map.has(URL_A)).toBe(true);
    expect(map.has(URL_B)).toBe(false);
  });
});

describe('sentNudgeDisplay', () => {
  test('honours resolution then self-expiry', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    expect(sentNudgeDisplay(base, 1)).toBe('requested');
    expect(sentNudgeDisplay(base, NUDGE_NO_RESPONSE_MS + 1)).toBe(
      'no-response'
    );
    expect(
      sentNudgeDisplay(
        { ...base, resolution: { result: 'launched', at: 5 } },
        NUDGE_NO_RESPONSE_MS + 1
      )
    ).toBe('launched');
    expect(
      sentNudgeDisplay(
        { ...base, resolution: { result: 'confirmed', at: 5 } },
        6
      )
    ).toBe('confirmed');
  });
});
