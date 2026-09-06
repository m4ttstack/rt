/**
 * Per-stat evidence: the underlying records behind one person's value for each metric.
 * Pure. Rows come from the same cohorts snapshot.ts counts (test/parity.test.ts pins that),
 * and the output is render-agnostic (columns + rows + summary) so the UI renders every stat
 * with one component.
 */
import type {
  EvidenceRow,
  MetricEvidence,
  MetricKey,
} from '../../shared/types.js';
import type { FetchResult, NormMr } from '../store/model.js';
import {
  buildCorpus,
  buildUserCohorts,
  type CohortOptions,
} from './cohorts.js';
import { mean, percentile, round, streaks } from './stats.js';

export interface EvidenceContext extends CohortOptions {
  baseUrl: string;
}

const MAX_ROWS = 300;

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');
const hrs = (n: number): string => `${round(n, 1)}h`;
const byIidDesc = (a: { mr: NormMr }, b: { mr: NormMr }): number =>
  b.mr.iid - a.mr.iid;

/** Build every metric's evidence for one user. Metrics with no records are omitted. */
export function buildUserEvidence(
  fetched: FetchResult,
  u: string,
  ctx: EvidenceContext
): Partial<Record<MetricKey, MetricEvidence>> {
  const { baseUrl, sizeBand } = ctx;
  const corpus = buildCorpus(fetched, ctx);
  const c = buildUserCohorts(corpus, u, ctx);
  const lines = corpus.filters.lineCounts;
  const mrUrl = (m: NormMr) =>
    `${baseUrl}/${m.projectPath}/-/merge_requests/${m.iid}`;

  const out: Partial<Record<MetricKey, MetricEvidence>> = {};

  // Highest iid first so every MR-keyed table renders newest work at the top.
  const merged = [...c.authoredMerged].sort((a, b) => b.iid - a.iid);

  // additions / deletions / mrsMerged all share the merged-MR list.
  const mergedRows: EvidenceRow[] = merged.map(m => {
    const f = lines(m);
    return {
      cells: [
        `!${m.iid}`,
        m.title,
        `+${f.additions}`,
        `−${f.deletions}`,
        day(m.mergedAt),
      ],
      href: mrUrl(m),
    };
  });
  const mergedCols = ['MR', 'Title', 'Added', 'Deleted', 'Merged'];
  const totalAdd = merged.reduce((s, m) => s + lines(m).additions, 0);
  const totalDel = merged.reduce((s, m) => s + lines(m).deletions, 0);
  out.additions = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${totalAdd} lines added across ${merged.length} merged MRs`,
  };
  out.deletions = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${totalDel} lines deleted across ${merged.length} merged MRs`,
  };
  out.mrsMerged = {
    columns: mergedCols,
    rows: mergedRows,
    summary: `${merged.length} MRs merged`,
  };

  out.sizeHealthPct = {
    columns: ['MR', 'Title', 'Changed', 'In band?'],
    rows: merged.map(m => {
      const f = lines(m);
      return {
        cells: [
          `!${m.iid}`,
          m.title,
          String(f.additions + f.deletions),
          c.inBand(m) ? '✓' : '✗',
        ],
        href: mrUrl(m),
        muted: !c.inBand(m),
      };
    }),
    summary: `${merged.filter(c.inBand).length} of ${merged.length} MRs in the ${sizeBand.tooSmall}–${sizeBand.tooLarge} line band`,
  };

  const reverted = new Set(c.reverted);
  const revertEvidence: MetricEvidence = {
    columns: ['MR', 'Title', 'Merged', 'Reverted?'],
    rows: merged.map(m => ({
      cells: [
        `!${m.iid}`,
        m.title,
        day(m.mergedAt),
        reverted.has(m) ? 'reverted' : '—',
      ],
      href: mrUrl(m),
      muted: !reverted.has(m),
    })),
    summary: `${c.reverted.length} of ${merged.length} merged MRs later reverted`,
  };
  out.revertRate = revertEvidence;
  out.revertedCount = revertEvidence;

  // --- Reviewed teammates' MRs: depth + reviewer-side response latency ---
  const reviewed = [...c.reviewed].sort(byIidDesc);
  out.mrsReviewed = {
    columns: ['MR', 'Author', 'Title', 'Comments', 'Inline'],
    rows: reviewed.map(r => ({
      cells: [
        `!${r.mr.iid}`,
        r.mr.authorUsername ?? '—',
        r.mr.title,
        String(r.notes.length),
        String(r.inlineCount),
      ],
      href: mrUrl(r.mr),
    })),
    summary: `${reviewed.length} teammates' MRs reviewed`,
  };
  out.reviewDepth = {
    columns: ['MR', 'Title', 'Inline comments'],
    rows: reviewed.map(r => ({
      cells: [`!${r.mr.iid}`, r.mr.title, String(r.inlineCount)],
      href: mrUrl(r.mr),
    })),
    summary: `mean ${round(mean(reviewed.map(r => r.inlineCount)), 2)} inline comments per reviewed MR`,
  };
  const responded = reviewed.flatMap(r =>
    r.responseHours === null ? [] : [{ mr: r.mr, hours: r.responseHours }]
  );
  out.responseLatencyHours = {
    columns: ['MR', 'Title', 'Response'],
    rows: responded.map(r => ({
      cells: [`!${r.mr.iid}`, r.mr.title, hrs(r.hours)],
      href: mrUrl(r.mr),
    })),
    summary: distSummary(
      responded.map(r => r.hours),
      'first response'
    ),
  };

  // --- Author-side review latency: how long the user's own MRs waited ---
  const waited = [...c.waited].sort(byIidDesc);
  out.reviewLatencyHours = {
    columns: ['MR', 'Title', 'Wait'],
    rows: waited.map(w => ({
      cells: [`!${w.mr.iid}`, w.mr.title, hrs(w.waitHours)],
      href: mrUrl(w.mr),
    })),
    summary: distSummary(
      waited.map(w => w.waitHours),
      'first review'
    ),
  };

  // --- Reciprocity: who reviewed this user's merged MRs (received side) ---
  const given = reviewed.length;
  const received = c.reviewersOfMine.size;
  out.reciprocity = {
    columns: ['Reviewer', 'Your MRs they reviewed'],
    rows: [...c.reviewersOfMine.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ cells: [name, String(n)] })),
    summary: `gave ${given} reviews, received from ${received} reviewer(s) ... ratio ${received === 0 ? given : round(given / received, 2)}`,
  };

  // --- Pipelines triggered ---
  const statusCount = c.pipelines.reduce<Record<string, number>>(
    (acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc),
    {}
  );
  out.pipelines = {
    columns: ['Status', 'Created'],
    rows: [...c.pipelines]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(p => ({
        cells: [p.status, day(p.createdAt)],
        muted: p.status !== 'success',
      })),
    summary:
      Object.entries(statusCount)
        .map(([s, n]) => `${n} ${s}`)
        .join(' · ') || 'no pipelines',
  };

  // --- Coding days: distinct days the user pushed to the tracked project ---
  const pushDays = new Map<string, number>();
  for (const ts of c.pushTimestamps)
    pushDays.set(day(ts), (pushDays.get(day(ts)) ?? 0) + 1);
  out.codingDays = {
    columns: ['Date', 'Pushes'],
    rows: [...pushDays.entries()]
      .sort()
      .reverse()
      .map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `${pushDays.size} distinct days with a push`,
  };

  // --- Merge streak: days the user merged at least one MR ---
  const mergeByDay = new Map<string, number>();
  for (const ts of c.mergeTimestamps)
    mergeByDay.set(day(ts), (mergeByDay.get(day(ts)) ?? 0) + 1);
  const ms = streaks(c.mergeTimestamps);
  const mergeDayEvidence: MetricEvidence = {
    columns: ['Date', 'MRs merged'],
    rows: [...mergeByDay.entries()]
      .sort()
      .reverse()
      .map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `longest run ${ms.longest} day(s), current ${ms.current}, across ${mergeByDay.size} merge day(s)`,
  };
  out.longestStreak = mergeDayEvidence;
  out.currentStreak = mergeDayEvidence;

  // --- Issues done (Linear): gated-out issues surface only as counts in the summary ---
  // Highest ticket number first, with numeric collation so ACME-2007 outranks ACME-938.
  const counted = [...c.issues.counted].sort((a, b) =>
    b.identifier.localeCompare(a.identifier, undefined, { numeric: true })
  );
  const parts: string[] = [`${counted.length} counted`];
  if (c.issues.teamExcluded > 0)
    parts.push(`${c.issues.teamExcluded} excluded by team`);
  if (c.issues.stateExcluded > 0)
    parts.push(`${c.issues.stateExcluded} excluded by state`);
  out.issuesCompleted = {
    columns: ['Issue', 'Title', 'State', 'MR(s)'],
    rows: counted.map(i => ({
      cells: [
        i.identifier,
        i.title,
        i.stateName ?? i.stateType ?? '—',
        i.linkedMrs.map(m => `!${m.iid}`).join(', ') || '—',
      ],
      href: i.url,
    })),
    summary: parts.join(' · '),
  };

  // Bound any pathologically large evidence list so a response stays sane.
  for (const key of Object.keys(out) as MetricKey[]) {
    const ev = out[key]!;
    if (ev.rows.length > MAX_ROWS) {
      const extra = ev.rows.length - MAX_ROWS;
      ev.rows = ev.rows.slice(0, MAX_ROWS);
      ev.summary =
        `${ev.summary ?? ''} (showing first ${MAX_ROWS}, ${extra} more)`.trim();
    }
  }

  return out;
}

function distSummary(samples: number[], label: string): string {
  if (samples.length === 0) return `no ${label} samples`;
  const p50 = percentile(samples, 0.5);
  const p90 = percentile(samples, 0.9);
  return `p50 ${round(p50 ?? 0, 1)}h · p90 ${round(p90 ?? 0, 1)}h over ${samples.length} MR(s)`;
}
