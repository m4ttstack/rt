import { useEffect, useMemo, useState } from "react";
import { MattstackShell, NotFoundPage } from "@mattstack/app-kit/app";
import { RailLink } from "@mattstack/app-kit/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { LeaderboardResponse } from "../shared/types";
import { isColdCache, type RangeSelection } from "./api";
import { useLeaderboard } from "./hooks/useLeaderboard";
import { useRefreshJob } from "./hooks/useRefreshJob";
import { useAppRoute } from "./routes";
import { Controls, type ViewMode } from "./components/Controls";
import { DetailPage } from "./components/DetailPage";
import { LeaderboardTable } from "./components/LeaderboardTable";
import { MetricCards } from "./components/MetricCards";
import { RefreshProgress as RefreshProgressBar } from "./components/RefreshProgress";
import { usePersistentState } from "./hooks/usePersistentState";

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

const queryClient = new QueryClient();

// Standalone placeholder until Task 7 wires up settings-kit.
function SettingsPlaceholder() {
  return (
    <div className="mx-auto max-w-[96rem] px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

function AppShell() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // Persisted across reloads so the last-selected window/toggles stick.
  const [rangeState, setRangeState] = usePersistentState<RangeState>("forge-range", { range: "30d" });
  const [trend, setTrend] = usePersistentState<boolean>("forge-trend", false);
  const [view, setView] = usePersistentState<ViewMode>("forge-view", "table");
  const route = useAppRoute();

  const selection = useMemo<RangeSelection>(
    () => ({ range: rangeState.range, start: rangeState.start, end: rangeState.end, trend }),
    [rangeState.range, rangeState.start, rangeState.end, trend],
  );

  const refreshJob = useRefreshJob({
    onDone: (result, startedFor) => {
      const matches =
        startedFor.range === rangeState.range &&
        startedFor.start === rangeState.start &&
        startedFor.end === rangeState.end &&
        startedFor.trend === trend;
      if (matches) setData(result);
    },
    onError: setJobError,
  });

  // Cache-only probe, keyed on the selection: react-query refetches it whenever range/trend change.
  const leaderboardQuery = useLeaderboard(selection);

  // Cancels any in-flight job first so a stale refresh doesn't linger in the background once the
  // selection moves on. All effects from one render commit before any async response can land, so
  // this always runs ahead of anything the new probe fetch below could resolve.
  useEffect(() => {
    refreshJob.cancel();
    setJobError(null);
    // refreshJob.cancel is intentionally excluded: it is a no-op when idle, and including it here
    // (its identity changes with jobId) would refire this effect for job starts/stops, not just
    // selection changes, which is the one thing this effect must run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Cold cache -> start a refresh job for the current selection. Warm cache -> that's the data.
  useEffect(() => {
    const result = leaderboardQuery.data;
    if (!result) return;
    if (isColdCache(result)) {
      void refreshJob.start(selection);
    } else {
      setData(result);
    }
    // Deliberately keyed on the probe result only: `selection` is read fresh via closure, and it
    // is already the selection that produced this exact `result` (react-query only hands back data
    // for the query key it was fetched with).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardQuery.data]);

  const error = jobError ?? (leaderboardQuery.error ? leaderboardQuery.error.message : null);
  const initialLoading = leaderboardQuery.isFetching && !data;

  return (
    <MattstackShell
      name="boxscore"
      appName="boxscore"
      mark={<img src="/favicon.svg" alt="" width={30} height={30} style={{ display: "block", flex: "none" }} />}
    >
      <MattstackShell.Rail>
        <RailLink icon="star" label="Leaderboard" href="/" />
        <RailLink icon="settings" label="Settings" href="/settings" />
      </MattstackShell.Rail>

      {route.name === "settings" && <SettingsPlaceholder />}

      {(route.name === "user" || route.name === "stat") && (
        <DetailPage
          username={route.username}
          initialStat={route.name === "stat" ? route.stat : null}
          range={rangeState}
          trend={trend}
        />
      )}

      {route.name === "not-found" && <NotFoundPage />}

      {route.name === "leaderboard" && (
        <div className="mx-auto max-w-[96rem] px-6 py-8">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Boxscore</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                GitLab performance across a hand-picked set ... volume metrics are gameable, so weigh
                them against the quality columns. See the README caveats before this becomes a scoreboard.
              </p>
            </div>
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
            refreshing={refreshJob.refreshing}
            onRefresh={() => void refreshJob.start(selection)}
            data={data}
          />

          {refreshJob.refreshing && <RefreshProgressBar progress={refreshJob.progress} onCancel={refreshJob.cancel} />}

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
      )}
    </MattstackShell>
  );
}
