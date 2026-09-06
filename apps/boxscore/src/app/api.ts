import { hc } from 'hono/client';
import type { InferResponseType } from 'hono/client';

import type { AppType } from '../server/routes';

/** Same-origin: Vite proxies /api to the boxscore server in dev, and in production the server serves this bundle itself. */
export const client = hc<AppType>('/');

export type LeaderboardResult = InferResponseType<
  typeof client.api.leaderboard.$get,
  200
>;
export type DetailResult = InferResponseType<
  typeof client.api.detail.$get,
  200
>;
export type RefreshResult = InferResponseType<
  typeof client.api.refresh.$post,
  200
>;
export type CacheStats = InferResponseType<
  typeof client.api.cache.stats.$get,
  200
>;

export function isColdCache(res: LeaderboardResult): res is { cached: false } {
  return 'cached' in res && res.cached === false;
}

export interface RangeSelection {
  range: string;
  start?: string;
  end?: string;
  trend: boolean;
}

/** Query params shared by the leaderboard/detail/refresh routes: range + optional custom bounds + trend flag. */
export function selectionQuery(s: RangeSelection): Record<string, string> {
  const q: Record<string, string> = { range: s.range };
  if (s.start) q.start = s.start;
  if (s.end) q.end = s.end;
  if (s.trend) q.trend = '1';
  return q;
}

/** The server returns `{ error }` envelopes on failure; unwrap them into thrown Errors so every hook has the same failure semantics. */
export async function readOrThrow<T>(
  res: { ok: boolean; status: number; json(): Promise<unknown> },
  label: string
): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `${label} failed: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}
