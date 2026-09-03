import { hc } from "hono/client";
import type { InferResponseType } from "hono/client";

import type { AppType } from "../server/routes";
import type { LeaderboardResponse, RefreshStatusResponse, UserDetailResponse } from "../shared/types";

/** Same-origin: Vite proxies /api to the boxscore server in dev, and in production the server serves this bundle itself. */
export const client = hc<AppType>("/");

/**
 * `/api/leaderboard`, `/api/detail`, and `POST /api/refresh` all route their window
 * parsing through `windowFromQuery` in `src/server/routes.ts`, whose declared return
 * type is the bare `Response` class rather than a Hono `TypedResponse`. That widens
 * each handler's inferred schema enough that `InferResponseType` collapses to `any`
 * for these three routes (verified: `const x: InferResponseType<...> = 5` type-checks
 * with the annotation in place, and stops type-checking once it's removed). Fixing it
 * is a one-line change confined to that annotation, but src/server is out of scope for
 * this task, so these three response types are imported from the shared wire contract
 * instead of (silently) losing type safety to `any`. This is not re-deriving a DTO:
 * `LeaderboardResponse`, `UserDetailResponse`, and `RefreshStatusResponse` are the
 * server's own exported types, not hand-written duplicates.
 */
export type LeaderboardResult = LeaderboardResponse | { cached: false };
export type DetailResult = UserDetailResponse;
export type RefreshResult = RefreshStatusResponse;

/** The other job routes carry no `windowFromQuery` call, so inference is unaffected there. */
export type CacheStats = InferResponseType<typeof client.api.cache.stats.$get, 200>;

export function isColdCache(res: LeaderboardResult): res is { cached: false } {
  return "cached" in res && res.cached === false;
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
  if (s.trend) q.trend = "1";
  return q;
}

/** The server returns `{ error }` envelopes on failure; unwrap them into thrown Errors so every hook has the same failure semantics. */
export async function readOrThrow<T>(
  res: { ok: boolean; status: number; json(): Promise<unknown> },
  label: string,
): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${label} failed: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}
