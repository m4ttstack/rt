import { useCallback, useEffect, useState } from "react";
import type { LeaderboardResponse } from "../../shared/types";
import { fetchLeaderboard } from "./api";
import { Controls, type ViewMode } from "./components/Controls";
import { LeaderboardTable } from "./components/LeaderboardTable";
import { MetricCards } from "./components/MetricCards";

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

export default function App() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rangeState, setRangeState] = useState<RangeState>({ range: "30d" });
  const [trend, setTrend] = useState(false);
  const [view, setView] = useState<ViewMode>("table");

  const load = useCallback(
    async (rs: RangeState, refresh: boolean, withTrend: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchLeaderboard({ ...rs, refresh, trend: withTrend });
        setData(res);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(rangeState, false, trend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeState, trend]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Forge Leaderboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          GitLab performance across a hand-picked set ... volume metrics are gameable, so weigh
          them against the quality columns. See the README caveats before this becomes a scoreboard.
        </p>
      </header>

      <Controls
        range={rangeState.range}
        onRange={(range, start, end) => setRangeState({ range, start, end })}
        trend={trend}
        onTrend={setTrend}
        view={view}
        onView={setView}
        refreshing={loading}
        onRefresh={() => void load(rangeState, true, trend)}
        data={data}
      />

      <div className="mt-5">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!error && loading && !data && <p className="text-slate-500">Loading…</p>}

        {data && (
          <>
            {data.warnings.length > 0 && (
              <ul className="mb-4 space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300/90">
                {data.warnings.map((w, i) => (
                  <li key={i}>⚠ {w.message}</li>
                ))}
              </ul>
            )}

            {view === "table" ? (
              <LeaderboardTable data={data} trend={trend} />
            ) : (
              <MetricCards data={data} trend={trend} />
            )}

            {Object.keys(data.metricNotes).length > 0 && (
              <dl className="mt-4 space-y-1 text-xs text-slate-500">
                {Object.entries(data.metricNotes).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-slate-400">{k}:</dt>{" "}
                    <dd className="inline">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </div>
  );
}
