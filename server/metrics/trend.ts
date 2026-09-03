import { applyRankings } from "./ranking.js";
import { round } from "./stats.js";
import type { RawDist, RawUserMetrics, Snapshot } from "./snapshot.js";
import type {
  DistributionValue,
  LeaderboardResponse,
  LeaderboardWarning,
  MetricValue,
  Scope,
  TimeWindow,
  UserMetrics,
  UserRow,
} from "../../shared/types.js";
import type { UserIdentity } from "../store/model.js";

export interface BuildContext {
  scope: Scope;
  window: TimeWindow;
  priorWindow: TimeWindow | null;
  baseUrl: string;
  currentUser: string;
  generatedAt: string;
  fromCache: boolean;
  identities: Record<string, UserIdentity>;
  warnings: LeaderboardWarning[];
}

/**
 * Assemble the wire response by combining the current snapshot with the prior-window
 * snapshot (when present) to produce per-metric deltas. Pure.
 */
export function buildResponse(
  current: Snapshot,
  prior: Snapshot | null,
  ctx: BuildContext,
): LeaderboardResponse {
  const hasTrend = prior !== null;

  const users: UserRow[] = Object.keys(current.byUser).map((username) => {
    const cur = current.byUser[username]!;
    const prev = prior?.byUser[username] ?? null;
    const identity = ctx.identities[username] ?? { username, name: null, resolved: false };
    return {
      username,
      name: identity.name,
      resolved: identity.resolved,
      isCurrentUser: username === ctx.currentUser,
      metrics: combine(cur, prev),
    };
  });

  // Classification lives here in the data layer: assign per-metric ranks + leaders.
  const leaders = applyRankings(users);

  const metricNotes: LeaderboardResponse["metricNotes"] = {};
  if (!current.approvalsAvailable) {
    metricNotes.mrsReviewed =
      "Approvals not accessible on this tier; reviewed = note authors only.";
    metricNotes.reciprocity = "Received side counts note authors only (approvals unavailable).";
  }
  metricNotes.revertRate = "Detected reverts only (undercounts fix-forward fixes).";

  return {
    scope: ctx.scope,
    window: ctx.window,
    priorWindow: ctx.priorWindow,
    hasTrend,
    baseUrl: ctx.baseUrl,
    currentUser: ctx.currentUser,
    generatedAt: ctx.generatedAt,
    fromCache: ctx.fromCache,
    metricNotes,
    leaders,
    users,
    warnings: ctx.warnings,
  };
}

function combine(cur: RawUserMetrics, prev: RawUserMetrics | null): UserMetrics {
  const mv = (c: number, p: number | undefined): MetricValue => ({
    value: c,
    delta: p === undefined ? null : round(c - p, 3),
    rank: null, // filled by applyRankings once all users are assembled
  });
  const dv = (c: RawDist, p: RawDist | undefined): DistributionValue => ({
    p50: c.p50,
    p90: c.p90,
    deltaP50:
      p && c.p50 !== null && p.p50 !== null ? round(c.p50 - p.p50, 2) : null,
    rank: null,
  });

  return {
    additions: mv(cur.additions, prev?.additions),
    deletions: mv(cur.deletions, prev?.deletions),
    mrsMerged: mv(cur.mrsMerged, prev?.mrsMerged),
    mrsReviewed: mv(cur.mrsReviewed, prev?.mrsReviewed),
    pipelines: mv(cur.pipelines, prev?.pipelines),
    pipelineStatus: cur.pipelineStatus,
    reviewDepth: mv(cur.reviewDepth, prev?.reviewDepth),
    reviewLatencyHours: dv(cur.reviewLatencyHours, prev?.reviewLatencyHours),
    responseLatencyHours: dv(cur.responseLatencyHours, prev?.responseLatencyHours),
    revertRate: mv(cur.revertRate, prev?.revertRate),
    revertedCount: mv(cur.revertedCount, prev?.revertedCount),
    sizeHealthPct: mv(cur.sizeHealthPct, prev?.sizeHealthPct),
    codingDays: mv(cur.codingDays, prev?.codingDays),
    currentStreak: mv(cur.currentStreak, prev?.currentStreak),
    longestStreak: mv(cur.longestStreak, prev?.longestStreak),
    reciprocity: mv(cur.reciprocity, prev?.reciprocity),
    issuesCompleted: mv(cur.issuesCompleted, prev?.issuesCompleted),
  };
}
