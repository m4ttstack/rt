import type { LeaderboardResponse } from "../../shared/types";

export interface FetchParams {
  range: string;
  refresh?: boolean;
  trend?: boolean;
  start?: string;
  end?: string;
}

export async function fetchLeaderboard(p: FetchParams): Promise<LeaderboardResponse> {
  const q = new URLSearchParams({ range: p.range });
  if (p.refresh) q.set("refresh", "1");
  if (p.trend) q.set("trend", "1");
  if (p.start) q.set("start", p.start);
  if (p.end) q.set("end", p.end);

  const res = await fetch(`/api/leaderboard?${q.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as LeaderboardResponse;
}
