import { useMemo } from 'react';

import { Anchor, GenericError, Group, PageShell, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Link } from '../router/Link';
import { bandFor, sortBand, type Band, type BoardRun } from './bands';
import { RunRow } from './RunRow';
import { useRunEvents, useRunList, useSeen } from './useRuns';

const BAND_ORDER: Band[] = ['attention', 'running', 'finished'];

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

export function RunBoard() {
  useRunEvents();
  const runsQuery = useRunList();
  const seenQuery = useSeen();
  const { text } = useSchemeColors();

  const boardRuns: BoardRun[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    const seen = seenQuery.data ?? {};
    return runs.map(run => ({ ...run, seen: run.id in seen }));
  }, [runsQuery.data, seenQuery.data]);

  const bands = useMemo(() => {
    const grouped: Record<Band, BoardRun[]> = {
      attention: [],
      running: [],
      finished: [],
    };
    for (const run of boardRuns) grouped[bandFor(run)].push(run);
    return {
      attention: sortBand(grouped.attention),
      running: sortBand(grouped.running),
      finished: sortBand(grouped.finished),
    };
  }, [boardRuns]);

  if (runsQuery.isError) {
    return (
      <PageShell title="Runs">
        <GenericError
          title="Couldn't load runs"
          message={(runsQuery.error as Error).message}
          onRetry={() => void runsQuery.refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="Runs">
      <Stack gap="xl" data-testid="run-board">
        {BAND_ORDER.map(band => {
          const bandRuns = bands[band];
          const isFinished = band === 'finished';
          const capped = isFinished && bandRuns.length > FINISHED_DISPLAY_CAP;
          // "Most recent" means highest `last_event_at`, which is the
          // opposite end from `sortBand`'s silence-first order for this band.
          const displayRuns = capped
            ? [...bandRuns]
                .sort((a, b) => b.last_event_at - a.last_event_at)
                .slice(0, FINISHED_DISPLAY_CAP)
            : bandRuns;

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
                <Stack gap="xs">
                  {displayRuns.map(run => (
                    <RunRow key={run.id} run={run} />
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
