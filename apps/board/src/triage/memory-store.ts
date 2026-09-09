import { Database } from 'bun:sqlite';

import {
  deleteKvValue,
  getKvValue,
  getStateDb,
  persistOrWarn,
  runCriticalWrite,
  setKvValue,
} from '../state/index.ts';
import type { DispatchMemory } from './memory.ts';

/** A fresh fallback object per call -- getKvValue returns this reference
    verbatim on a miss, and callers (resolveDispatchIdentity, the nudge pass)
    mutate the returned memory's fields in place, so a shared singleton here
    would leak state across unrelated calls. */
export function readMemory(db: Database = getStateDb()): DispatchMemory {
  const raw = getKvValue<Partial<DispatchMemory>>(
    'triage',
    'memory',
    { identity: null, mrs: {} },
    db
  );
  // Per-field, not whole-object: a legacy-imported auto-dispatch.json can be
  // a partial blob (missing a field the old file predates), and the fallback
  // above only ever applies on a total miss -- without this, `memory.mrs[...]`
  // throws on a row that exists but never had an `mrs` key.
  return { identity: raw.identity ?? null, mrs: raw.mrs ?? {} };
}

export function writeMemory(
  mem: DispatchMemory,
  db: Database = getStateDb()
): void {
  runCriticalWrite('triage memory write', () =>
    setKvValue('triage', 'memory', mem, db)
  );
}

/** Writes back ONLY the identity field, onto a fresh read of the CURRENT
    row rather than whatever the caller read before its (possibly slow) token
    validation -- the auto pass may have written other fields (attempt
    budgets, lastHandledPipelineId, budgetEscalatedDay) during that gap, and a
    blind overwrite of the caller's stale snapshot would revert them. Caller
    must hold tryClaimCron() around this call. */
export function writeRefreshedIdentity(
  identity: DispatchMemory['identity'],
  db: Database = getStateDb()
): void {
  runCriticalWrite('triage identity refresh', () => {
    const tx = db.transaction(() => {
      const fresh = readMemory(db);
      fresh.identity = identity;
      setKvValue('triage', 'memory', fresh, db);
    });
    tx.immediate();
  });
}

interface CronClaim {
  token: string;
  at: number;
}

const CRON_CLAIM_STALE_MS = 2 * 60_000;

/** Every read-modify-write of the triage memory row (the auto triage pass,
    and the manual /doctor launch's identity refresh) must serialize behind
    this claim: a slow pass and a fresh trigger interleaving can clobber
    attempt budgets, `lastHandledPipelineId`, or `budgetEscalatedDay` in
    either direction. The staleness check and the claim write happen inside
    one BEGIN IMMEDIATE transaction so two processes racing this call can
    never both see "no live claim" and both proceed -- the second one blocks
    on the write lock until the first commits, then re-reads the claim the
    first just wrote. A claim older than the stale window is reclaimed rather
    than honored, so a crashed holder (which skips its `finally` via
    `process.exit`) can never strand it. Returns an ownership token on
    success -- the caller must pass it back to releaseCron, since a bare PID
    cannot tell two acquisitions BY THE SAME PROCESS apart, and a release
    must never delete a claim some other holder (including a later reclaim of
    what THIS caller once held) now owns. */
export function tryClaimCron(
  now: number,
  db: Database = getStateDb()
): string | false {
  let claimed: string | false = false;
  runCriticalWrite('cron claim', () => {
    const tx = db.transaction(() => {
      const existing = getKvValue<CronClaim | null>(
        'triage',
        'cron-claim',
        null,
        db
      );
      if (existing && now - existing.at < CRON_CLAIM_STALE_MS) return;
      const token = `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`;
      setKvValue('triage', 'cron-claim', { token, at: now }, db);
      claimed = token;
    });
    tx.immediate();
  });
  return claimed;
}

/** Removes the claim only when it still holds the SAME token this caller was
    issued -- a stale-reclaimed claim (now owned by a fresh acquirer) must
    never be deleted by the previous owner's late release. */
export function releaseCron(token: string, db: Database = getStateDb()): void {
  persistOrWarn('cron release', () => {
    const tx = db.transaction(() => {
      const existing = getKvValue<CronClaim | null>(
        'triage',
        'cron-claim',
        null,
        db
      );
      if (existing && existing.token === token) {
        deleteKvValue('triage', 'cron-claim', db);
      }
    });
    tx.immediate();
  });
}
