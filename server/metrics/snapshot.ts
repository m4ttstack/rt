import { inWindow } from "../util/window.js";
import { buildIgnoredMrSet, buildMetricFilters, isDoneState, matchesTeam, type MetricFilters } from "./filters.js";
import { buildRevertedTitleSet, isReverted } from "./reverts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import type { FetchResult, NormMr } from "../pipeline/model.js";
import type { PipelineStatusBreakdown, TimeWindow } from "../../shared/types.js";

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

export interface SnapshotOptions {
  window: TimeWindow;
  users: readonly string[];
  sizeBand: { tooSmall: number; tooLarge: number };
  /** Linear team key — only MRs referencing this team's tickets count. */
  linearTeam?: string;
  /** Linear state names that count as "done". Empty = default (completed + canceled types). */
  doneStates?: string[];
  /** Additional regex patterns for bot username detection, from settings. */
  extraBotPatterns?: string[];
  /** Glob patterns for files to exclude from additions/deletions. */
  excludeFilePatterns?: string[];
  /** MR identifiers to exclude from all metrics. Format: "!123" or "project/path!123". */
  ignoredMrs?: string[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function emptyStatus(): PipelineStatusBreakdown {
  return { success: 0, failed: 0, canceled: 0, other: 0 };
}

/** Compute every metric for every configured user over one window. Pure. */
export function computeSnapshot(fetched: FetchResult, opts: SnapshotOptions): Snapshot {
  const isIgnored = buildIgnoredMrSet(opts.ignoredMrs);
  const filtered: FetchResult = {
    ...fetched,
    mrs: fetched.mrs.filter((m) => !isIgnored(m)),
  };
  const revertedTitles = buildRevertedTitleSet(filtered.mrs);
  const filters = buildMetricFilters(opts);

  const byUser: Record<string, RawUserMetrics> = {};
  for (const u of opts.users) {
    byUser[u] = computeUser(u, filtered, opts, revertedTitles, filters);
  }
  return { byUser, approvalsAvailable: filtered.approvalsAvailable };
}

function computeUser(
  u: string,
  fetched: FetchResult,
  opts: SnapshotOptions,
  revertedTitles: Set<string>,
  f: MetricFilters,
): RawUserMetrics {
  const { window, sizeBand, linearTeam, doneStates } = opts;
  const { mrs, pipelines, pushEvents } = fetched;
  // Tolerate older cache envelopes (and tests) that predate the Linear field.
  const linearIssues = fetched.linearIssues ?? [];

  // --- Volume: authored & merged in window (spec 4.1, 4.2) ---
  const authoredMerged = mrs.filter(
    (m) => m.authorUsername === u && m.state === "merged" && f.hasTeamTicket(m) && inWindow(m.mergedAt, window),
  );
  const additions = sum(authoredMerged, (m) => f.lineCounts(m).additions);
  const deletions = sum(authoredMerged, (m) => f.lineCounts(m).deletions);
  const mrsMerged = authoredMerged.length;

  // --- MR size health (spec 4.8): share in the healthy band ---
  const healthy = authoredMerged.filter((m) => {
    const c = f.lineCounts(m).additions + f.lineCounts(m).deletions;
    return c >= sizeBand.tooSmall && c <= sizeBand.tooLarge;
  }).length;
  const sizeHealthPct = mrsMerged === 0 ? 0 : round(healthy / mrsMerged, 3);

  // --- Revert rate (spec 4.7) ---
  const revertedCount = authoredMerged.filter((m) => isReverted(m, revertedTitles)).length;
  const revertRate = mrsMerged === 0 ? 0 : round(revertedCount / mrsMerged, 3);

  // --- Pipelines (spec 4.4) ---
  const userPipelines = pipelines.filter(
    (p) => p.username === u && inWindow(p.createdAt, window),
  );
  const pipelineStatus = emptyStatus();
  for (const p of userPipelines) {
    if (p.status === "success") pipelineStatus.success++;
    else if (p.status === "failed") pipelineStatus.failed++;
    else if (p.status === "canceled") pipelineStatus.canceled++;
    else pipelineStatus.other++;
  }

  // --- Reviewed MRs + depth + reviewer-side response latency (spec 4.3, 4.5, 4.6) ---
  const reviewedMrs: NormMr[] = [];
  const depthPerMr: number[] = [];
  const responseLatencies: number[] = [];

  for (const m of mrs) {
    if (m.authorUsername === u) continue;
    const userNotesInWin = m.notes.filter(
      (n) => n.authorUsername === u && !n.system && inWindow(n.createdAt, window),
    );
    const approvedInScope =
      fetched.approvalsAvailable &&
      m.approvedByUsernames.includes(u) &&
      inWindow(m.mergedAt, window);

    if (userNotesInWin.length === 0 && !approvedInScope) continue;

    reviewedMrs.push(m);
    depthPerMr.push(userNotesInWin.filter((n) => n.inline).length);

    // First-response latency: user's earliest note minus MR clock-start.
    if (userNotesInWin.length > 0) {
      const earliest = Math.min(...userNotesInWin.map((n) => Date.parse(n.createdAt)));
      const clockStart = Date.parse(m.preparedAt ?? m.createdAt);
      const hours = (earliest - clockStart) / HOUR_MS;
      if (hours >= 0) responseLatencies.push(hours);
    }
  }
  const mrsReviewed = reviewedMrs.length;
  // Mean (not median) inline comments per reviewed MR: median collapses to 0 whenever
  // fewer than half of a reviewer's MRs have inline comments (the common case), which
  // makes it useless for discriminating reviewers. Mean keeps the signal.
  const reviewDepth = round(mean(depthPerMr), 2);

  // --- Author-side review latency (spec 4.6): how long the user's own MRs wait ---
  const authoredCohort = mrs.filter(
    (m) => m.authorUsername === u && inWindow(m.createdAt, window),
  );
  const authorLatencies: number[] = [];
  for (const m of authoredCohort) {
    const firstTouch = m.notes
      .filter((n) => !n.system && n.authorUsername !== u && !f.isBot(n.authorUsername))
      .map((n) => Date.parse(n.createdAt))
      .sort((a, b) => a - b)[0];
    if (firstTouch === undefined) continue;
    const clockStart = Date.parse(m.preparedAt ?? m.createdAt);
    const hours = (firstTouch - clockStart) / HOUR_MS;
    if (hours >= 0) authorLatencies.push(hours);
  }

  // --- Reciprocity (spec 4.10): reviews given / reviews received ---
  const given = mrsReviewed;
  const reviewers = new Set<string>();
  for (const m of authoredMerged) {
    for (const n of m.notes) {
      if (!n.system && n.authorUsername && n.authorUsername !== u && !f.isBot(n.authorUsername)) {
        reviewers.add(n.authorUsername);
      }
    }
    if (fetched.approvalsAvailable) {
      for (const a of m.approvedByUsernames) if (a !== u && !f.isBot(a)) reviewers.add(a);
    }
  }
  const received = reviewers.size;
  const reciprocity =
    received === 0 ? (given === 0 ? 0 : given) : round(given / received, 2);

  // --- Coding days: distinct days with a push to the tracked project (activity signal) ---
  const userPushes = pushEvents
    .filter((e) => e.username === u && inWindow(e.createdAt, window))
    .map((e) => e.createdAt);
  const codingDayStreaks = streaks(userPushes);

  // --- Streak: consecutive days with a MERGED MR (delivery, not pushes) ---
  const mergeStreaks = streaks(authoredMerged.map((m) => m.mergedAt ?? "").filter(Boolean));

  // --- Linear tickets linked from merged MRs, gated by team + state at compute time ---
  const issuesCompleted = linearIssues.filter(
    (i) =>
      i.assignedUser === u &&
      matchesTeam(i.identifier, linearTeam) &&
      isDoneState(i.stateType, i.stateName, doneStates),
  ).length;

  return {
    additions,
    deletions,
    mrsMerged,
    mrsReviewed,
    pipelines: userPipelines.length,
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
    issuesCompleted,
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
