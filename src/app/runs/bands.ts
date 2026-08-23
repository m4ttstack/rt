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

function slotOf(ids: BandIds, id: string): string | undefined {
  for (const band of BAND_ORDER) {
    const index = ids[band].indexOf(id);
    if (index !== -1) return `${band}:${index}`;
  }
  return undefined;
}

function bandOf(ids: BandIds, id: string): Band | undefined {
  for (const band of BAND_ORDER) if (ids[band].includes(id)) return band;
  return undefined;
}

const BAND_LABEL: Record<Band, string> = {
  attention: 'needs attention',
  running: 'running',
  finished: 'finished',
};

export interface BoardChangeSummary {
  count: number;
  message: string;
}

/**
 * The quiet-pill diff. Two different questions, answered two different ways:
 *
 * WHETHER to hold the pill at all uses full slot equality (band + index) --
 * a within-band silence resort is a reorder under the cursor exactly like a
 * band change, so it counts too. `count` is this full slot-diff size.
 *
 * WHAT the message says uses band-crossing membership only, ignoring index.
 * Removing an id from a band (or inserting one) shifts every trailing id's
 * index in that band, so slot equality alone would only call a move
 * "singular" when the mover happened to sit last in both its source and
 * destination band -- true for a small fixture, false in general. Band
 * membership is what the spec's own example ("1 run moved to needs
 * attention") actually describes, and index-shift noise never changes it.
 */
export function summarizeBoardChanges(
  committed: BandIds,
  latest: BandIds
): BoardChangeSummary {
  const allIds = new Set([
    ...BAND_ORDER.flatMap(band => committed[band]),
    ...BAND_ORDER.flatMap(band => latest[band]),
  ]);

  const changed = [...allIds].filter(
    id => slotOf(committed, id) !== slotOf(latest, id)
  );

  if (changed.length === 0) return { count: 0, message: '' };

  const bandCrossers = changed.filter(
    id => bandOf(committed, id) !== bandOf(latest, id)
  );
  if (bandCrossers.length === 1) {
    const to = bandOf(latest, bandCrossers[0]);
    if (to) {
      return {
        count: changed.length,
        message: `1 run moved to ${BAND_LABEL[to]}`,
      };
    }
  }

  const count = changed.length;
  return { count, message: `${count} run${count === 1 ? '' : 's'} updated` };
}
