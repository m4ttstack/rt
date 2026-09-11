/**
 * Canonical metric metadata ... the SINGLE SOURCE OF TRUTH for what each metric means,
 * which group it belongs to, and which direction is "better". Both the server (ranking +
 * validation) and the UI (rendering) import from here, so labels and categorization can be
 * tested once and never drift between data and presentation.
 */
import type {
  DistributionValue,
  MetricKey,
  MetricValue,
  UserMetrics,
} from './types.js';

export type MetricKind = 'scalar' | 'dist';
/** "desc" = higher is better; "asc" = lower is better (latency, revert rate). */
export type Better = 'asc' | 'desc';
export type MetricGroup = 'volume' | 'quality' | 'delivery';

export interface MetricDescriptor {
  key: MetricKey;
  kind: MetricKind;
  label: string;
  group: MetricGroup;
  better: Better;
  /** value is a 0..1 fraction, render as %. */
  percent?: boolean;
  /** display suffix, e.g. "/MR". */
  unit?: string;
  /** Plain-language meaning ... used in tooltips, the CLI report, and label-sanity tests. */
  description: string;
}

const METRIC_TABLE = [
  // --- Delivery (Linear): tickets shipped ---
  {
    key: 'issuesCompleted',
    kind: 'scalar',
    label: 'Issues done',
    group: 'delivery',
    better: 'desc',
    description:
      "Linear issues closed by merged work: an issue counts in the window its implementing MR merged (Linear's attached MR, or one referencing the issue in its title, branch, or a closing phrase), credited to that MR's author. Issues whose current state is not a done state, or with no merged implementing MR, do not count. Tickets from every Linear team count, not just one configured team.",
  },

  // --- Volume (spec 4.1-4.4): gameable output counts ---
  {
    key: 'additions',
    kind: 'scalar',
    label: 'Added',
    group: 'volume',
    better: 'desc',
    description: 'Lines added across merged MRs the user authored.',
  },
  {
    key: 'deletions',
    kind: 'scalar',
    label: 'Deleted',
    group: 'volume',
    better: 'desc',
    description: 'Lines deleted across merged MRs the user authored.',
  },
  {
    key: 'mrsMerged',
    kind: 'scalar',
    label: 'MRs merged',
    group: 'volume',
    better: 'desc',
    description: 'Count of MRs the user authored that merged in the window.',
  },
  {
    key: 'mrsReviewed',
    kind: 'scalar',
    label: 'MRs reviewed',
    group: 'volume',
    better: 'desc',
    description:
      "Distinct teammates' MRs the user reviewed (note or approval) in the window.",
  },
  {
    key: 'pipelines',
    kind: 'scalar',
    label: 'Pipelines',
    group: 'volume',
    better: 'desc',
    description: 'Pipelines the user triggered in the window.',
  },

  // --- Quality / consistency (spec 4.5-4.10): counterweights ---
  {
    key: 'reviewDepth',
    kind: 'scalar',
    label: 'Review depth',
    group: 'quality',
    better: 'desc',
    unit: '/MR',
    description:
      'Average inline (DiffNote) comments per reviewed MR ... higher = more substantive review.',
  },
  {
    key: 'reviewLatencyHours',
    kind: 'dist',
    label: 'Wait for review',
    group: 'quality',
    better: 'asc',
    description:
      "Hours the user's own MRs wait for first review (p50). Lower is better.",
  },
  {
    key: 'responseLatencyHours',
    kind: 'dist',
    label: 'Response time',
    group: 'quality',
    better: 'asc',
    description:
      'Hours until the user gives a first response on MRs they review (p50). Lower is better.',
  },
  {
    key: 'revertRate',
    kind: 'scalar',
    label: 'Revert rate',
    group: 'quality',
    better: 'asc',
    percent: true,
    description:
      "Share of the user's merged MRs later reverted. Lower is better.",
  },
  {
    key: 'revertedCount',
    kind: 'scalar',
    label: 'Reverted',
    group: 'quality',
    better: 'asc',
    description:
      'Merged MRs the user authored that were later reverted (detected reverts only). Lower is better.',
  },
  {
    key: 'sizeHealthPct',
    kind: 'scalar',
    label: 'Size health',
    group: 'quality',
    better: 'desc',
    percent: true,
    description:
      "Share of the user's merged MRs in the reviewable size band. Higher is better.",
  },
  {
    key: 'codingDays',
    kind: 'scalar',
    label: 'Coding days',
    group: 'quality',
    better: 'desc',
    description:
      'Number of distinct days the user pushed at least one commit (to the tracked project) during the window.',
  },
  {
    key: 'currentStreak',
    kind: 'scalar',
    label: 'Current streak',
    group: 'quality',
    better: 'desc',
    description:
      "Consecutive calendar days, ending on the user's most recent merge day, on which they merged at least one MR.",
  },
  {
    key: 'longestStreak',
    kind: 'scalar',
    label: 'Merge streak',
    group: 'quality',
    better: 'desc',
    description:
      'Longest run of consecutive calendar days on which the user merged at least one MR, within the window. E.g. 4 = merged an MR on 4 days in a row at some point. (Based on merges, not pushes.)',
  },
  {
    key: 'reciprocity',
    kind: 'scalar',
    label: 'Reciprocity',
    group: 'quality',
    better: 'desc',
    description:
      'Reviews given divided by reviews received ... ~1 means pulling your weight.',
  },
] as const satisfies readonly MetricDescriptor[];

type DescribedKey = (typeof METRIC_TABLE)[number]['key'];

// A UserMetrics key without a row here is computed but never shown, ranked, or validated.
// This fails tsc the moment such a key appears.
const everyMetricKeyIsDescribed = {} satisfies Record<
  Exclude<MetricKey, DescribedKey>,
  never
>;
void everyMetricKeyIsDescribed;

export const METRICS: MetricDescriptor[] = [...METRIC_TABLE];

// --- Typed accessors so server + UI read scalar vs distribution uniformly ---

type Cell = MetricValue | DistributionValue;

function cell(m: UserMetrics, d: MetricDescriptor): Cell {
  return m[d.key] as Cell;
}

/** The value used for ranking/sorting: scalar value, or distribution p50. null = unranked. */
export function metricValue(
  m: UserMetrics,
  d: MetricDescriptor
): number | null {
  const c = cell(m, d);
  return d.kind === 'scalar'
    ? (c as MetricValue).value
    : (c as DistributionValue).p50;
}

/** The trend delta: scalar delta, or distribution deltaP50. */
export function metricDelta(
  m: UserMetrics,
  d: MetricDescriptor
): number | null {
  const c = cell(m, d);
  return d.kind === 'scalar'
    ? (c as MetricValue).delta
    : (c as DistributionValue).deltaP50;
}

export function metricRank(m: UserMetrics, d: MetricDescriptor): number | null {
  return cell(m, d).rank;
}

export function setMetricRank(
  m: UserMetrics,
  d: MetricDescriptor,
  rank: number | null
): void {
  cell(m, d).rank = rank;
}

/** Whether a positive delta is an improvement, given the metric's direction. */
export function deltaIsGood(delta: number, better: Better): boolean {
  return better === 'desc' ? delta > 0 : delta < 0;
}

export function metricByKey(key: MetricKey): MetricDescriptor | undefined {
  return METRICS.find(d => d.key === key);
}

// --- Display formatting, shared so the web UI and the CLI print identical values ---

export function formatValue(value: number | null, d: MetricDescriptor): string {
  if (value === null) return '—';
  if (d.kind === 'dist') return `${formatNumber(value)}h`;
  if (d.percent) return `${Math.round(value * 100)}%`;
  return formatNumber(value) + (d.unit ?? '');
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
