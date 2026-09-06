import { METRICS, metricValue, setMetricRank } from '../../shared/metrics.js';
import type { MetricKey, UserRow } from '../../shared/types.js';

export type Leaders = Partial<Record<MetricKey, string | null>>;

/**
 * Classify the field: for every metric, rank resolved users (1 = best, honoring the
 * metric's better-direction), share ranks on ties, and leave nulls/unresolved unranked.
 * Mutates each user's metric `rank` in place and returns the per-metric leader (#1).
 *
 * This is the data layer's job ... the UI just reads `rank` and `leaders`, so "who's #1"
 * is decided and tested here, not in rendering code.
 */
export function applyRankings(users: UserRow[]): Leaders {
  const leaders: Leaders = {};

  for (const d of METRICS) {
    const ranked = users
      .filter(u => u.resolved && metricValue(u.metrics, d) !== null)
      .map(u => ({ user: u, value: metricValue(u.metrics, d)! }))
      .sort((a, b) =>
        d.better === 'asc' ? a.value - b.value : b.value - a.value
      );

    let lastValue: number | null = null;
    let lastRank = 0;
    ranked.forEach((entry, i) => {
      const rank = entry.value === lastValue ? lastRank : i + 1;
      setMetricRank(entry.user.metrics, d, rank);
      lastValue = entry.value;
      lastRank = rank;
    });

    leaders[d.key] = ranked.length > 0 ? ranked[0]!.user.username : null;
  }

  return leaders;
}
