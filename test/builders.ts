import type {
  DistributionValue,
  LeaderboardResponse,
  MetricValue,
  UserMetrics,
  UserRow,
} from "../src/shared/types.js";

const mv = (value: number): MetricValue => ({ value, delta: null, rank: null });
const dv = (p50: number | null): DistributionValue => ({ p50, p90: p50, deltaP50: null, rank: null });

export interface MetricInput {
  additions?: number;
  deletions?: number;
  mrsMerged?: number;
  mrsReviewed?: number;
  pipelines?: number;
  reviewDepth?: number;
  revertRate?: number;
  sizeHealthPct?: number;
  codingDays?: number;
  currentStreak?: number;
  longestStreak?: number;
  reciprocity?: number;
  revertedCount?: number;
  reviewLatencyHours?: number | null;
  responseLatencyHours?: number | null;
  issuesCompleted?: number;
}

export function makeMetrics(o: MetricInput = {}): UserMetrics {
  return {
    additions: mv(o.additions ?? 0),
    deletions: mv(o.deletions ?? 0),
    mrsMerged: mv(o.mrsMerged ?? 0),
    mrsReviewed: mv(o.mrsReviewed ?? 0),
    pipelines: mv(o.pipelines ?? 0),
    pipelineStatus: { success: 0, failed: 0, canceled: 0, other: 0 },
    reviewDepth: mv(o.reviewDepth ?? 0),
    reviewLatencyHours: dv(o.reviewLatencyHours ?? null),
    responseLatencyHours: dv(o.responseLatencyHours ?? null),
    revertRate: mv(o.revertRate ?? 0),
    revertedCount: mv(o.revertedCount ?? 0),
    sizeHealthPct: mv(o.sizeHealthPct ?? 0),
    codingDays: mv(o.codingDays ?? 0),
    currentStreak: mv(o.currentStreak ?? 0),
    longestStreak: mv(o.longestStreak ?? 0),
    reciprocity: mv(o.reciprocity ?? 0),
    issuesCompleted: mv(o.issuesCompleted ?? 0),
  };
}

export function makeUser(
  username: string,
  metrics: UserMetrics,
  opts: { resolved?: boolean; isCurrentUser?: boolean; name?: string } = {},
): UserRow {
  return {
    username,
    name: opts.name ?? username,
    resolved: opts.resolved ?? true,
    isCurrentUser: opts.isCurrentUser ?? false,
    metrics,
  };
}

export function makeResponse(
  users: UserRow[],
  opts: { currentUser?: string; hasTrend?: boolean; leaders?: LeaderboardResponse["leaders"] } = {},
): LeaderboardResponse {
  return {
    scope: { type: "projects", projectPaths: ["org/app"] },
    window: { start: "2026-05-01T00:00:00.000Z", end: "2026-05-31T00:00:00.000Z", key: "30d" },
    priorWindow: null,
    hasTrend: opts.hasTrend ?? false,
    baseUrl: "https://gitlab.com",
    currentUser:
      opts.currentUser ?? users.find((u) => u.isCurrentUser)?.username ?? users[0]?.username ?? "",
    generatedAt: "2026-05-31T00:00:00.000Z",
    fromCache: false,
    metricNotes: {},
    leaders: opts.leaders ?? {},
    users,
    warnings: [],
  };
}
