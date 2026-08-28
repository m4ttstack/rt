import { useMemo, useState } from 'react';

import { GenericError, PageShell, Stack, Text, TextInput } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { BoardRun } from './bands';
import { CommandProvenance } from './CommandProvenance';
import { RunRow } from './RunRow';
import { matchRun, parseQuery } from './search';
import { useRunList, useRunsPruneDays, useSeen } from './useRuns';

function RetentionNotice({ days }: { days: number | undefined }) {
  const { text } = useSchemeColors();
  return (
    <Text c={text.muted} size="sm" data-testid="retention-window">
      {days === undefined
        ? 'Searching retained runs…'
        : `Searching the last ${days} day${days === 1 ? '' : 's'}; older runs have been pruned.`}
    </Text>
  );
}

export function RunSearch() {
  const [query, setQuery] = useState('');
  const runsQuery = useRunList();
  const seenQuery = useSeen();
  const pruneDaysQuery = useRunsPruneDays();
  const { text } = useSchemeColors();

  const runs: BoardRun[] = useMemo(() => {
    const list = runsQuery.data?.runs ?? [];
    const seen = seenQuery.data ?? {};
    return list.map(run => ({ ...run, seen: run.id in seen }));
  }, [runsQuery.data, seenQuery.data]);

  const terms = useMemo(() => parseQuery(query), [query]);
  const results = useMemo(
    () => runs.filter(run => matchRun(run, terms)),
    [runs, terms]
  );

  if (runsQuery.isError) {
    return (
      <PageShell title="Search">
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
      title="Search"
      actions={
        <CommandProvenance command="rt runs" asOf={runsQuery.dataUpdatedAt} />
      }
    >
      <Stack gap="md" data-testid="run-search">
        <RetentionNotice days={pruneDaysQuery.data} />
        <TextInput
          placeholder="Search by ticket, branch, repo, verb, or status"
          value={query}
          onChange={event => setQuery(event.currentTarget.value)}
          leftSection={<Icons.search size={16} />}
          data-testid="run-search-input"
        />
        {results.length === 0 ? (
          <Text c={text.muted} size="sm">
            {query.trim() ? 'No runs match.' : 'No retained runs yet.'}
          </Text>
        ) : (
          <Stack gap="xs" data-testid="run-search-results">
            {results.map(run => (
              <RunRow key={run.id} run={run} />
            ))}
          </Stack>
        )}
      </Stack>
    </PageShell>
  );
}
