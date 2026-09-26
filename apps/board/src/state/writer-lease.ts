/**
 * Which board process owns this state root's autonomous side.
 *
 * Every board on a machine shares `~/.mattstack/board` unless it overrides
 * the state db, so a hand-run instance in a worktree consumes the same
 * agent-status journal as the supervised one and owes the same effects. The
 * board's own guards against a double effect are all in-process, so they
 * cannot see a sibling: each process reads that the work is undone before
 * any of them writes, and the MR ends up with one copy per board.
 *
 * Deciding and writing therefore happen in ONE serialized transaction, and
 * a claim counts only when the db acknowledged it. A read-then-write pair
 * would let two processes read the same free lease and both believe they
 * won it, which is the very race this exists to settle.
 */
import type { Database } from 'bun:sqlite';

import { runCriticalWrite } from './busy.ts';
import { getStateDb } from './db.ts';
import { getKvValue, setKvValue } from './kv-blob.ts';

export interface WriterLeaseRow {
  pid: number;
  rank: number;
  bootedAt: number;
  beatAt: number;
}

/**
 * `held` -- the lease is ours and the db said so. `lost` -- another live
 * process owns it. `unknown` -- the db would not answer, which is neither:
 * see beatStillValid for what a writer does with it.
 */
export type LeaseResult = 'held' | 'lost' | 'unknown';

export interface WriterLeaseIo {
  /** Decide and write under one serialized transaction. `decide` returns the
      row to store, or null to leave the lease with its holder. */
  transact(
    decide: (held: WriterLeaseRow | null) => WriterLeaseRow | null
  ): LeaseResult;
  /** For logging only -- never to decide on, since anything read outside the
      transaction can be stale by the time it is acted on. */
  read(): WriterLeaseRow | null;
  /** Whether that pid is still a live process on this machine. */
  alive(pid: number): boolean;
  now(): number;
  pid: number;
  rank: number;
}

/** How long a holder may go without a heartbeat before the lease is free.
    Well above LEASE_BEAT_MS so a slow tick is never mistaken for a death. */
export const LEASE_STALE_MS = 60_000;

/** How often the writer proves it is still here. */
export const LEASE_BEAT_MS = 15_000;

/**
 * Take the lease, or report that another live board already holds it.
 *
 * Rank, not arrival order, decides between two live processes: the
 * supervised instance boots whenever launchd says so, which can be hours
 * after a board someone left running by hand, and it must still be the one
 * that writes. A lower-ranked holder is displaced and stands down on its
 * next renew.
 */
export function claimWriterLease(io: WriterLeaseIo): LeaseResult {
  return io.transact(held => {
    const now = io.now();
    if (held && !free(held, io, now) && held.rank >= io.rank) return null;
    return { pid: io.pid, rank: io.rank, bootedAt: now, beatAt: now };
  });
}

function free(row: WriterLeaseRow, io: WriterLeaseIo, now: number): boolean {
  return now - row.beatAt > LEASE_STALE_MS || !io.alive(row.pid);
}

/**
 * Keep the lease, or discover it was taken. `lost` is the writer's signal to
 * stop its autonomous side: a higher-ranked board has arrived and owns those
 * effects now.
 */
export function renewWriterLease(io: WriterLeaseIo): LeaseResult {
  return io.transact(held => {
    if (held && held.pid !== io.pid) return null;
    const now = io.now();
    return {
      pid: io.pid,
      rank: io.rank,
      bootedAt: held?.bootedAt ?? now,
      beatAt: now,
    };
  });
}

/**
 * Whether a writer whose last beats went unanswered may still act, given
 * when it last committed one.
 *
 * state.db runs a 250ms busy timeout for the server, so losing a write to
 * contention is ordinary and must not retire the one board doing the work.
 * What bounds it is the same window every other board honours: once this
 * beat is stale, another board is entitled to claim, so an unanswered db
 * stops being proof of ownership.
 */
export function beatStillValid(lastHeldAt: number, now: number): boolean {
  return now - lastHeldAt < LEASE_STALE_MS;
}

/** The lease as it really lives: one kv row beside the rest of board state,
    so it is scoped to exactly the thing being contended -- the state root --
    rather than to a pid file someone has to clean up. */
export function stateWriterLeaseIo(opts: {
  pid: number;
  rank: number;
  /** Omitted outside tests: the state db is resolved on use, so this module
      never forces it open at import. */
  db?: Database;
}): WriterLeaseIo {
  const database = () => opts.db ?? getStateDb();
  const readRow = () =>
    getKvValue<WriterLeaseRow | null>('writer', 'lease', null, opts.db);
  return {
    transact: decide => {
      // IMMEDIATE, not deferred: the write lock is taken before the read, so
      // the row cannot change under the decision, and a rival's commit costs
      // this transaction a wait rather than a lost update.
      let wrote = false;
      const tx = database().transaction(() => {
        wrote = false;
        const next = decide(readRow());
        if (!next) return;
        setKvValue('writer', 'lease', next, opts.db);
        wrote = true;
      });
      try {
        runCriticalWrite('writer lease', () => tx.immediate());
      } catch {
        return 'unknown';
      }
      return wrote ? 'held' : 'lost';
    },
    read: readRow,
    // Same machine by construction: every board sharing a state root shares
    // the filesystem it lives on, so a signal-0 probe is decisive.
    alive: pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        // EPERM means the process is there and simply not ours to signal,
        // which is still alive. Only ESRCH is a death.
        return (err as { code?: string }).code === 'EPERM';
      }
    },
    now: () => Date.now(),
    pid: opts.pid,
    rank: opts.rank,
  };
}

/**
 * Deck injects MATTSTACK_CANONICAL_HOST into every app it supervises, so its
 * presence is what separates the managed board from one started by hand in a
 * worktree. A board that somehow has neither still claims an unheld lease,
 * which is the only case that matters when it is the sole instance.
 */
export function writerRank(env: Record<string, string | undefined>): number {
  return env.MATTSTACK_CANONICAL_HOST ? 1 : 0;
}
