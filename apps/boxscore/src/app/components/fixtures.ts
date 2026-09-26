/**
 * Component-test fixture builders for the leaderboard UI. Deliberately separate from
 * `test/builders.ts` (server tests): that helper has no `delta` knob, which the trend/delta
 * badge tests here need.
 */
import type {
  DistributionValue,
  LeaderboardResponse,
  MetricValue,
  UserMetrics,
  UserRow,
} from '../../shared/types';

interface ScalarOverride {
  value?: number;
  delta?: number | null;
}

interface DistOverride {
  p50?: number | null;
  deltaP50?: number | null;
}

function mv(o: ScalarOverride = {}): MetricValue {
  return { value: o.value ?? 0, delta: o.delta ?? null, rank: null };
}

function dv(o: DistOverride = {}): DistributionValue {
  return {
    p50: o.p50 ?? null,
    p90: null,
    deltaP50: o.deltaP50 ?? null,
    rank: null,
  };
}

export interface FixtureMetrics {
  additions?: ScalarOverride;
  deletions?: ScalarOverride;
  mrsMerged?: ScalarOverride;
  mrsReviewed?: ScalarOverride;
  pipelines?: ScalarOverride;
  reviewDepth?: ScalarOverride;
  reviewLatencyHours?: DistOverride;
  responseLatencyHours?: DistOverride;
  revertRate?: ScalarOverride;
  revertedCount?: ScalarOverride;
  sizeHealthPct?: ScalarOverride;
  codingDays?: ScalarOverride;
  currentStreak?: ScalarOverride;
  longestStreak?: ScalarOverride;
  reciprocity?: ScalarOverride;
  issuesCompleted?: ScalarOverride;
}

export function buildMetrics(o: FixtureMetrics = {}): UserMetrics {
  return {
    additions: mv(o.additions),
    deletions: mv(o.deletions),
    mrsMerged: mv(o.mrsMerged),
    mrsReviewed: mv(o.mrsReviewed),
    pipelines: mv(o.pipelines),
    pipelineStatus: { success: 0, failed: 0, canceled: 0, other: 0 },
    reviewDepth: mv(o.reviewDepth),
    reviewLatencyHours: dv(o.reviewLatencyHours),
    responseLatencyHours: dv(o.responseLatencyHours),
    revertRate: mv(o.revertRate),
    revertedCount: mv(o.revertedCount),
    sizeHealthPct: mv(o.sizeHealthPct),
    codingDays: mv(o.codingDays),
    currentStreak: mv(o.currentStreak),
    longestStreak: mv(o.longestStreak),
    reciprocity: mv(o.reciprocity),
    issuesCompleted: mv(o.issuesCompleted),
  };
}

export function buildUser(
  username: string,
  metrics: UserMetrics,
  opts: { resolved?: boolean; isCurrentUser?: boolean; name?: string } = {}
): UserRow {
  return {
    username,
    name: opts.name ?? username,
    resolved: opts.resolved ?? true,
    isCurrentUser: opts.isCurrentUser ?? false,
    metrics,
  };
}

export function buildResponse(
  users: UserRow[],
  opts: { hasTrend?: boolean } = {}
): LeaderboardResponse {
  return {
    scope: { type: 'group', groupPath: 'acme/eng' },
    window: {
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T00:00:00.000Z',
      key: '30d',
    },
    priorWindow: opts.hasTrend
      ? {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-07-31T00:00:00.000Z',
          key: '30d',
        }
      : null,
    hasTrend: opts.hasTrend ?? false,
    baseUrl: 'https://gitlab.example.com',
    currentUser:
      users.find(u => u.isCurrentUser)?.username ?? users[0]?.username ?? '',
    generatedAt: '2026-08-31T12:00:00.000Z',
    fromCache: true,
    metricNotes: {},
    leaders: {},
    users,
    warnings: [],
  };
}
