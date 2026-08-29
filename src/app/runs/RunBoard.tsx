import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Anchor,
  Button,
  GenericError,
  Group,
  PageShell,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import {
  BAND_ORDER,
  computeBandIds,
  summarizeBoardChanges,
  type Band,
  type BandIds,
  type BoardRun,
} from './bands';
import { CommandProvenance } from './CommandProvenance';
import { RunRow } from './RunRow';
import {
  useRunEvents,
  useRunList,
  useRunsEnrich,
  useRunsPruneDays,
  useSeen,
} from './useRuns';

/** The finished band is the whole retention window and grows unbounded --
    render only the most recent slice here; `RunSearch` is the surface for
    the rest of the window. */
const FINISHED_DISPLAY_CAP = 20;

const BAND_META: Record<Band, { title: string; empty: string }> = {
  attention: {
    title: 'Needs attention',
    empty: 'Nothing needs you right now.',
  },
  running: { title: 'Running', empty: 'Nothing running.' },
  // The quiet state a morning with nothing wrong lands on -- this band is
  // what carries the "does anything need me?" answer when the other two
  // are empty, so its own empty copy stays honest about that.
  finished: { title: 'Recently finished', empty: 'No finished runs yet.' },
};

/**
 * The quiet-pill state machine. `committedIds` is the band/order the board
 * actually renders; it only ever changes on the first successful load (no
 * pill for the initial population) or when `applyUpdates` fires from a
 * click. Every render still maps `committedIds` through the LATEST run
 * objects, so a field on an already-placed row (status badge, current
 * stage) updates live -- only its band and position are held.
 */
function useQuietBoard(boardRuns: BoardRun[], ready: boolean) {
  const latestIds = useMemo(() => computeBandIds(boardRuns), [boardRuns]);
  const [committedIds, setCommittedIds] = useState<BandIds | null>(null);

  useEffect(() => {
    setCommittedIds(prev => (ready && prev === null ? latestIds : prev));
  }, [ready, latestIds]);

  const summary = useMemo(
    () =>
      committedIds
        ? summarizeBoardChanges(committedIds, latestIds)
        : { count: 0, message: '' },
    [committedIds, latestIds]
  );

  const applyUpdates = useCallback(
    () => setCommittedIds(latestIds),
    [latestIds]
  );

  const byId = useMemo(
    () => new Map(boardRuns.map(run => [run.id, run] as const)),
    [boardRuns]
  );

  const bands = useMemo(() => {
    const displayIds = committedIds ?? latestIds;
    const result: Record<Band, BoardRun[]> = {
      attention: [],
      running: [],
      finished: [],
    };
    for (const band of BAND_ORDER) {
      result[band] = displayIds[band]
        .map(id => byId.get(id))
        .filter((run): run is BoardRun => run !== undefined);
    }
    return result;
  }, [committedIds, latestIds, byId]);

  return {
    bands,
    pendingCount: summary.count,
    pendingMessage: summary.message,
    applyUpdates,
  };
}

export function RunBoard() {
  useRunEvents();
  const runsQuery = useRunList();
  const seenQuery = useSeen();
  const pruneDaysQuery = useRunsPruneDays();
  const { text } = useSchemeColors();

  const boardRuns: BoardRun[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    const seen = seenQuery.data ?? {};
    return runs.map(run => ({ ...run, seen: run.id in seen }));
  }, [runsQuery.data, seenQuery.data]);

  const { bands, pendingCount, pendingMessage, applyUpdates } = useQuietBoard(
    boardRuns,
    runsQuery.isSuccess && seenQuery.isSuccess
  );

  // Computed once here (rather than inline per band below) so the same
  // capped, sorted set that gets RENDERED is also what the enrich join
  // fetches for -- a run capped out of the finished band shouldn't cost a
  // branch in that batched request.
  const displayByBand: Record<Band, BoardRun[]> = {
    attention: bands.attention,
    running: bands.running,
    finished:
      bands.finished.length > FINISHED_DISPLAY_CAP
        ? [...bands.finished]
            .sort((a, b) => b.last_event_at - a.last_event_at)
            .slice(0, FINISHED_DISPLAY_CAP)
        : bands.finished,
  };

  const visibleBranches = [
    ...new Set(
      BAND_ORDER.flatMap(band => displayByBand[band])
        .map(run => run.branch)
        .filter((branch): branch is string => branch != null)
    ),
  ];
  const enrichQuery = useRunsEnrich(visibleBranches);

  if (runsQuery.isError) {
    return (
      <PageShell title="Runs" headerHeight={PAGE_ROW_HEIGHT} compactHeader>
        <GenericError
          title="Couldn't load runs"
          message={(runsQuery.error as Error).message}
          onRetry={() => void runsQuery.refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Runs"
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
      actions={
        <CommandProvenance command="rt runs" asOf={runsQuery.dataUpdatedAt} />
      }
    >
      <Stack gap="xl" data-testid="run-board">
        {pendingCount > 0 && (
          <Button
            data-testid="board-update-pill"
            size="xs"
            radius="xl"
            variant="filled"
            color="accent"
            leftSection={<Icons.refresh size={12} />}
            onClick={applyUpdates}
            pos="sticky"
            top={0}
            style={{ zIndex: 1, alignSelf: 'flex-end' }}
          >
            {pendingMessage}
          </Button>
        )}
        {BAND_ORDER.map(band => {
          const bandRuns = bands[band];
          const capped =
            band === 'finished' && bandRuns.length > FINISHED_DISPLAY_CAP;
          const displayRuns = displayByBand[band];

          return (
            <Stack key={band} gap="sm" data-testid={`band-${band}`}>
              <Group justify="space-between">
                <Text fw={700}>{BAND_META[band].title}</Text>
                <Text c={text.muted} size="sm">
                  {bandRuns.length}
                </Text>
              </Group>
              {bandRuns.length === 0 ? (
                <Text c={text.muted} size="sm">
                  {BAND_META[band].empty}
                </Text>
              ) : (
                <Stack gap="sm">
                  {displayRuns.map(run => (
                    <RunRow
                      key={run.id}
                      run={run}
                      pruneDays={pruneDaysQuery.data}
                      enrichment={
                        run.branch ? enrichQuery.data?.[run.branch] : undefined
                      }
                    />
                  ))}
                </Stack>
              )}
              {capped && (
                <Anchor component={Link} href="/search" size="sm">
                  See all {bandRuns.length} finished runs in search →
                </Anchor>
              )}
            </Stack>
          );
        })}
      </Stack>
    </PageShell>
  );
}
