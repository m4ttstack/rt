import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';

import { client } from '../api';

export function useSettingsDefs() {
  return useQuery({
    queryKey: ['settings', 'defs'],
    queryFn: async () => {
      const res = await client.api.settings.defs.$get();
      if (!res.ok) throw new Error(`settings defs failed: ${res.status}`);
      return res.json();
    },
    // The registry is static per server process; refetching it on focus
    // would only churn the palette.
    staleTime: Infinity,
  });
}

export function useExplainKey(key: string) {
  return useSuspenseQuery({
    queryKey: ['settings', 'explain', key],
    queryFn: async () => {
      const res = await client.api.settings.explain[':key'].$get({
        param: { key },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `explain failed: ${res.status}`);
      }
      return res.json();
    },
  });
}

export function useSetSetting(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      value: unknown;
      scope: 'user' | 'team' | 'machine';
    }) => {
      const res = await client.api.settings.set.$post({
        json: { key, ...input },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `set failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'explain', key],
      });
    },
  });
}
