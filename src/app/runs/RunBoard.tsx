import { useMemo } from 'react';

import { GenericError, Group, PageShell, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { bandFor, sortBand, type Band, type BoardRun } from './bands';
import { RunRow } from './RunRow';
import { useRunEvents, useRunList, useSeen } from './useRuns';

const BAND_ORDER: Band[] = ['attention', 'running', 'finished'];

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
        {BAND_ORDER.map(band => (
          <Stack key={band} gap="sm" data-testid={`band-${band}`}>
            <Group justify="space-between">
              <Text fw={700}>{BAND_META[band].title}</Text>
              <Text c={text.muted} size="sm">
                {bands[band].length}
              </Text>
            </Group>
            {bands[band].length === 0 ? (
              <Text c={text.muted} size="sm">
                {BAND_META[band].empty}
              </Text>
            ) : (
              <Stack gap="xs">
                {bands[band].map(run => (
                  <RunRow key={run.id} run={run} />
                ))}
              </Stack>
            )}
          </Stack>
        ))}
      </Stack>
    </PageShell>
  );
}
