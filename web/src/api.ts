import type { LeaderboardResponse, UserDetailResponse } from "../../shared/types";

export interface FetchParams {
  range: string;
  refresh?: boolean;
  trend?: boolean;
  start?: string;
  end?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function rangeQuery(p: FetchParams): URLSearchParams {
  const q = new URLSearchParams({ range: p.range });
  if (p.refresh) q.set("refresh", "1");
  if (p.trend) q.set("trend", "1");
  if (p.start) q.set("start", p.start);
  if (p.end) q.set("end", p.end);
  return q;
}

export function fetchLeaderboard(p: FetchParams): Promise<LeaderboardResponse> {
  return getJson<LeaderboardResponse>(`/api/leaderboard?${rangeQuery(p).toString()}`);
}

export function fetchDetail(user: string, p: FetchParams): Promise<UserDetailResponse> {
  const q = rangeQuery(p);
  q.set("user", user);
  return getJson<UserDetailResponse>(`/api/detail?${q.toString()}`);
}
