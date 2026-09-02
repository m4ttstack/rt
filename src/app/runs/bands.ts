import type { RunSummary } from '@mattstack/rt-client';

export type Band = 'attention' | 'running' | 'finished';

export const BAND_ORDER: Band[] = ['attention', 'running', 'finished'];

/** `last_event_at`, `ticket`, and `branch` ride RunSummary itself -- this adds
    only the console's own annotation. */
export interface BoardRun extends RunSummary {
  seen: boolean;
}

/** rt owns the predicate. The console renders the flag and never re-derives
    it -- two derivations are how two surfaces come to disagree about
    whether something needs you. */
export function bandFor(run: BoardRun): Band {
  if (run.attention.needs) return 'attention';
  return run.ended_at == null ? 'running' : 'finished';
}

/**
 * Three ranks, then silence.
 *
 * `spawned_by` is NULL for an interactive run and carries a surface name for a
 * spawned one -- the inverse of how it reads. A LIVE interactive run has
 * someone watching it, so it sinks; a finished one does not, so it does not.
 * Seen-but-unresolved rows drop to the bottom of their band rather than
 * vanishing, so a band can reach empty without anything being hidden.
 */
export function sortBand(runs: BoardRun[]): BoardRun[] {
  const rank = (r: BoardRun) =>
    r.seen ? 2 : r.spawned_by == null && r.ended_at == null ? 1 : 0;

  return [...runs].sort(
    (a, b) => rank(a) - rank(b) || a.last_event_at - b.last_event_at
  );
}

/** A run id's slot: which band, and its index within that band's order. */
export type BandIds = Record<Band, string[]>;

export function computeBandIds(runs: BoardRun[]): BandIds {
  const grouped: Record<Band, BoardRun[]> = {
    attention: [],
    running: [],
    finished: [],
  };
  for (const run of runs) grouped[bandFor(run)].push(run);
  return {
    attention: sortBand(grouped.attention).map(r => r.id),
    running: sortBand(grouped.running).map(r => r.id),
    finished: sortBand(grouped.finished).map(r => r.id),
  };
}
