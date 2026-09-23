import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';

import type { AgentModelOption } from '../../server/agent-models';
import { client } from '../api';

export type ExplainPayload = { def: SettingDefWire; rows: ExplainRowWire[] };

async function readJson<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!res.ok || body === null)
    throw new Error(body?.error ?? `${what} failed: ${res.status}`);
  return body;
}

export function useAgentModels(provider: 'claude' | 'codex') {
  return useQuery({
    queryKey: ['agent', 'models', provider],
    queryFn: async () => {
      const res = await client.api.agent.models.$get({ query: { provider } });
      if (!res.ok) throw new Error(`agent models failed: ${res.status}`);
      return (await res.json()) as { models: AgentModelOption[] };
    },
    // The catalog changes rarely; avoid a live codex spawn on every focus.
    staleTime: 5 * 60 * 1000,
  });
}

export function useExplainKey(key: string) {
  return useSuspenseQuery({
    queryKey: ['settings', 'explain', key],
    queryFn: async () =>
      readJson<ExplainPayload>(
        await fetch(`/api/settings/explain/${encodeURIComponent(key)}`),
        'explain'
      ),
  });
}

export function useSetSetting(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      value: unknown;
      scope: 'user' | 'team' | 'machine';
    }) =>
      readJson<{ rows: ExplainRowWire[] }>(
        await fetch('/api/settings/set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ...input }),
        }),
        'set'
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'explain', key],
      });
    },
  });
}
