import { runIdOf } from './run-mr.ts';
import type { GateRow } from './store.ts';

/** Most pane-attention gates clear on their own within 1 to 4 minutes;
    counting them sooner makes the shell badge blink. */
export const ATTENTION_MIN_AGE_MS = 120_000;

export function countsForBadge(gate: GateRow, now: number): boolean {
  // The console tab counts every run: gate; counting it here too would
  // double count the dock.
  if (runIdOf(gate.subject) !== null) return false;
  if (gate.status !== 'open' && gate.status !== 'parked') return false;
  if (gate.owner !== undefined && gate.owner !== 'human') return false;
  if (
    gate.kind === 'pane-attention' &&
    now - gate.openedAt < ATTENTION_MIN_AGE_MS
  )
    return false;
  return true;
}

export interface BoardBadge {
  count: number;
  path?: string;
}

export function boardBadge(gates: GateRow[], now: number): BoardBadge {
  const counted = gates
    .filter(g => countsForBadge(g, now))
    .sort((a, b) => a.openedAt - b.openedAt);
  const oldest = counted[0];
  if (!oldest) return { count: 0 };
  return {
    count: counted.length,
    path: `/?gate=${encodeURIComponent(oldest.gateId)}`,
  };
}
