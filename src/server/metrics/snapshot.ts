import { buildCorpus, buildUserCohorts, type CohortOptions, type Corpus } from "./cohorts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import type { FetchResult } from "../store/model.js";
import type { PipelineStatusBreakdown } from "../../shared/types.js";

export interface RawDist {
  p50: number | null;
  p90: number | null;
}

/** Per-user metric values before trend deltas are applied. */
export interface RawUserMetrics {
  additions: number;
  deletions: number;
  mrsMerged: number;
  mrsReviewed: number;
  pipelines: number;
  pipelineStatus: PipelineStatusBreakdown;
  reviewDepth: number;
  reviewLatencyHours: RawDist;
  responseLatencyHours: RawDist;
  revertRate: number;
  revertedCount: number;
  sizeHealthPct: number;
  codingDays: number;
  currentStreak: number;
  longestStreak: number;
  reciprocity: number;
  issuesCompleted: number;
}

export interface Snapshot {
  byUser: Record<string, RawUserMetrics>;
  approvalsAvailable: boolean;
}

export interface SnapshotOptions extends CohortOptions {
  users: readonly string[];
}

/** Compute every metric for every configured user over one window. Pure. */
export function computeSnapshot(fetched: FetchResult, opts: SnapshotOptions): Snapshot {
  const corpus = buildCorpus(fetched, opts);
  const byUser: Record<string, RawUserMetrics> = {};
  for (const u of opts.users) {
    byUser[u] = computeUser(u, corpus, opts);
  }
  return { byUser, approvalsAvailable: corpus.approvalsAvailable };
}

function computeUser(u: string, corpus: Corpus, opts: CohortOptions): RawUserMetrics {
  const c = buildUserCohorts(corpus, u, opts);
  const lines = corpus.filters.lineCounts;

  // --- Volume: authored & merged in window (spec 4.1, 4.2) ---
  const mrsMerged = c.authoredMerged.length;
  const additions = sum(c.authoredMerged, (m) => lines(m).additions);
  const deletions = sum(c.authoredMerged, (m) => lines(m).deletions);

  // --- MR size health (spec 4.8): share in the healthy band ---
  const healthy = c.authoredMerged.filter(c.inBand).length;
  const sizeHealthPct = mrsMerged === 0 ? 0 : round(healthy / mrsMerged, 3);

  // --- Revert rate (spec 4.7) ---
  const revertedCount = c.reverted.length;
  const revertRate = mrsMerged === 0 ? 0 : round(revertedCount / mrsMerged, 3);

  // --- Pipelines (spec 4.4) ---
  const pipelineStatus: PipelineStatusBreakdown = { success: 0, failed: 0, canceled: 0, other: 0 };
  for (const p of c.pipelines) {
    if (p.status === "success") pipelineStatus.success++;
    else if (p.status === "failed") pipelineStatus.failed++;
    else if (p.status === "canceled") pipelineStatus.canceled++;
    else pipelineStatus.other++;
  }

  // --- Reviewed MRs + depth + reviewer-side response latency (spec 4.3, 4.5, 4.6) ---
  const mrsReviewed = c.reviewed.length;
  // Mean (not median) inline comments per reviewed MR: median collapses to 0 whenever
  // fewer than half of a reviewer's MRs have inline comments (the common case), which
  // makes it useless for discriminating reviewers. Mean keeps the signal.
  const reviewDepth = round(mean(c.reviewed.map((r) => r.inlineCount)), 2);
  const responseLatencies = c.reviewed.flatMap((r) => (r.responseHours === null ? [] : [r.responseHours]));

  // --- Author-side review latency (spec 4.6): how long the user's own MRs wait ---
  const authorLatencies = c.waited.map((w) => w.waitHours);

  // --- Reciprocity (spec 4.10): reviews given / reviews received ---
  const given = mrsReviewed;
  const received = c.reviewersOfMine.size;
  const reciprocity = received === 0 ? (given === 0 ? 0 : given) : round(given / received, 2);

  // --- Coding days are push-based; the streak is merge-based (spec 4.9) ---
  const codingDayStreaks = streaks(c.pushTimestamps);
  const mergeStreaks = streaks(c.mergeTimestamps);

  return {
    additions,
    deletions,
    mrsMerged,
    mrsReviewed,
    pipelines: c.pipelines.length,
    pipelineStatus,
    reviewDepth,
    reviewLatencyHours: dist(authorLatencies),
    responseLatencyHours: dist(responseLatencies),
    revertRate,
    revertedCount,
    sizeHealthPct,
    codingDays: codingDayStreaks.distinct,
    currentStreak: mergeStreaks.current,
    longestStreak: mergeStreaks.longest,
    reciprocity,
    issuesCompleted: c.issues.counted.length,
  };
}

function dist(samples: number[]): RawDist {
  const p50 = percentile(samples, 0.5);
  const p90 = percentile(samples, 0.9);
  return { p50: p50 === null ? null : round(p50, 2), p90: p90 === null ? null : round(p90, 2) };
}

function sum<T>(items: readonly T[], pick: (t: T) => number): number {
  let total = 0;
  for (const it of items) total += pick(it);
  return total;
}
