import { useQuery } from '@tanstack/react-query';

import type { AgentModelOption } from '../../server/agent-models';
import { client } from '../api';

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
