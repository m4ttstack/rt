import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const bindPost = vi.fn();
const surfaceApplyPost = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        bind: { $post: (...args: unknown[]) => bindPost(...args) },
        surface: {
          apply: { $post: (...args: unknown[]) => surfaceApplyPost(...args) },
        },
      },
    },
  },
}));

const { useSkillsApply } = await import('./useWiring');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// `WiringMap` calls `useSkillsApply(pack ?? '')` unconditionally (before
// packs load, `pack` is null) -- the only render path that fires either
// mutation is gated on a truthy pack, but the hook itself must not be a
// trap for a future caller that skips that gate.
describe('useSkillsApply with no pack selected', () => {
  it('rejects a bind without POSTing', async () => {
    const { result } = renderHook(() => useSkillsApply(''), { wrapper });

    act(() => {
      result.current.bind.mutate({ verb: 'v', slot: 's', fill: 'f' });
    });

    await waitFor(() => expect(result.current.bind.isError).toBe(true));
    expect(bindPost).not.toHaveBeenCalled();
  });

  it('rejects a surface apply without POSTing', async () => {
    const { result } = renderHook(() => useSkillsApply(''), { wrapper });

    act(() => {
      result.current.surfaceApply.mutate({ toPublic: [], toInternal: [] });
    });

    await waitFor(() => expect(result.current.surfaceApply.isError).toBe(true));
    expect(surfaceApplyPost).not.toHaveBeenCalled();
  });
});
