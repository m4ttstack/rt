import type { GateRow } from './store.ts';

/** Most pane-attention gates clear on their own within 1 to 4 minutes;
    counting them sooner makes the shell badge blink. */
export const ATTENTION_MIN_AGE_MS = 120_000;

export function countsForBadge(gate: GateRow, now: number): boolean {
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
  ids?: string[];
}

/** `ids` lets the tray count a gate once in the dock when another app's
    badge (console, for run: gates) counts it too. */
export function boardBadge(gates: GateRow[], now: number): BoardBadge {
  const seen = new Set<string>();
  const counted = gates
    .filter(g => countsForBadge(g, now))
    .filter(g => !seen.has(g.gateId) && seen.add(g.gateId))
    .sort((a, b) => a.openedAt - b.openedAt);
  const oldest = counted[0];
  if (!oldest) return { count: 0 };
  return {
    count: counted.length,
    path: `/?gate=${encodeURIComponent(oldest.gateId)}`,
    ids: counted.map(g => g.gateId),
  };
}
