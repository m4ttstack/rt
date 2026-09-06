import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "../app-root.ts";

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

export const MEMORY_PATH = join(APP_ROOT, "state", "auto-dispatch.json");

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
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DispatchMemory>;
    return { identity: raw.identity ?? null, mrs: raw.mrs ?? {} };
  } catch {
    return { identity: null, mrs: {} };
  }
}

export function writeMemory(mem: DispatchMemory, path: string = MEMORY_PATH): void {
  mkdirSync(join(path, ".."), { recursive: true });
  // Same atomic tmp+rename discipline as doctor-state.ts: the board never
  // reads this file, but a crashed half-write must not poison the next run.
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(mem, null, 2) + "\n");
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
    (which skips its `finally` via `process.exit`) can never strand it. */
export function tryAcquireMemoryLock(path: string = MEMORY_PATH): boolean {
  const lock = path + ".lock";
  mkdirSync(join(lock, ".."), { recursive: true });
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) {
    return false;
  }
  writeFileSync(lock, String(process.pid));
  return true;
}

export function releaseMemoryLock(path: string = MEMORY_PATH): void {
  rmSync(path + ".lock", { force: true });
}
