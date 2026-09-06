import { useEffect } from 'react';
import type { BranchEnrichment } from '@mattstack/rt-client';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';

import { client } from '../api';

/** The spec's slow-poll safety net. The websocket is the live path; this is
    what catches a socket that dropped without us noticing. */
const POLL_MS = 30_000;

export function useRunList(repo?: string) {
  return useQuery({
    queryKey: ['runs', repo ?? null],
    queryFn: async () => {
      const res = await client.api.runs.$get({ query: repo ? { repo } : {} });
      if (!res.ok) throw new Error(`runs list failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: POLL_MS,
    // The board is filtered AND hot. Holding the previous list through a
    // filter change is worth more here than the loading branch suspense
    // would remove -- which is why this one view is not a suspense query.
    placeholderData: keepPreviousData,
  });
}

/**
 * One socket per tab. Invalidating on EVERY message is safe only because the
 * server already filtered the upstream relay to two topics -- run-updated
 * ('runs') and gate/* ('gates'), see src/server/index.ts's relay list --
 * the daemon multiplexes ports/status/system-processes/project-mrs through
 * the same upstream socket, and without that filter this would refetch on
 * every unrelated daemon tick.
 */
export function useRunEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    socket.onmessage = () => {
      // Three surfaces: ['runs'] is the board list, ['run'] every open
      // detail, ['gates'] the run-scoped gate rows RunRow/RunDetail render.
      // run-updated fires on every pipeline write (emit_update in
      // pipeline-state.sh), gate/* on every gate open/answer/park -- this is
      // what keeps the detail page and the gate surfaces both live.
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['run'] });
      void queryClient.invalidateQueries({ queryKey: ['gates'] });
    };
    return () => socket.close();
  }, [queryClient]);
}

export function useSeen() {
  return useQuery({
    queryKey: ['seen'],
    queryFn: async () => {
      const res = await client.api.seen.$get();
      if (!res.ok) throw new Error(`seen read failed: ${res.status}`);
      return res.json();
    },
  });
}

// The detail view cannot render without its run, so this one -- unlike
// useRunList above -- is a suspense query: no loading branch to forget.
export function useRun(repo: string, runId: string) {
  return useSuspenseQuery({
    queryKey: ['run', repo, runId],
    queryFn: async () => {
      const res = await client.api.runs[':repo'][':runId'].$get({
        param: { repo, runId },
      });
      if (!res.ok) throw new Error(`run detail failed: ${res.status}`);
      return res.json();
    },
    // The websocket is the live path; this is the same slow-poll safety net
    // the board list uses, for a socket that dropped without us noticing.
    refetchInterval: POLL_MS,
  });
}

/** Search states the retention window rather than hardcoding it -- rt owns
    `rt.runsPruneDays` (default 30), and the console renders whatever the
    resolver actually returns. */
export function useRunsPruneDays() {
  return useQuery({
    queryKey: ['settings', 'runsPruneDays'],
    queryFn: async () => {
      const res = await client.api.settings['runs-prune-days'].$get();
      if (!res.ok)
        throw new Error(`runs prune-days read failed: ${res.status}`);
      const { days } = await res.json();
      return days;
    },
  });
}

/** The Linear workspace slug (team-scoped, under `mattstack.integrations`).
    The branch cache only enriches branches the board syncs, so a ticket on
    any other prefix has an id and no url; the slug is what lets the client
    build one from the id alone. Null when the team has not set it. */
export function useLinearWorkspace() {
  return useQuery({
    queryKey: ['settings', 'linearWorkspace'],
    queryFn: async () => {
      const res = await client.api.settings['linear-workspace'].$get();
      if (!res.ok)
        throw new Error(`linear workspace read failed: ${res.status}`);
      const { workspace } = await res.json();
      return workspace;
    },
  });
}

/** One batched POST for every visible row's branch, keyed on the
    de-duplicated, sorted branch list -- an unsorted key would treat the same
    visible set in a different order as a different query and refetch
    instead of hitting cache. Skips the request entirely for an empty board
    rather than POSTing `{branches: []}`. */
export function useRunsEnrich(branches: string[]) {
  const key = [...new Set(branches)].sort();
  return useQuery({
    queryKey: ['runs-enrich', key],
    queryFn: async (): Promise<Record<string, BranchEnrichment>> => {
      const res = await client.api.runs.enrich.$post({
        json: { branches: key },
      });
      if (!res.ok) throw new Error(`runs enrich failed: ${res.status}`);
      return res.json();
    },
    enabled: key.length > 0,
    staleTime: 60_000,
  });
}

export function useMarkSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await client.api.seen[':runId'].$post({ param: { runId } });
      if (!res.ok) throw new Error(`mark seen failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seen'] });
    },
  });
}
