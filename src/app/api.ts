import type { CacheStatsResponse, LeaderboardResponse, RefreshStatusResponse, UserDetailResponse } from "../shared/types";

export interface FetchParams {
  range: string;
  refresh?: boolean;
  trend?: boolean;
  start?: string;
  end?: string;
  cacheOnly?: boolean;
}

/** A cacheOnly read returns the data, or this sentinel when the cache is cold. */
export type CacheOnlyResult = LeaderboardResponse | { cached: false };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function buildQuery(p: FetchParams): URLSearchParams {
  const q = new URLSearchParams({ range: p.range });
  if (p.refresh) q.set("refresh", "1");
  if (p.trend) q.set("trend", "1");
  if (p.start) q.set("start", p.start);
  if (p.end) q.set("end", p.end);
  if (p.cacheOnly) q.set("cacheOnly", "1");
  return q;
}

export function fetchLeaderboard(p: FetchParams): Promise<CacheOnlyResult> {
  return requestJson<CacheOnlyResult>(`/api/leaderboard?${buildQuery(p).toString()}`);
}

export function fetchDetail(user: string, p: FetchParams): Promise<UserDetailResponse> {
  const q = buildQuery(p);
  q.set("user", user);
  return requestJson<UserDetailResponse>(`/api/detail?${q.toString()}`);
}

export function startRefresh(p: FetchParams): Promise<RefreshStatusResponse> {
  return requestJson<RefreshStatusResponse>(`/api/refresh?${buildQuery(p).toString()}`, { method: "POST" });
}

export function pollRefresh(id: string): Promise<RefreshStatusResponse> {
  return requestJson<RefreshStatusResponse>(`/api/refresh/${id}`);
}

export async function cancelRefresh(id: string): Promise<void> {
  // Best-effort: a failed cancel shouldn't surface to the user or float an unhandled rejection.
  try {
    await fetch(`/api/refresh/${id}/cancel`, { method: "POST" });
  } catch (e) {
    console.warn("cancelRefresh failed", e);
  }
}

export async function fetchCacheStats(): Promise<CacheStatsResponse> {
  return requestJson("/api/cache/stats");
}

export async function clearCache(): Promise<void> {
  await requestJson("/api/cache/clear", { method: "POST" });
}
