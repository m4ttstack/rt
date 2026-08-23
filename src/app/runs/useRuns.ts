import { useEffect } from 'react';
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
 * server already filtered to run-updated (see startRelay) -- the daemon
 * multiplexes ports/status/system-processes/project-mrs through the same
 * upstream socket, and without that filter this would refetch the run list on
 * every unrelated daemon tick.
 */
export function useRunEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    socket.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
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
