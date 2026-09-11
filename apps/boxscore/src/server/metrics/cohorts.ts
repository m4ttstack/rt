import type { TimeWindow } from '../../shared/types.js';
import type {
  FetchResult,
  NormLinearIssue,
  NormMr,
  NormNote,
  NormPipeline,
  NormPushEvent,
} from '../store/model.js';
import { inWindow } from '../util/window.js';
import {
  buildIgnoredMrSet,
  buildMetricFilters,
  isDoneState,
  matchesTeam,
  type MetricFilters,
} from './filters.js';
import { buildRevertedTitleSet, isReverted } from './reverts.js';

export interface CohortOptions {
  window: TimeWindow;
  sizeBand: { tooSmall: number; tooLarge: number };
  /** Linear team key. When set, only merged MRs referencing this team's tickets count. */
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

/**
 * The fetch result with settings applied once: ignored MRs dropped, reverts and filters
 * precomputed. `mrs` is expected to already be bounded to the window by `updatedAt`; revert
 * detection and review attribution are only as complete as that bound.
 */
export interface Corpus {
  mrs: NormMr[];
  pipelines: NormPipeline[];
  pushEvents: NormPushEvent[];
  linearIssues: NormLinearIssue[];
  approvalsAvailable: boolean;
  revertedTitles: Set<string>;
  filters: MetricFilters;
}

export function buildCorpus(fetched: FetchResult, opts: CohortOptions): Corpus {
  const isIgnored = buildIgnoredMrSet(opts.ignoredMrs);
  const mrs = fetched.mrs.filter(m => !isIgnored(m));
  return {
    mrs,
    pipelines: fetched.pipelines,
    pushEvents: fetched.pushEvents,
    // Older cache envelopes predate the Linear field.
    linearIssues: fetched.linearIssues ?? [],
    approvalsAvailable: fetched.approvalsAvailable,
    revertedTitles: buildRevertedTitleSet(mrs),
    filters: buildMetricFilters(opts),
  };
}

/** A teammate's MR this user reviewed: their in-window notes, and their first response if any. */
export interface ReviewedMr {
  mr: NormMr;
  notes: NormNote[];
  inlineCount: number;
  /**
   * Hours from the MR's clock start to the user's earliest note; null when they only
   * approved, or when their earliest note predates the MR's clock start.
   */
  responseHours: number | null;
}

/** One of this user's MRs that got a first human touch. */
export interface WaitedMr {
  mr: NormMr;
  waitHours: number;
}

export interface IssueCohort {
  counted: NormLinearIssue[];
  teamExcluded: number;
  stateExcluded: number;
}

/**
 * Every record set a metric is derived from, for one user, with all settings applied.
 * snapshot.ts turns these into numbers and evidence.ts into rows, so the two cannot drift.
 */
export interface UserCohorts {
  /** Authored, merged in window, and (when a Linear team is set) referencing a team ticket. */
  authoredMerged: NormMr[];
  inBand: (mr: NormMr) => boolean;
  /** The subset of authoredMerged that a later MR reverted. */
  reverted: NormMr[];
  reviewed: ReviewedMr[];
  waited: WaitedMr[];
  /** Reviewer username to the number of this user's merged MRs they touched. */
  reviewersOfMine: Map<string, number>;
  pipelines: NormPipeline[];
  pushTimestamps: string[];
  mergeTimestamps: string[];
  issues: IssueCohort;
}

const HOUR_MS = 60 * 60 * 1000;

const hoursFrom = (clockStartIso: string, toMs: number): number =>
  (toMs - Date.parse(clockStartIso)) / HOUR_MS;

export function buildUserCohorts(
  corpus: Corpus,
  u: string,
  opts: CohortOptions
): UserCohorts {
  const { window, sizeBand } = opts;
  const { mrs, filters: f } = corpus;

  const authoredMerged = mrs.filter(
    m =>
      m.authorUsername === u &&
      m.state === 'merged' &&
      f.hasTeamTicket(m) &&
      inWindow(m.mergedAt, window)
  );

  const inBand = (m: NormMr): boolean => {
    const c = f.lineCounts(m);
    const changed = c.additions + c.deletions;
    return changed >= sizeBand.tooSmall && changed <= sizeBand.tooLarge;
  };

  const reverted = authoredMerged.filter(m =>
    isReverted(m, corpus.revertedTitles)
  );

  const reviewed: ReviewedMr[] = [];
  for (const m of mrs) {
    if (m.authorUsername === u) continue;
    const notes = m.notes.filter(
      n => n.authorUsername === u && !n.system && inWindow(n.createdAt, window)
    );
    const approvedInScope =
      corpus.approvalsAvailable &&
      m.approvedByUsernames.includes(u) &&
      inWindow(m.mergedAt, window);
    if (notes.length === 0 && !approvedInScope) continue;

    let responseHours: number | null = null;
    if (notes.length > 0) {
      const earliest = Math.min(...notes.map(n => Date.parse(n.createdAt)));
      const hours = hoursFrom(m.preparedAt ?? m.createdAt, earliest);
      if (hours >= 0) responseHours = hours;
    }
    reviewed.push({
      mr: m,
      notes,
      inlineCount: notes.filter(n => n.inline).length,
      responseHours,
    });
  }

  const waited: WaitedMr[] = [];
  for (const m of mrs) {
    if (m.authorUsername !== u || !inWindow(m.createdAt, window)) continue;
    const firstTouch = m.notes
      .filter(
        n => !n.system && n.authorUsername !== u && !f.isBot(n.authorUsername)
      )
      .map(n => Date.parse(n.createdAt))
      .sort((a, b) => a - b)[0];
    if (firstTouch === undefined) continue;
    const hours = hoursFrom(m.preparedAt ?? m.createdAt, firstTouch);
    if (hours >= 0) waited.push({ mr: m, waitHours: hours });
  }

  const reviewersOfMine = new Map<string, number>();
  for (const m of authoredMerged) {
    const seen = new Set<string>();
    for (const n of m.notes) {
      if (
        !n.system &&
        n.authorUsername &&
        n.authorUsername !== u &&
        !f.isBot(n.authorUsername)
      ) {
        seen.add(n.authorUsername);
      }
    }
    if (corpus.approvalsAvailable) {
      for (const a of m.approvedByUsernames)
        if (a !== u && !f.isBot(a)) seen.add(a);
    }
    for (const r of seen)
      reviewersOfMine.set(r, (reviewersOfMine.get(r) ?? 0) + 1);
  }

  const pipelines = corpus.pipelines.filter(
    p => p.username === u && inWindow(p.createdAt, window)
  );
  const pushTimestamps = corpus.pushEvents
    .filter(e => e.username === u && inWindow(e.createdAt, window))
    .map(e => e.createdAt);
  const mergeTimestamps = authoredMerged
    .map(m => m.mergedAt ?? '')
    .filter(Boolean);

  const issues: IssueCohort = {
    counted: [],
    teamExcluded: 0,
    stateExcluded: 0,
  };
  for (const i of corpus.linearIssues) {
    if (i.creditedUser !== u) continue;
    if (!matchesTeam(i.identifier, opts.linearTeam)) {
      issues.teamExcluded++;
      continue;
    }
    if (!isDoneState(i.stateType, i.stateName, opts.doneStates)) {
      issues.stateExcluded++;
      continue;
    }
    issues.counted.push(i);
  }

  return {
    authoredMerged,
    inBand,
    reverted,
    reviewed,
    waited,
    reviewersOfMine,
    pipelines,
    pushTimestamps,
    mergeTimestamps,
    issues,
  };
}
