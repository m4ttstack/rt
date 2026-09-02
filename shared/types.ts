/**
 * The wire contract between the backend and the frontend.
 * No `any` anywhere here (spec section 10): both sides import these types.
 */

export type RangePreset = "7d" | "30d" | "90d";
export type RangeKey = RangePreset | "custom" | "base90" | "base180";

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
  mrsMerged: MetricValue;
  mrsReviewed: MetricValue;
  pipelines: MetricValue;
  pipelineStatus: PipelineStatusBreakdown;

  // --- Quality / consistency metrics (spec 4.5-4.10) ---
  /** Mean inline (DiffNote) comments per reviewed MR. */
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

  // --- Delivery (Linear) ---
  /** Linear issues assigned to the user that completed in the window. */
  issuesCompleted: MetricValue;
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

/** Every warning the pipeline can attach to a response. Adding a site means adding a code here. */
export type WarningCode =
  | "user_unresolved"
  | "user_lookup_failed"
  | "mr_fetch_failed"
  | "mr_detail_partial"
  | "projects_fetch_failed"
  | "project_id_failed"
  | "pipeline_fetch_failed"
  | "events_fetch_failed"
  | "linear_partial"
  | "trend_unavailable";

export interface LeaderboardWarning {
  code: WarningCode;
  message: string;
}

/** One row of a stat's underlying evidence. Cells align to MetricEvidence.columns. */
export interface EvidenceRow {
  cells: string[];
  /** Deep link for the row (GitLab MR, Linear issue). null = not linkable. */
  href?: string | null;
  /** Render de-emphasized: the row exists but did NOT count toward the stat (e.g. stale issue). */
  muted?: boolean;
}

/** The records behind one person's value for one metric, render-agnostic. */
export interface MetricEvidence {
  columns: string[];
  rows: EvidenceRow[];
  /** One-line context, e.g. "p50 19.4h over 5 MRs" or "43 of 47 excluded as stale". */
  summary?: string;
}

/** Per-person drill-down: the ranked row (for the rail) plus per-metric evidence. */
export interface UserDetailResponse {
  window: TimeWindow;
  priorWindow: TimeWindow | null;
  hasTrend: boolean;
  baseUrl: string;
  currentUser: string;
  generatedAt: string;
  fromCache: boolean;
  /** The same ranked row the leaderboard shows, so the rail has value + rank + delta. */
  user: UserRow;
  /** Evidence keyed by metric. A metric may be absent if it has no records. */
  evidence: Partial<Record<MetricKey, MetricEvidence>>;
  warnings: LeaderboardWarning[];
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

/** One Linear workflow state, exposed so the settings page can list them. */
export interface LinearStateInfo {
  name: string;
  type: string;
  teamKey: string;
  teamName: string;
}

/**
 * Server-side settings that the user can tweak via the settings page without a code change.
 * Defaults come from config.ts; overrides are persisted to settings.json.
 */
export interface AppSettings {
  /** Linear team key to scope ticket counting to. Only tickets with this prefix count. */
  linearTeam: string;
  /** Linear state names that count as "done". Empty = use default (completed + canceled types). */
  doneStates: string[];
  /** GitLab usernames that appear on the leaderboard. */
  users: string[];
  /** The username highlighted as "you" in the UI. Must appear in users. */
  currentUser: string;
  sizeBand: {
    tooSmall: number;
    tooLarge: number;
  };
  bots: {
    /** Additional regex patterns beyond built-in bot detection. */
    extraPatterns: string[];
  };
  /** Glob patterns for files to exclude from additions/deletions (e.g. "*.json", "generated/*"). */
  excludeFilePatterns: string[];
  /** MR identifiers to exclude from all metrics. Format: "!123" or "project/path!123". */
  ignoredMrs: string[];
}

/** Live progress for a background refresh run. `total: 0` => indeterminate phase. */
export interface RefreshProgress {
  phase: "users" | "mrs-list" | "mrs-detail" | "pipelines" | "pushes" | "linear" | "compute";
  label: string;
  done: number;
  total: number;
  /** Trend runs the whole pipeline twice; which window this progress belongs to. */
  window: "current" | "prior";
}

export type RefreshJobStatus = "running" | "done" | "error" | "cancelled";

/** Response of GET /api/cache/stats. */
export interface CacheStatsResponse {
  mrDetails: number;
  mrList: number;
  linearIds: { valid: number; invalid: number };
}

/** A cached commenter/approver matching a bot pattern that isn't a configured user. */
export interface SuspectedBot {
  username: string;
  matchedPattern: string;
}

/** Response of POST /api/refresh and GET /api/refresh/:id. */
export interface RefreshStatusResponse {
  jobId: string;
  status: RefreshJobStatus;
  progress: RefreshProgress | null;
  /** Present only when status === "error". */
  error?: string;
  /** Present only when status === "done". */
  result?: LeaderboardResponse;
}


