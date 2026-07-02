/**
 * Per-stat evidence: the underlying records behind one person's value for each metric.
 * Pure ... mirrors the cohort filters in snapshot.ts so the row counts here always match the
 * numbers there (test/evidence.test.ts asserts that). The output is render-agnostic
 * (columns + rows + summary), so the UI renders every stat with one component.
 */
import { inWindow } from "../util/window.js";
import { buildRevertedTitleSet, isReverted } from "./reverts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import { buildIgnoredMrSet, buildMetricFilters, isDoneState, matchesTeam } from "./snapshot.js";
import type { FetchResult, NormMr } from "../pipeline/model.js";
import type { MetricEvidence, MetricKey, TimeWindow } from "../../shared/types.js";

export interface EvidenceContext {
  window: TimeWindow;
  baseUrl: string;
  sizeBand: { tooSmall: number; tooLarge: number };
  linearTeam?: string;
  doneStates?: string[];
  extraBotPatterns?: string[];
  excludeFilePatterns?: string[];
  ignoredMrs?: string[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ROWS = 300;

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");
const changed = (m: NormMr): number => m.additions + m.deletions;
const hrs = (n: number): string => `${round(n, 1)}h`;

/** Build every metric's evidence for one user. Metrics with no records are omitted. */
export function buildUserEvidence(
  fetched: FetchResult,
  u: string,
  ctx: EvidenceContext,
): Partial<Record<MetricKey, MetricEvidence>> {
  const { window: w, baseUrl, sizeBand, linearTeam, doneStates } = ctx;
  const isIgnored = buildIgnoredMrSet(ctx.ignoredMrs);
  // Highest iid first so every MR-keyed table renders newest work at the top.
  const mrs = fetched.mrs.filter((m) => !isIgnored(m)).sort((a, b) => b.iid - a.iid);
  const { pipelines, pushEvents } = fetched;
  const linearIssues = fetched.linearIssues ?? [];
  const revertedTitles = buildRevertedTitleSet(mrs);
  const mrUrl = (m: NormMr) => `${baseUrl}/${m.projectPath}/-/merge_requests/${m.iid}`;
  const { lineCounts: filteredLines, isBot } = buildMetricFilters(ctx);

  const out: Partial<Record<MetricKey, MetricEvidence>> = {};

  // --- Authored & merged in window (drives most volume + several quality stats) ---
  const authoredMerged = mrs.filter(
    (m) => m.authorUsername === u && m.state === "merged" && inWindow(m.mergedAt, w),
  );

  // additions / deletions / mrsMerged all share the merged-MR list.
  const mergedRows = authoredMerged.map((m) => {
    const f = filteredLines(m);
    return {
      cells: [`!${m.iid}`, m.title, `+${f.additions}`, `−${f.deletions}`, day(m.mergedAt)],
      href: mrUrl(m),
    };
  });
  const mergedCols = ["MR", "Title", "Added", "Deleted", "Merged"];
  const totalAdd = authoredMerged.reduce((s, m) => s + filteredLines(m).additions, 0);
  const totalDel = authoredMerged.reduce((s, m) => s + filteredLines(m).deletions, 0);
  out.additions = { columns: mergedCols, rows: mergedRows, summary: `${totalAdd} lines added across ${authoredMerged.length} merged MRs` };
  out.deletions = { columns: mergedCols, rows: mergedRows, summary: `${totalDel} lines deleted across ${authoredMerged.length} merged MRs` };
  out.mrsMerged = { columns: mergedCols, rows: mergedRows, summary: `${authoredMerged.length} MRs merged` };

  // sizeHealthPct: each merged MR's changed lines + whether it's in the band.
  const healthy = (m: NormMr) => {
    const f = filteredLines(m);
    const c = f.additions + f.deletions;
    return c >= sizeBand.tooSmall && c <= sizeBand.tooLarge;
  };
  out.sizeHealthPct = {
    columns: ["MR", "Title", "Changed", "In band?"],
    rows: authoredMerged.map((m) => {
      const f = filteredLines(m);
      return {
        cells: [`!${m.iid}`, m.title, String(f.additions + f.deletions), healthy(m) ? "✓" : "✗"],
        href: mrUrl(m),
        muted: !healthy(m),
      };
    }),
    summary: `${authoredMerged.filter(healthy).length} of ${authoredMerged.length} MRs in the ${sizeBand.tooSmall}–${sizeBand.tooLarge} line band`,
  };

  // revertRate / revertedCount: merged MRs, reverted ones flagged.
  const revertedRows = authoredMerged.map((m) => ({
    cells: [`!${m.iid}`, m.title, day(m.mergedAt), isReverted(m, revertedTitles) ? "reverted" : "—"],
    href: mrUrl(m),
    muted: !isReverted(m, revertedTitles),
  }));
  const revertedN = authoredMerged.filter((m) => isReverted(m, revertedTitles)).length;
  const revertEvidence = {
    columns: ["MR", "Title", "Merged", "Reverted?"],
    rows: revertedRows,
    summary: `${revertedN} of ${authoredMerged.length} merged MRs later reverted`,
  };
  out.revertRate = revertEvidence;
  out.revertedCount = revertEvidence;

  // --- Reviewed teammates' MRs: depth + reviewer-side response latency ---
  const reviewedRows: { cells: string[]; href: string }[] = [];
  const depthRows: { cells: string[]; href: string }[] = [];
  const responseRows: { cells: string[]; href: string }[] = [];
  const responseSamples: number[] = [];
  const reviewedAuthors = new Set<string>();

  for (const m of mrs) {
    if (m.authorUsername === u) continue;
    const userNotes = m.notes.filter((n) => n.authorUsername === u && !n.system && inWindow(n.createdAt, w));
    const approvedInScope = fetched.approvalsAvailable && m.approvedByUsernames.includes(u) && inWindow(m.mergedAt, w);
    if (userNotes.length === 0 && !approvedInScope) continue;

    const inline = userNotes.filter((n) => n.inline).length;
    if (m.authorUsername) reviewedAuthors.add(m.authorUsername);
    reviewedRows.push({
      cells: [`!${m.iid}`, m.authorUsername ?? "—", m.title, String(userNotes.length), String(inline)],
      href: mrUrl(m),
    });
    depthRows.push({ cells: [`!${m.iid}`, m.title, String(inline)], href: mrUrl(m) });

    if (userNotes.length > 0) {
      const earliest = Math.min(...userNotes.map((n) => Date.parse(n.createdAt)));
      const clockStart = Date.parse(m.preparedAt ?? m.createdAt);
      const h = (earliest - clockStart) / HOUR_MS;
      if (h >= 0) {
        responseSamples.push(h);
        responseRows.push({ cells: [`!${m.iid}`, m.title, hrs(h)], href: mrUrl(m) });
      }
    }
  }
  out.mrsReviewed = {
    columns: ["MR", "Author", "Title", "Comments", "Inline"],
    rows: reviewedRows,
    summary: `${reviewedRows.length} teammates' MRs reviewed`,
  };
  out.reviewDepth = {
    columns: ["MR", "Title", "Inline comments"],
    rows: depthRows,
    summary: `mean ${round(mean(depthRows.map((r) => Number(r.cells[2]))), 2)} inline comments per reviewed MR`,
  };
  out.responseLatencyHours = {
    columns: ["MR", "Title", "Response"],
    rows: responseRows,
    summary: distSummary(responseSamples, "first response"),
  };

  // --- Author-side review latency: how long the user's own MRs waited ---
  const authoredCohort = mrs.filter((m) => m.authorUsername === u && inWindow(m.createdAt, w));
  const waitRows: { cells: string[]; href: string }[] = [];
  const waitSamples: number[] = [];
  for (const m of authoredCohort) {
    const firstTouch = m.notes
      .filter((n) => !n.system && n.authorUsername !== u && !isBot(n.authorUsername))
      .map((n) => Date.parse(n.createdAt))
      .sort((a, b) => a - b)[0];
    if (firstTouch === undefined) continue;
    const clockStart = Date.parse(m.preparedAt ?? m.createdAt);
    const h = (firstTouch - clockStart) / HOUR_MS;
    if (h >= 0) {
      waitSamples.push(h);
      waitRows.push({ cells: [`!${m.iid}`, m.title, hrs(h)], href: mrUrl(m) });
    }
  }
  out.reviewLatencyHours = {
    columns: ["MR", "Title", "Wait"],
    rows: waitRows,
    summary: distSummary(waitSamples, "first review"),
  };

  // --- Reciprocity: who reviewed this user's merged MRs (received side) ---
  const reviewers = new Map<string, number>();
  for (const m of authoredMerged) {
    const seen = new Set<string>();
    for (const n of m.notes) {
      if (!n.system && n.authorUsername && n.authorUsername !== u && !isBot(n.authorUsername)) seen.add(n.authorUsername);
    }
    if (fetched.approvalsAvailable) for (const a of m.approvedByUsernames) if (a !== u && !isBot(a)) seen.add(a);
    for (const r of seen) reviewers.set(r, (reviewers.get(r) ?? 0) + 1);
  }
  const given = reviewedRows.length;
  const received = reviewers.size;
  out.reciprocity = {
    columns: ["Reviewer", "Your MRs they reviewed"],
    rows: [...reviewers.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ cells: [name, String(n)] })),
    summary: `gave ${given} reviews, received from ${received} reviewer(s) ... ratio ${received === 0 ? given : round(given / received, 2)}`,
  };

  // --- Pipelines triggered ---
  const userPipes = pipelines.filter((p) => p.username === u && inWindow(p.createdAt, w));
  const statusCount = userPipes.reduce<Record<string, number>>((acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc), {});
  out.pipelines = {
    columns: ["Status", "Created"],
    rows: [...userPipes]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((p) => ({ cells: [p.status, day(p.createdAt)], muted: p.status !== "success" })),
    summary: Object.entries(statusCount).map(([s, n]) => `${n} ${s}`).join(" · ") || "no pipelines",
  };

  // --- Coding days: distinct days the user pushed to the tracked project ---
  const pushDays = new Map<string, number>();
  for (const e of pushEvents) {
    if (e.username === u && inWindow(e.createdAt, w)) pushDays.set(day(e.createdAt), (pushDays.get(day(e.createdAt)) ?? 0) + 1);
  }
  out.codingDays = {
    columns: ["Date", "Pushes"],
    rows: [...pushDays.entries()].sort().reverse().map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `${pushDays.size} distinct days with a push`,
  };

  // --- Merge streak: days the user merged at least one MR ---
  const mergeByDay = new Map<string, number>();
  for (const m of authoredMerged) if (m.mergedAt) mergeByDay.set(day(m.mergedAt), (mergeByDay.get(day(m.mergedAt)) ?? 0) + 1);
  const ms = streaks(authoredMerged.map((m) => m.mergedAt ?? "").filter(Boolean));
  const mergeDayEvidence = {
    columns: ["Date", "MRs merged"],
    rows: [...mergeByDay.entries()].sort().reverse().map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `longest run ${ms.longest} day(s), current ${ms.current}, across ${mergeByDay.size} merge day(s)`,
  };
  out.longestStreak = mergeDayEvidence;
  out.currentStreak = mergeDayEvidence;

  // --- Issues done (Linear): tickets linked from merged MRs, gated by team + state ---
  // Gated-out issues (wrong team, not in a done state) are dropped from the rows
  // entirely — only their counts surface in the summary.
  // Highest ticket number first, with numeric collation so ACME-2007 outranks ACME-938
  // (plain string compare would put 9xx after 2xxx).
  const allUserIssues = linearIssues
    .filter((i) => i.assignedUser === u)
    .sort((a, b) => b.identifier.localeCompare(a.identifier, undefined, { numeric: true }));
  let teamExcluded = 0;
  let stateExcluded = 0;
  const issueRows: { cells: string[]; href: string }[] = [];
  for (const i of allUserIssues) {
    if (!matchesTeam(i.identifier, linearTeam)) { teamExcluded++; continue; }
    if (!isDoneState(i.stateType, i.stateName, doneStates)) { stateExcluded++; continue; }
    const mrLinks = i.linkedMrs.map((m) => `!${m.iid}`).join(", ");
    const stateLabel = i.stateName ?? i.stateType ?? "—";
    issueRows.push({
      cells: [i.identifier, i.title, stateLabel, mrLinks || "—"],
      href: i.url,
    });
  }
  const parts: string[] = [`${issueRows.length} counted`];
  if (teamExcluded > 0) parts.push(`${teamExcluded} excluded by team`);
  if (stateExcluded > 0) parts.push(`${stateExcluded} excluded by state`);
  out.issuesCompleted = {
    columns: ["Issue", "Title", "State", "MR(s)"],
    rows: issueRows,
    summary: parts.join(" · "),
  };

  // Bound any pathologically large evidence list so a response stays sane.
  for (const key of Object.keys(out) as MetricKey[]) {
    const ev = out[key]!;
    if (ev.rows.length > MAX_ROWS) {
      const extra = ev.rows.length - MAX_ROWS;
      ev.rows = ev.rows.slice(0, MAX_ROWS);
      ev.summary = `${ev.summary ?? ""} (showing first ${MAX_ROWS}, ${extra} more)`.trim();
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
