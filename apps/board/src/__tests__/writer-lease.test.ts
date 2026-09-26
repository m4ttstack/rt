import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { openStateDb } from '../state/db.ts';
import {
  beatStillValid,
  claimWriterLease,
  LEASE_STALE_MS,
  renewWriterLease,
  stateWriterLeaseIo,
  writerRank,
  type WriterLeaseIo,
  type WriterLeaseRow,
} from '../state/writer-lease.ts';

const NOW = 1_000_000;

function held(over: Partial<WriterLeaseRow> = {}): WriterLeaseRow {
  return { pid: 7, rank: 0, bootedAt: NOW - 5_000, beatAt: NOW, ...over };
}

/** A lease store in a variable: `transact` decides and writes in one step,
    the way the sqlite io does inside its transaction. `refuse` stands in for
    a db that would not answer. */
function io(
  over: {
    row?: WriterLeaseRow | null;
    alive?: (pid: number) => boolean;
    now?: () => number;
    pid?: number;
    rank?: number;
    refuse?: boolean;
  } = {}
): WriterLeaseIo & { stored: WriterLeaseRow | null } {
  let stored = over.row ?? null;
  const deps: WriterLeaseIo = {
    read: () => stored,
    transact: decide => {
      if (over.refuse) return 'unknown';
      const next = decide(stored);
      if (!next) return 'lost';
      stored = next;
      return 'held';
    },
    alive: over.alive ?? (() => true),
    now: over.now ?? (() => NOW),
    pid: over.pid ?? 42,
    rank: over.rank ?? 0,
  };
  return Object.defineProperty(deps, 'stored', {
    get: () => stored,
  }) as WriterLeaseIo & { stored: WriterLeaseRow | null };
}

describe('claimWriterLease', () => {
  test('claims an unheld lease and records this process', () => {
    const deps = io({ row: null });

    expect(claimWriterLease(deps)).toBe('held');
    expect(deps.stored).toEqual({
      pid: 42,
      rank: 0,
      bootedAt: NOW,
      beatAt: NOW,
    });
  });

  test('refuses while an equal-rank holder is alive and beating', () => {
    const deps = io({ row: held() });

    expect(claimWriterLease(deps)).toBe('lost');
    expect(deps.stored).toEqual(held());
  });

  test('takes over from a holder whose process is gone', () => {
    const deps = io({ row: held(), alive: () => false });

    expect(claimWriterLease(deps)).toBe('held');
    expect(deps.stored?.pid).toBe(42);
  });

  test('takes over from a holder whose heartbeat went stale', () => {
    const deps = io({ row: held({ beatAt: NOW - LEASE_STALE_MS - 1 }) });

    expect(claimWriterLease(deps)).toBe('held');
    expect(deps.stored?.pid).toBe(42);
  });

  test('outranks a live holder of lower rank', () => {
    const deps = io({ row: held({ rank: 0 }), rank: 1 });

    expect(claimWriterLease(deps)).toBe('held');
    expect(deps.stored).toEqual({
      pid: 42,
      rank: 1,
      bootedAt: NOW,
      beatAt: NOW,
    });
  });

  test('stays read-only under a live holder of higher rank', () => {
    const deps = io({ row: held({ rank: 1 }), rank: 0 });

    expect(claimWriterLease(deps)).toBe('lost');
    expect(deps.stored).toEqual(held({ rank: 1 }));
  });

  // Fail closed at boot: an unanswered db is no proof the lease is ours, and
  // the process that already holds it keeps writing regardless.
  test('a db that will not answer is not a claim', () => {
    const deps = io({ row: null, refuse: true });

    expect(claimWriterLease(deps)).toBe('unknown');
    expect(deps.stored).toBeNull();
  });
});

describe('renewWriterLease', () => {
  test('refreshes the heartbeat while we still hold the lease', () => {
    const deps = io({ row: held({ pid: 42, beatAt: NOW - 20_000 }) });

    expect(renewWriterLease(deps)).toBe('held');
    expect(deps.stored?.beatAt).toBe(NOW);
    expect(deps.stored?.bootedAt).toBe(NOW - 5_000);
  });

  test('reports the lease lost once another process holds it', () => {
    const deps = io({ row: held({ pid: 9, rank: 1 }) });

    expect(renewWriterLease(deps)).toBe('lost');
    expect(deps.stored).toEqual(held({ pid: 9, rank: 1 }));
  });

  test('retakes a lease row that vanished under it', () => {
    const deps = io({ row: null });

    expect(renewWriterLease(deps)).toBe('held');
    expect(deps.stored?.pid).toBe(42);
  });

  // Distinct from 'lost' on purpose: state.db runs a 250ms busy timeout, so
  // a contended write is routine and must not retire a live writer.
  test('a db that will not answer is unknown, not lost', () => {
    const deps = io({ row: held({ pid: 42 }), refuse: true });

    expect(renewWriterLease(deps)).toBe('unknown');
  });
});

describe('beatStillValid', () => {
  test('ownership outlives an unanswered beat until the stale window', () => {
    expect(beatStillValid(NOW - LEASE_STALE_MS + 1, NOW)).toBe(true);
    expect(beatStillValid(NOW - LEASE_STALE_MS, NOW)).toBe(false);
  });
});

describe('stateWriterLeaseIo', () => {
  function freshDb() {
    return openStateDb(
      join(mkdtempSync(join(tmpdir(), 'board-lease-')), 'state.db'),
      'server'
    );
  }

  // The holder is this test process, so the real signal-0 probe reports it
  // alive -- a made-up pid would read as dead and free the lease.
  test('two processes on one state db: the live holder keeps the lease', () => {
    const db = freshDb();
    const holder = stateWriterLeaseIo({ pid: process.pid, rank: 0, db });
    const other = stateWriterLeaseIo({ pid: process.pid + 1, rank: 0, db });

    expect(claimWriterLease(holder)).toBe('held');
    expect(claimWriterLease(other)).toBe('lost');
    expect(other.read()?.pid).toBe(process.pid);
    expect(renewWriterLease(holder)).toBe('held');
    db.close();
  });

  test('the row survives the round trip through kv', () => {
    const db = freshDb();
    const deps = stateWriterLeaseIo({ pid: 303, rank: 1, db });

    claimWriterLease(deps);

    const row = deps.read();
    expect(row?.pid).toBe(303);
    expect(row?.rank).toBe(1);
    expect(row?.beatAt).toBeGreaterThan(0);
    db.close();
  });

  // The read that drives the decision happens inside the transaction, so a
  // claim can never be decided from a row that has since been taken.
  test('the decision reads the row inside the transaction', () => {
    const db = freshDb();
    const first = stateWriterLeaseIo({ pid: process.pid, rank: 0, db });
    const second = stateWriterLeaseIo({ pid: process.pid + 1, rank: 0, db });

    claimWriterLease(first);
    const seen: (number | null)[] = [];
    second.transact(row => {
      seen.push(row?.pid ?? null);
      return null;
    });

    expect(seen).toEqual([process.pid]);
    db.close();
  });

  // pid 1 is launchd: alive, root-owned, and so a signal-0 probe from this
  // user gets EPERM rather than success. Reading that as death would free a
  // live holder's lease and put two writers on one state root.
  test('a live process this user may not signal still reads as alive', () => {
    const deps = stateWriterLeaseIo({ pid: process.pid, rank: 0 });

    expect(deps.alive(1)).toBe(true);
  });
});

describe('writerRank', () => {
  test('ranks a deck-supervised board above a hand-run one', () => {
    expect(writerRank({ MATTSTACK_CANONICAL_HOST: 'board.mattstack' })).toBe(1);
    expect(writerRank({})).toBe(0);
    expect(writerRank({ MATTSTACK_CANONICAL_HOST: '' })).toBe(0);
  });
});
