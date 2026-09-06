import { useRoute } from 'wouter';

import { METRICS } from '../shared/metrics';
import type { MetricKey } from '../shared/types';

export type AppRoute =
  | { name: 'leaderboard' }
  | { name: 'user'; username: string }
  | { name: 'stat'; username: string; stat: MetricKey }
  | { name: 'settings' }
  | { name: 'not-found' };

/** wouter hands captured params back raw; a segment that is not valid
    percent-encoding must read as no match, not throw out of render. */
function decodeParam(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function decodeStat(raw: string): MetricKey | undefined {
  const decoded = decodeParam(raw);
  if (decoded === undefined) return undefined;
  return METRICS.some(m => m.key === decoded)
    ? (decoded as MetricKey)
    : undefined;
}

/**
 * The app's route table, as a hook: the current location in, a structured
 * route out. Follows console's `useAppRoute` shape (one `useRoute` per
 * candidate, checked most-specific first).
 */
export function useAppRoute(): AppRoute {
  const [isLeaderboard] = useRoute('/');
  const [isUser, userParams] = useRoute('/user/:name');
  const [isStat, statParams] = useRoute('/user/:name/:stat');
  const [isSettings] = useRoute('/settings');

  if (isLeaderboard) return { name: 'leaderboard' };
  if (isStat) {
    const username = decodeParam(statParams.name ?? '');
    const stat = decodeStat(statParams.stat ?? '');
    return username !== undefined && stat !== undefined
      ? { name: 'stat', username, stat }
      : { name: 'not-found' };
  }
  if (isUser) {
    const username = decodeParam(userParams.name ?? '');
    return username !== undefined
      ? { name: 'user', username }
      : { name: 'not-found' };
  }
  if (isSettings) return { name: 'settings' };
  return { name: 'not-found' };
}
