import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

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

export const MEMORY_PATH = join(import.meta.dir, "..", "..", "state", "auto-dispatch.json");

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
