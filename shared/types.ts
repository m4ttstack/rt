/**
 * The wire contract between the backend and the frontend.
 * No `any` anywhere here (spec section 10): both sides import these types.
 */

export type RangePreset = "7d" | "30d" | "90d";
export type RangeKey = RangePreset | "custom";

export interface TimeWindow {
  /** Inclusive start, ISO 8601. */
  start: string;
  /** Exclusive end, ISO 8601. */
  end: string;
  key: RangeKey;
}

/** A scalar metric plus its delta vs. the prior-equal window (null = no prior snapshot). */
export interface MetricValue {
  value: number;
  delta: number | null;
  /** 1 = best for this metric (ties shared, nulls/unresolved unranked). Set server-side. */
  rank: number | null;
}

/** A latency-style metric reported as a distribution rather than a single number. */
export interface DistributionValue {
  /** Hours. null when the user has no qualifying samples. */
  p50: number | null;
  p90: number | null;
  /** Delta of p50 vs. the prior window (null when either side is missing). */
  deltaP50: number | null;
  /** Rank by p50 (1 = best). Set server-side. */
  rank: number | null;
}

export interface PipelineStatusBreakdown {
  success: number;
  failed: number;
  canceled: number;
  other: number;
}

export interface UserMetrics {
  // --- Volume metrics (spec 4.1-4.4) ---
  additions: MetricValue;
  deletions: MetricValue;
  netLines: MetricValue;
  mrsMerged: MetricValue;
  mrsReviewed: MetricValue;
  pipelines: MetricValue;
  pipelineStatus: PipelineStatusBreakdown;

  // --- Quality / consistency metrics (spec 4.5-4.10) ---
  /** Median inline (DiffNote) comments per reviewed MR. */
  reviewDepth: MetricValue;
  /** Author-side: how long this user's own MRs wait for first review. */
  reviewLatencyHours: DistributionValue;
  /** Reviewer-side: how fast this user gives a first response on MRs they review. */
  responseLatencyHours: DistributionValue;
  /** 0..1 share of merged MRs later reverted (detected reverts only). */
  revertRate: MetricValue;
  revertedCount: MetricValue;
  /** 0..1 share of merged MRs landing in the healthy size band. */
  sizeHealthPct: MetricValue;
  codingDays: MetricValue;
  currentStreak: MetricValue;
  longestStreak: MetricValue;
  /** reviews given / reviews received. */
  reciprocity: MetricValue;
}

/** Keys of the scalar (MetricValue) metrics. */
export type ScalarMetricKey = {
  [K in keyof UserMetrics]: UserMetrics[K] extends MetricValue ? K : never;
}[keyof UserMetrics];

/** Keys of the distribution (latency) metrics. */
export type DistributionMetricKey = {
  [K in keyof UserMetrics]: UserMetrics[K] extends DistributionValue ? K : never;
}[keyof UserMetrics];

/** Every rankable metric key (scalar or distribution). */
export type MetricKey = ScalarMetricKey | DistributionMetricKey;

export interface UserRow {
  username: string;
  name: string | null;
  /** false when the configured username could not be matched on the instance. */
  resolved: boolean;
  isCurrentUser: boolean;
  metrics: UserMetrics;
}

export interface Scope {
  type: "group" | "projects";
  groupPath?: string;
  projectPaths?: string[];
}

export interface LeaderboardWarning {
  code: string;
  message: string;
}

export interface LeaderboardResponse {
  scope: Scope;
  window: TimeWindow;
  priorWindow: TimeWindow | null;
  /** true when prior-window deltas are populated. */
  hasTrend: boolean;
  baseUrl: string;
  currentUser: string;
  generatedAt: string;
  fromCache: boolean;
  /** Per-metric labels, e.g. a tier-fallback note on `mrsReviewed`. */
  metricNotes: Partial<Record<keyof UserMetrics, string>>;
  /** Who ranks #1 per metric (null when no one qualifies). Classification lives in the data layer. */
  leaders: Partial<Record<MetricKey, string | null>>;
  users: UserRow[];
  warnings: LeaderboardWarning[];
}

