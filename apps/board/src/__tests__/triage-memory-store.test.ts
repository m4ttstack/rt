import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { openStateDb } from '../state/db.ts';
import { setKvValue } from '../state/kv-blob.ts';
import {
  attachStandDown,
  readMemory,
  releaseCron,
  tryClaimCron,
  writeMemory,
  writeRefreshedIdentity,
  writeStandDown,
} from '../triage/memory-store.ts';
import { emptyMrMemory, type DispatchMemory } from '../triage/memory.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'triage-mem-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('dispatch memory', () => {
  test('read with no row yields an empty memory', () => {
    expect(readMemory(db)).toEqual({ identity: null, mrs: {} });
  });

  test('write/read round-trips', () => {
    const mem: DispatchMemory = {
      identity: { username: 'matt', fetchedAt: 111 },
      mrs: {
        'https://x/mr/1': { ...emptyMrMemory('2026-08-08'), attemptsToday: 2 },
      },
    };
    writeMemory(mem, db);
    expect(readMemory(db)).toEqual(mem);
  });

  test("a miss never aliases the caller's mutations across reads", () => {
    const first = readMemory(db);
    first.identity = { username: 'leaked', fetchedAt: 1 };
    expect(readMemory(db)).toEqual({ identity: null, mrs: {} });
  });

  test('a legacy-imported blob missing identity normalizes to null rather than undefined', () => {
    setKvValue(
      'triage',
      'memory',
      { mrs: { 'https://x/mr/1': emptyMrMemory('2026-08-08') } },
      db
    );
    const mem = readMemory(db);
    expect(mem.identity).toBeNull();
    expect(mem.mrs['https://x/mr/1']).toBeDefined();
  });

  test('a legacy-imported blob missing mrs normalizes to {} instead of throwing on lookup', () => {
    setKvValue(
      'triage',
      'memory',
      { identity: { username: 'alice', fetchedAt: 1 } },
      db
    );
    const mem = readMemory(db);
    expect(mem.mrs).toEqual({});
    expect(() => mem.mrs['https://x/mr/1']).not.toThrow();
  });
});

describe('attachStandDown', () => {
  test('stamps standDown: true only on an MR whose memory row carries the flag', () => {
    const mem: DispatchMemory = {
      identity: null,
      mrs: {
        'https://x/mr/1': { ...emptyMrMemory('d'), standDown: true },
        'https://x/mr/2': { ...emptyMrMemory('d'), standDown: false },
      },
    };
    const mrs = [{ webUrl: 'https://x/mr/1' }, { webUrl: 'https://x/mr/2' }];
    expect(attachStandDown(mrs, mem)).toEqual([
      { webUrl: 'https://x/mr/1', standDown: true },
      { webUrl: 'https://x/mr/2' },
    ]);
  });

  test('an MR with no memory row at all is left untouched', () => {
    const mem: DispatchMemory = { identity: null, mrs: {} };
    expect(attachStandDown([{ webUrl: 'https://x/mr/9' }], mem)).toEqual([
      { webUrl: 'https://x/mr/9' },
    ]);
  });

  test('a webUrl-less row is left untouched rather than throwing', () => {
    const mem: DispatchMemory = { identity: null, mrs: {} };
    expect(attachStandDown([{ webUrl: null }], mem)).toEqual([
      { webUrl: null },
    ]);
  });
});

describe('cron claim', () => {
  test('cron claim refuses a live holder and reclaims a stale one', () => {
    const t1 = tryClaimCron(1_000, db);
    expect(t1).not.toBe(false);
    expect(tryClaimCron(2_000, db)).toBe(false);
    expect(tryClaimCron(1_000 + 3 * 60_000, db)).not.toBe(false);
  });

  test('release only deletes its own token', () => {
    const t1 = tryClaimCron(1_000, db) as string;
    const t2 = tryClaimCron(1_000 + 3 * 60_000, db) as string;
    releaseCron(t1, db);
    expect(tryClaimCron(1_000 + 3 * 60_000 + 1, db)).toBe(false);
    releaseCron(t2, db);
  });

  test('a released claim can be re-acquired immediately', () => {
    const t1 = tryClaimCron(1_000, db) as string;
    releaseCron(t1, db);
    const t2 = tryClaimCron(1_001, db);
    expect(t2).not.toBe(false);
  });

  test('releasing an unheld or foreign token is a no-op', () => {
    const t1 = tryClaimCron(1_000, db) as string;
    releaseCron('some-other-token', db);
    expect(tryClaimCron(1_001, db)).toBe(false); // t1's claim still stands
    releaseCron(t1, db);
  });
});

describe('writeRefreshedIdentity', () => {
  test('merges only identity onto the CURRENT row, never a stale earlier read', () => {
    writeMemory(
      {
        identity: { username: 'old', fetchedAt: 1 },
        mrs: {
          'https://x/mr/1': {
            ...emptyMrMemory('2026-08-08'),
            attemptsToday: 2,
          },
        },
      },
      db
    );
    // Simulate the auto pass writing OTHER fields during this caller's own
    // (already-completed) network round-trip, between its stale read and
    // this write-back.
    const concurrent = readMemory(db);
    concurrent.mrs['https://x/mr/1']!.attemptsToday = 5;
    writeMemory(concurrent, db);

    writeRefreshedIdentity({ username: 'fresh', fetchedAt: 2 }, db);

    const final = readMemory(db);
    expect(final.identity).toEqual({ username: 'fresh', fetchedAt: 2 });
    expect(final.mrs['https://x/mr/1']!.attemptsToday).toBe(5); // not clobbered
  });
});

describe('writeStandDown', () => {
  test('merges only standDown onto the CURRENT row, never a stale earlier read', () => {
    writeMemory(
      {
        identity: null,
        mrs: {
          'https://x/mr/1': {
            ...emptyMrMemory('2026-08-08'),
            attemptsToday: 2,
          },
        },
      },
      db
    );
    // A triage pass writing other fields (attempt budgets) during the gap
    // between this caller's read and its write -- same race
    // writeRefreshedIdentity's own test guards against.
    const concurrent = readMemory(db);
    concurrent.mrs['https://x/mr/1']!.attemptsToday = 5;
    writeMemory(concurrent, db);

    writeStandDown('https://x/mr/1', true, '2026-08-08', db);

    const final = readMemory(db);
    expect(final.mrs['https://x/mr/1']!.standDown).toBe(true);
    expect(final.mrs['https://x/mr/1']!.attemptsToday).toBe(5); // not clobbered
  });

  test('an MR with no memory row yet gets a fresh one', () => {
    writeStandDown('https://x/mr/9', true, '2026-08-08', db);
    const mem = readMemory(db);
    expect(mem.mrs['https://x/mr/9']?.standDown).toBe(true);
    expect(mem.mrs['https://x/mr/9']?.attemptsToday).toBe(0);
  });

  test('on: false clears the flag without touching anything else', () => {
    writeStandDown('https://x/mr/1', true, '2026-08-08', db);
    writeStandDown('https://x/mr/1', false, '2026-08-08', db);
    expect(readMemory(db).mrs['https://x/mr/1']?.standDown).toBe(false);
  });
});
