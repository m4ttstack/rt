import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { APP_ROOT } from '../app-root.ts';

/** Per-MR dispatch bookkeeping AND red-edge memory. Plain-named file: the
    working name must not leak into state schemas (2026-08-08 amendment). */
export interface MrMemory {
  lastDispatchAt: number | null;
  attemptsToday: number;
  dayStamp: string;
  /** Day the budget-exhausted escalation already fired, so it fires once. */
  budgetEscalatedDay: string | null;
  lastHandledPipelineId: number | null;
  lastNeedsRebase: boolean;
}

export interface DispatchMemory {
  /** GitLab token identity, cached ~24h so most runs make zero API calls. */
  identity: { username: string; fetchedAt: number } | null;
  mrs: Record<string, MrMemory>;
}

export const MEMORY_PATH = join(APP_ROOT, 'state', 'auto-dispatch.json');

export function emptyMrMemory(dayStamp: string): MrMemory {
  return {
    lastDispatchAt: null,
    attemptsToday: 0,
    dayStamp,
    budgetEscalatedDay: null,
    lastHandledPipelineId: null,
    lastNeedsRebase: false,
  };
}

export function rollDay(m: MrMemory, dayStamp: string): MrMemory {
  if (m.dayStamp === dayStamp) return m;
  return { ...m, attemptsToday: 0, budgetEscalatedDay: null, dayStamp };
}

export function readMemory(path: string = MEMORY_PATH): DispatchMemory {
  try {
    const raw = JSON.parse(
      readFileSync(path, 'utf8')
    ) as Partial<DispatchMemory>;
    return { identity: raw.identity ?? null, mrs: raw.mrs ?? {} };
  } catch {
    return { identity: null, mrs: {} };
  }
}

export function writeMemory(
  mem: DispatchMemory,
  path: string = MEMORY_PATH
): void {
  mkdirSync(join(path, '..'), { recursive: true });
  // Same atomic tmp+rename discipline as doctor-state.ts: the board never
  // reads this file, but a crashed half-write must not poison the next run.
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(mem, null, 2) + '\n');
  renameSync(tmp, path);
}

const LOCK_STALE_MS = 2 * 60_000;

/** Every read-modify-write of this file (the auto triage pass, and the
    manual /doctor launch's identity refresh) must serialize behind this
    lock: a slow pass and a fresh trigger interleaving can clobber attempt
    budgets, `lastHandledPipelineId`, or `budgetEscalatedDay` in either
    direction. Non-blocking: false means another live pass holds it, and
    the caller should skip its write rather than wait. A lock older than
    the stale window is reclaimed rather than honored, so a crashed holder
    (which skips its `finally` via `process.exit`) can never strand it.
    Returns an ownership token on success -- the caller must pass it back to
    releaseMemoryLock, since a bare PID cannot tell two acquisitions BY THE
    SAME PROCESS apart, and a release must never delete a lock some other
    holder (including a later reclaim of what THIS caller once held) now
    owns. */
export function tryAcquireMemoryLock(
  path: string = MEMORY_PATH
): string | false {
  const lock = path + '.lock';
  mkdirSync(join(lock, '..'), { recursive: true });
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) {
    return false;
  }
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(lock, token);
  return token;
}

/** Removes the lock file only when it still holds the SAME token this
    caller was issued -- a stale-reclaimed lock (now owned by a fresh
    acquirer) must never be deleted by the previous owner's late release. */
export function releaseMemoryLock(
  token: string,
  path: string = MEMORY_PATH
): void {
  const lock = path + '.lock';
  try {
    if (readFileSync(lock, 'utf8') === token) rmSync(lock, { force: true });
  } catch {
    // lock file already gone: nothing to release
  }
}

/** Writes back ONLY the identity field, onto a fresh read of the CURRENT
    file rather than whatever the caller read before its (possibly slow)
    token validation -- the auto pass may have written other fields
    (attempt budgets, lastHandledPipelineId, budgetEscalatedDay) during that
    gap, and a blind overwrite of the caller's stale snapshot would revert
    them. Caller must hold tryAcquireMemoryLock() around this call. */
export function writeRefreshedIdentity(
  identity: DispatchMemory['identity'],
  path: string = MEMORY_PATH
): void {
  const fresh = readMemory(path);
  fresh.identity = identity;
  writeMemory(fresh, path);
}
