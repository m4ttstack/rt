import { inWindow } from "../util/window.js";
import { mrTicketHaystack, teamTicketRegex } from "../linear/ticket.js";
import { buildRevertedTitleSet, isReverted } from "./reverts.js";
import { compileBotPatterns, isBotUsername, mean, percentile, round, streaks } from "./stats.js";
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

const changedLines = (mr: NormMr): number => mr.additions + mr.deletions;

/** Build a predicate that returns true for MRs matching the ignore list. */
export function buildIgnoredMrSet(
  entries: string[] | undefined,
): (mr: { iid: number; projectPath: string }) => boolean {
  if (!entries || entries.length === 0) return () => false;
  const byProject = new Map<string, Set<number>>();
  const global = new Set<number>();
  for (const raw of entries) {
    const s = raw.trim();
    if (!s) continue;
    const bangIdx = s.indexOf("!");
    if (bangIdx >= 1) {
      const project = s.slice(0, bangIdx);
      const iid = Number(s.slice(bangIdx + 1));
      if (Number.isFinite(iid)) {
        let set = byProject.get(project);
        if (!set) { set = new Set(); byProject.set(project, set); }
        set.add(iid);
      }
    } else {
      const iid = Number(s.replace(/^!/, ""));
      if (Number.isFinite(iid)) global.add(iid);
    }
  }
  return (mr) => global.has(mr.iid) || (byProject.get(mr.projectPath)?.has(mr.iid) ?? false);
}

function filteredLineCounts(
  mr: NormMr,
  excludeRes: readonly RegExp[],
): { additions: number; deletions: number } {
  if (excludeRes.length === 0 || mr.diffStats.length === 0) {
    return { additions: mr.additions, deletions: mr.deletions };
  }
  let additions = 0;
  let deletions = 0;
  for (const f of mr.diffStats) {
    if (excludeRes.some((re) => re.test(f.path))) continue;
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/** Compile a minimal glob (supports *, **, and literal segments) to a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  // Patterns without a "/" match at any depth (gitignore-style):
  // "*.json" should match "apps/backend/package.json" and "package.json".
  const effective = pattern.includes("/") ? pattern : `**/${pattern}`;
  return new RegExp(
    "^" +
    effective
      .replace(/\*\*\//g, "\x00")
      .replace(/\*\*/g, "\x01")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\x00/g, "(.*/)?")
      .replace(/\x01/g, ".*") +
    "$",
    "i",
  );
}

/** Settings-derived predicates, compiled once per snapshot/evidence build. */
export interface MetricFilters {
  /** Additions/deletions with excluded files removed, memoized per MR. */
  lineCounts(mr: NormMr): { additions: number; deletions: number };
  isBot(username: string | null): boolean;
  hasTeamTicket(mr: Pick<NormMr, "title" | "sourceBranch" | "description">): boolean;
}

export function buildMetricFilters(
  opts: Pick<SnapshotOptions, "linearTeam" | "extraBotPatterns" | "excludeFilePatterns">,
): MetricFilters {
  const excludeRes = (opts.excludeFilePatterns ?? []).map(globToRegExp);
  const extraBots = compileBotPatterns(opts.extraBotPatterns);
  const ticketRe = opts.linearTeam ? teamTicketRegex(opts.linearTeam) : null;
  const counts = new WeakMap<NormMr, { additions: number; deletions: number }>();
  return {
    lineCounts(mr) {
      let c = counts.get(mr);
      if (!c) {
        c = filteredLineCounts(mr, excludeRes);
        counts.set(mr, c);
      }
      return c;
    },
    isBot: (username) => isBotUsername(username, extraBots),
    hasTeamTicket: (mr) => !ticketRe || ticketRe.test(mrTicketHaystack(mr)),
  };
}

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

/**
 * True when a ticket's current state counts as "done". When doneStates is empty,
 * falls back to type-based default: issues whose stateType is "completed" or "canceled".
 */
export function isDoneState(stateType: string | null, stateName: string | null, doneStates?: string[]): boolean {
  if (stateType === null) return true; // missing data... fall open
  if (doneStates && doneStates.length > 0) {
    return stateName !== null && doneStates.includes(stateName);
  }
  return stateType === "completed" || stateType === "canceled";
}

/** True when a Linear identifier belongs to the configured team (no team = all match). */
export function matchesTeam(identifier: string, linearTeam?: string): boolean {
  return !linearTeam || identifier.toUpperCase().startsWith(linearTeam.toUpperCase() + "-");
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
