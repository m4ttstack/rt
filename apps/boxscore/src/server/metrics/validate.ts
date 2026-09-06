import {
  metricDelta,
  metricRank,
  METRICS,
  metricValue,
} from '../../shared/metrics.js';
import type { LeaderboardResponse, UserRow } from '../../shared/types.js';

export type Severity = 'error' | 'warn';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

/**
 * Headless evaluator. Asserts the response is internally consistent (ranking integrity,
 * leader correctness, trend consistency, contract completeness) and surfaces data-quality
 * smells as warnings (uniform/all-zero metrics, nothing ranked). This is what the feedback
 * loop runs ... if it returns errors, the classification or pipeline is wrong.
 */
export function validateLeaderboard(
  res: LeaderboardResponse
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ severity: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ severity: 'warn', code, message });

  const resolved = res.users.filter(u => u.resolved);

  // --- Contract completeness ---
  if (res.users.length === 0) warn('no_users', 'Response contains no users.');
  if (resolved.length === 0)
    warn('none_resolved', 'No users resolved on the instance.');

  const currentRows = res.users.filter(u => u.isCurrentUser);
  if (currentRows.length === 0) {
    warn(
      'current_user_absent',
      `currentUser "${res.currentUser}" is not among the rows.`
    );
  } else if (currentRows.length > 1) {
    err(
      'current_user_dup',
      `${currentRows.length} rows flagged isCurrentUser.`
    );
  } else if (currentRows[0]!.username !== res.currentUser) {
    err(
      'current_user_mismatch',
      `isCurrentUser row is ${currentRows[0]!.username}, expected ${res.currentUser}.`
    );
  }

  // --- Trend consistency ---
  if (!res.hasTrend) {
    for (const u of res.users) {
      for (const d of METRICS) {
        if (metricDelta(u.metrics, d) !== null) {
          err(
            'trend_delta_without_trend',
            `hasTrend=false but ${u.username}.${d.key} has a delta.`
          );
        }
      }
    }
  }

  // --- Per-metric ranking integrity + data-quality smells ---
  for (const d of METRICS) {
    const entries = resolved
      .map(u => ({
        u,
        value: metricValue(u.metrics, d),
        rank: metricRank(u.metrics, d),
      }))
      .filter(
        (e): e is { u: UserRow; value: number; rank: number | null } =>
          e.value !== null
      );

    // leaders map must have an entry for every metric.
    if (!(d.key in res.leaders)) {
      err('leader_missing', `leaders is missing metric ${d.key}.`);
    }

    if (entries.length === 0) {
      if (res.leaders[d.key] != null) {
        err(
          'leader_without_data',
          `${d.key} has no ranked users but leader is ${res.leaders[d.key]}.`
        );
      }
      warn(
        'metric_unranked',
        `${d.key}: no user has a value ... nothing to rank.`
      );
      continue;
    }

    // Every ranked entry must carry a positive integer rank.
    for (const e of entries) {
      if (e.rank === null)
        err('rank_null', `${e.u.username}.${d.key} has a value but no rank.`);
      else if (!Number.isInteger(e.rank) || e.rank < 1)
        err('rank_invalid', `${e.u.username}.${d.key} rank=${e.rank}.`);
    }

    const best =
      d.better === 'desc'
        ? Math.max(...entries.map(e => e.value))
        : Math.min(...entries.map(e => e.value));

    // Rank 1 ⇔ best value.
    for (const e of entries) {
      if (e.rank === 1 && e.value !== best) {
        err(
          'rank1_not_best',
          `${e.u.username} is rank 1 in ${d.key} but value ${e.value} ≠ best ${best} (${d.better}).`
        );
      }
      if (e.value === best && e.rank !== 1) {
        err(
          'best_not_rank1',
          `${e.u.username} has best ${d.key} (${best}) but rank ${e.rank}.`
        );
      }
    }

    // Sorting by value (better-direction) must yield non-decreasing ranks, ties shared.
    const sorted = [...entries].sort((a, b) =>
      d.better === 'asc' ? a.value - b.value : b.value - a.value
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.value === prev.value && cur.rank !== prev.rank) {
        err(
          'tie_rank_mismatch',
          `${d.key}: equal values ${cur.value} have ranks ${prev.rank} and ${cur.rank}.`
        );
      }
      if (cur.value !== prev.value && (cur.rank ?? 0) <= (prev.rank ?? 0)) {
        err(
          'rank_not_monotonic',
          `${d.key}: ${cur.u.username} ranks ${cur.rank} ≤ ${prev.u.username} ${prev.rank} despite worse value.`
        );
      }
    }

    // leaders[key] must be a real rank-1 user.
    const leader = res.leaders[d.key];
    if (leader != null) {
      const leaderEntry = entries.find(e => e.u.username === leader);
      if (!leaderEntry)
        err(
          'leader_unknown',
          `${d.key} leader ${leader} is not a ranked user.`
        );
      else if (leaderEntry.rank !== 1)
        err(
          'leader_not_rank1',
          `${d.key} leader ${leader} has rank ${leaderEntry.rank}.`
        );
    }

    // Data-quality smell: every resolved user identical (often = metric not populating).
    const values = entries.map(e => e.value);
    if (values.length > 1 && values.every(v => v === values[0])) {
      warn(
        'metric_uniform',
        `${d.key}: all ${values.length} users have the same value (${values[0]}) ... may not be populating or is genuinely flat.`
      );
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warn').length;
  return { ok: errors === 0, errors, warnings, issues };
}
