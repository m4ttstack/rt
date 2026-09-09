/** Per-MR dispatch bookkeeping AND red-edge memory. Plain-named key: the
    working name must not leak into state schemas (2026-08-08 amendment).
    Pure types/helpers only -- this file must stay Bun-free (no bun:sqlite,
    no state/index.ts import): the client bundle reaches it transitively via
    triage/edge.ts, which the "types": ["node"] client tsconfig type-checks
    with no Bun ambient types loaded. The db-backed reads/writes live in
    ./memory-store.ts instead. */
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
