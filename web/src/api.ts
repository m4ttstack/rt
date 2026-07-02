import type { AppSettings, LeaderboardResponse, LinearStateInfo, RefreshStatusResponse, UserDetailResponse } from "../../shared/types";

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
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
  return getJson<CacheOnlyResult>(`/api/leaderboard?${buildQuery(p).toString()}`);
}

export function fetchDetail(user: string, p: FetchParams): Promise<UserDetailResponse> {
  const q = buildQuery(p);
  q.set("user", user);
  return getJson<UserDetailResponse>(`/api/detail?${q.toString()}`);
}

export async function startRefresh(p: FetchParams): Promise<RefreshStatusResponse> {
  const res = await fetch(`/api/refresh?${buildQuery(p).toString()}`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as RefreshStatusResponse;
}

export function pollRefresh(id: string): Promise<RefreshStatusResponse> {
  return getJson<RefreshStatusResponse>(`/api/refresh/${id}`);
}

export async function cancelRefresh(id: string): Promise<void> {
  // Best-effort: a failed cancel shouldn't surface to the user or float an unhandled rejection.
  try {
    await fetch(`/api/refresh/${id}/cancel`, { method: "POST" });
  } catch (e) {
    console.warn("cancelRefresh failed", e);
  }
}

export interface SuspectedBot {
  username: string;
  matchedPattern: string;
}

export async function fetchSettings(): Promise<{ settings: AppSettings; defaults: AppSettings }> {
  return getJson("/api/settings");
}

export async function fetchLinearStates(): Promise<{ states: LinearStateInfo[] }> {
  return getJson("/api/settings/linear-states");
}

export async function fetchSuspectedBots(): Promise<{ bots: SuspectedBot[] }> {
  return getJson("/api/settings/suspected-bots");
}

export async function fetchCacheStats(): Promise<{ mrDetails: number; linearIds: { valid: number; invalid: number } }> {
  return getJson("/api/cache/stats");
}

export async function clearCache(): Promise<void> {
  const res = await fetch("/api/cache/clear", { method: "POST" });
  if (!res.ok) throw new Error("Failed to clear cache");
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { settings: AppSettings };
}
