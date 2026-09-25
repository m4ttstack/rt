import type { GateRow } from '@mattstack/rt-client';

export type RunGateMarker = 'blocked' | 'shepherd';

export function isWaiting(g: GateRow): boolean {
  return g.status === 'open' || g.status === 'parked';
}

/** Legacy rows carry a null owner; they are Matt's. A `herd:*` owner can
    only be answered by that herd's shepherd. */
export function isMine(g: GateRow): boolean {
  return g.owner == null || g.owner === 'human';
}

export function runGateMarker(
  gates: GateRow[] | undefined,
  runId: string
): RunGateMarker | null {
  const subject = `run:${runId}`;
  const waiting = (gates ?? []).filter(
    g => g.subject === subject && isWaiting(g)
  );
  if (waiting.some(isMine)) return 'blocked';
  return waiting.length > 0 ? 'shepherd' : null;
}

/** The board also counts a `run:` gate shown on one of its MR rows; the
    tray counts a gate once in the dock by its id. The age gate keeps a self-clearing
    wedge (most clear within 1 to 4 minutes on their own) from blinking
    the badge. */
export const ATTENTION_MIN_AGE_MS = 120_000;

export function countsForConsoleBadge(g: GateRow, now: number): boolean {
  if (!g.subject.startsWith('run:') || !isWaiting(g) || !isMine(g))
    return false;
  if (g.kind === 'pane-attention')
    return now - g.openedAt >= ATTENTION_MIN_AGE_MS;
  return true;
}
