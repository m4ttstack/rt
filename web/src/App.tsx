import { useCallback, useEffect, useRef, useState } from "react";
import type { LeaderboardResponse, RefreshProgress } from "../../shared/types";
import { cancelRefresh, fetchLeaderboard, pollRefresh, startRefresh } from "./api";
import { Controls, type ViewMode } from "./components/Controls";
import { DetailPage } from "./components/DetailPage";
import { LeaderboardTable } from "./components/LeaderboardTable";
import { MetricCards } from "./components/MetricCards";
import { RefreshProgress as RefreshProgressBar } from "./components/RefreshProgress";
import { ThemeToggle } from "./components/ThemeToggle";
import { useHashRoute } from "./hooks/useHashRoute";
import { usePersistentState } from "./hooks/usePersistentState";

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

const POLL_MS = 750;

export default function App() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  // Persisted across reloads so the last-selected window/toggles stick.
  const [rangeState, setRangeState] = usePersistentState<RangeState>("forge-range", { range: "30d" });
  const [trend, setTrend] = usePersistentState<boolean>("forge-trend", false);
  const [view, setView] = usePersistentState<ViewMode>("forge-view", "table");
  const route = useHashRoute();

  // Active background refresh job (null when idle).
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  // The selection a running job was started for, so we only swap in matching results.
  const jobSelection = useRef<{ range: string; start?: string; end?: string; trend: boolean } | null>(null);

  const startJob = useCallback(
    async (rs: RangeState, withTrend: boolean) => {
      setError(null);
      try {
        const status = await startRefresh({ ...rs, trend: withTrend });
        jobSelection.current = { ...rs, trend: withTrend };
        setJobId(status.jobId);
        setProgress(status.progress);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  // Cache-first load on mount / range / trend change. Cold cache auto-starts a refresh.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!data) setInitialLoading(true);
    fetchLeaderboard({ ...rangeState, trend, cacheOnly: true })
      .then((res) => {
        if (cancelled) return;
        if ("cached" in res && res.cached === false) {
          void startJob(rangeState, trend); // cold cache -> background refresh with progress
        } else {
          setData(res as LeaderboardResponse);
        }
      })
      .catch((e: unknown) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setInitialLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeState, trend]);

  // Poll the active job until it leaves "running".
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const status = await pollRefresh(jobId);
        if (stopped) return;
        setProgress(status.progress);
        if (status.status === "running") {
          timer = setTimeout(tick, POLL_MS);
          return;
        }
        // Terminal states:
        if (status.status === "done" && status.result) {
          const sel = jobSelection.current;
          const matches =
            sel &&
            sel.range === rangeState.range &&
            sel.start === rangeState.start &&
            sel.end === rangeState.end &&
            sel.trend === trend;
          if (matches) setData(status.result);
        } else if (status.status === "error") {
          setError(status.error ?? "Refresh failed");
        }
        setJobId(null);
        setProgress(null);
        jobSelection.current = null;
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        setJobId(null);
        setProgress(null);
      }
    };

    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const onCancel = useCallback(() => {
    if (jobId) void cancelRefresh(jobId);
  }, [jobId]);

  const refreshing = jobId !== null;

  if (route.user) {
    return (
      <DetailPage username={route.user} initialStat={route.stat} range={rangeState} trend={trend} />
    );
  }

  return (
    <div className="mx-auto max-w-[96rem] px-6 py-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Forge Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            GitLab performance across a hand-picked set ... volume metrics are gameable, so weigh
            them against the quality columns. See the README caveats before this becomes a scoreboard.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Controls
        range={rangeState.range}
        start={rangeState.start}
        end={rangeState.end}
        onRange={(range, start, end) => setRangeState({ range, start, end })}
        trend={trend}
        onTrend={setTrend}
        view={view}
        onView={setView}
        refreshing={refreshing}
        onRefresh={() => void startJob(rangeState, trend)}
        data={data}
      />

      {refreshing && <RefreshProgressBar progress={progress} onCancel={onCancel} />}

      <div className="mt-5">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!error && initialLoading && !data && <p className="text-muted-foreground">Loading…</p>}

        {data && (
          <>
            {data.warnings.length > 0 && (
              <ul className="mb-4 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300/90">
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
              <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                {Object.entries(data.metricNotes).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-foreground/70">{k}:</dt>{" "}
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
