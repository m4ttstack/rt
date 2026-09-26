import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRefreshJob } from './useRefreshJob';

const { postMock, getMock, cancelMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock('../api', () => ({
  client: {
    api: {
      refresh: {
        $post: postMock,
        ':id': { $get: getMock, cancel: { $post: cancelMock } },
      },
    },
  },
  readOrThrow: async (res: { ok: boolean; json: () => Promise<unknown> }) => {
    if (!res.ok) throw new Error('request failed');
    return res.json();
  },
  selectionQuery: (s: { range: string }) => ({ range: s.range }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const selection = { range: '30d', trend: false };

describe('useRefreshJob: start() in-flight guard', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    cancelMock.mockReset();
    // Never settles by default: the poll query some tests trigger by assigning a jobId
    // shouldn't error out mid-test just because getMock has no explicit implementation.
    getMock.mockReturnValue(new Promise(() => {}));
  });

  it('does not start a second job while one is already in flight (regression: window-refocus double start)', async () => {
    let resolvePost!: (v: unknown) => void;
    postMock.mockReturnValue(
      new Promise(resolve => {
        resolvePost = resolve;
      })
    );

    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useRefreshJob({ onDone, onError }), {
      wrapper,
    });

    // Simulates App.tsx's cold-cache effect firing twice (e.g. two window-refocus refetches)
    // while the first refresh job's POST is still in flight -- before the guard, this
    // overwrote jobId and orphaned the first job.
    await act(async () => {
      void result.current.start(selection);
      void result.current.start(selection);
    });

    expect(postMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-1',
          status: 'running',
          progress: null,
        }),
      });
    });

    expect(result.current.jobId).toBe('job-1');
  });

  it('still starts a new job once the previous one has finished (manual refresh keeps working)', async () => {
    postMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-1',
          status: 'done',
          progress: null,
          result: undefined,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-2',
          status: 'running',
          progress: null,
        }),
      });

    const onDone = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useRefreshJob({ onDone, onError }), {
      wrapper,
    });

    await act(async () => {
      await result.current.start(selection);
    });
    expect(postMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.start(selection);
    });
    expect(postMock).toHaveBeenCalledTimes(2);
  });
});
