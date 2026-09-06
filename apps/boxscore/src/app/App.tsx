import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MattstackShell, NotFoundPage } from '@mattstack/app-kit/app';
import { Alert, PageShell, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { RailLink } from '@mattstack/app-kit/router';
import type { LeaderboardResponse } from '../shared/types';
import { isColdCache, type RangeSelection } from './api';
import { Controls, ControlsMeta, type ViewMode } from './components/Controls';
import { DetailPage } from './components/DetailPage';
import { LeaderboardTable } from './components/LeaderboardTable';
import { MetricCards } from './components/MetricCards';
import { RefreshProgress as RefreshProgressBar } from './components/RefreshProgress';
import { useLeaderboard } from './hooks/useLeaderboard';
import { usePersistentState } from './hooks/usePersistentState';
import { useRefreshJob } from './hooks/useRefreshJob';
import { useAppRoute } from './routes';
import { SettingsPage } from './settings/SettingsPage';

interface RangeState {
  range: string;
  start?: string;
  end?: string;
}

const queryClient = new QueryClient();

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
  // True from the moment a cold cache triggers a background refresh until that refresh lands
  // (onDone/onError) or the selection changes. Covers the whole span, including the gap between
  // deciding to refresh and refreshJob.start()'s POST actually landing (before refreshJob.refreshing
  // flips true) -- without it the leaderboard render has no signal that data is still coming and
  // falls through to blank once the cache-only probe itself settles.
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  // Persisted across reloads so the last-selected window/toggles stick.
  const [rangeState, setRangeState] = usePersistentState<RangeState>(
    'forge-range',
    { range: '30d' }
  );
  const [trend, setTrend] = usePersistentState<boolean>('forge-trend', false);
  const [view, setView] = usePersistentState<ViewMode>('forge-view', 'table');
  const route = useAppRoute();

  const selection = useMemo<RangeSelection>(
    () => ({
      range: rangeState.range,
      start: rangeState.start,
      end: rangeState.end,
      trend,
    }),
    [rangeState.range, rangeState.start, rangeState.end, trend]
  );

  const refreshJob = useRefreshJob({
    onDone: (result, startedFor) => {
      const matches =
        startedFor.range === rangeState.range &&
        startedFor.start === rangeState.start &&
        startedFor.end === rangeState.end &&
        startedFor.trend === trend;
      if (matches) setData(result);
      setAwaitingRefresh(false);
    },
    onError: message => {
      setJobError(message);
      setAwaitingRefresh(false);
    },
  });

  // Cache-only probe, keyed on the selection: react-query refetches it whenever range/trend change.
  const leaderboardQuery = useLeaderboard(selection);

  // Cancels any in-flight job first so a stale refresh doesn't linger in the background once the
  // selection moves on. All effects from one render commit before any async response can land, so
  // this always runs ahead of anything the new probe fetch below could resolve.
  useEffect(() => {
    refreshJob.cancel();
    setJobError(null);
    setAwaitingRefresh(false);
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
      setAwaitingRefresh(true);
      void refreshJob.start(selection);
    } else {
      setData(result);
    }
    // Deliberately keyed on the probe result only: `selection` is read fresh via closure, and it
    // is already the selection that produced this exact `result` (react-query only hands back data
    // for the query key it was fetched with).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardQuery.data]);

  const error =
    jobError ??
    (leaderboardQuery.error ? leaderboardQuery.error.message : null);
  const loading = !data && (leaderboardQuery.isFetching || awaitingRefresh);

  return (
    <MattstackShell
      name="boxscore"
      appName="boxscore"
      headerHeight={48}
      mark={
        <img
          src="/favicon.svg"
          alt=""
          width={30}
          height={30}
          style={{ display: 'block', flex: 'none' }}
        />
      }
    >
      <MattstackShell.Rail>
        <RailLink icon="star" label="Leaderboard" href="/" />
        <RailLink icon="settings" label="Settings" href="/settings" />
      </MattstackShell.Rail>

      {route.name === 'settings' && <SettingsPage />}

      {(route.name === 'user' || route.name === 'stat') && (
        <DetailPage
          username={route.username}
          initialStat={route.name === 'stat' ? route.stat : null}
          range={rangeState}
          trend={trend}
        />
      )}

      {route.name === 'not-found' && (
        <PageShell>
          <NotFoundPage />
        </PageShell>
      )}

      {route.name === 'leaderboard' && (
        <PageShell>
          <PageShell.Main>
            <PageShell.Header
              actions={
                <Controls
                  range={rangeState.range}
                  start={rangeState.start}
                  end={rangeState.end}
                  onRange={(range, start, end) =>
                    setRangeState({ range, start, end })
                  }
                  trend={trend}
                  onTrend={setTrend}
                  view={view}
                  onView={setView}
                  refreshing={refreshJob.refreshing}
                  onRefresh={() => void refreshJob.start(selection)}
                />
              }
            >
              {data && <ControlsMeta data={data} />}
            </PageShell.Header>

            <PageShell.Content>
              <Stack gap="md">
                {refreshJob.refreshing && (
                  <RefreshProgressBar
                    progress={refreshJob.progress}
                    onCancel={() => {
                      // cancel() nulls the job without routing through onDone or onError, the only
                      // other paths that clear this, so a cancelled refresh would leave a Loading
                      // state with nothing running behind it.
                      setAwaitingRefresh(false);
                      refreshJob.cancel();
                    }}
                  />
                )}

                {error && (
                  <Alert
                    color="red"
                    title="Error"
                    variant="light"
                    icon={<Icon name="warning" size={16} />}
                  >
                    {error}
                  </Alert>
                )}

                {!error && loading && <Text c="dimmed">Loading…</Text>}

                {data && (
                  <Stack gap="md">
                    {data.warnings.length > 0 && (
                      <Alert
                        color="warn"
                        variant="light"
                        icon={<Icon name="warning" size={16} />}
                      >
                        <Stack gap={4}>
                          {data.warnings.map((w, i) => (
                            <Text key={i} size="xs">
                              {w.message}
                            </Text>
                          ))}
                        </Stack>
                      </Alert>
                    )}

                    {view === 'table' ? (
                      <LeaderboardTable data={data} trend={trend} />
                    ) : (
                      <MetricCards data={data} trend={trend} />
                    )}

                    {Object.keys(data.metricNotes).length > 0 && (
                      <Stack gap={2}>
                        {Object.entries(data.metricNotes).map(([k, v]) => (
                          <Text key={k} size="xs" c="dimmed">
                            <Text component="span" fw={500} c="dimmed">
                              {k}:
                            </Text>{' '}
                            {v}
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>
            </PageShell.Content>
          </PageShell.Main>
        </PageShell>
      )}
    </MattstackShell>
  );
}
