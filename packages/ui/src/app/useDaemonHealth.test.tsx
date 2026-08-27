import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useDaemonHealth } from './useDaemonHealth';

afterEach(() => vi.restoreAllMocks());

function mockProbe(reachable: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ reachable }), {
      headers: { 'content-type': 'application/json' },
    })
  );
}

test('seed false starts down with one probe counted', () => {
  mockProbe(false);
  const { result } = renderHook(() => useDaemonHealth(false));
  expect(result.current.reachable).toBe(false);
  expect(result.current.probeCount).toBe(1);
  expect(result.current.downSince).toBeTypeOf('number');
});

test('seed true starts up with lastAnsweredAt set', () => {
  mockProbe(true);
  const { result } = renderHook(() => useDaemonHealth(true));
  expect(result.current.reachable).toBe(true);
  expect(result.current.lastAnsweredAt).toBeTypeOf('number');
});

test('probeNow flips to down and counts probes', async () => {
  const fetchSpy = mockProbe(false);
  const { result } = renderHook(() => useDaemonHealth(true));
  await act(async () => {
    await result.current.probeNow();
  });
  expect(fetchSpy).toHaveBeenCalledWith('/api/daemon');
  expect(result.current.reachable).toBe(false);
  expect(result.current.probeCount).toBe(1);
  await act(async () => {
    await result.current.probeNow();
  });
  expect(result.current.probeCount).toBe(2);
});

test('a thrown fetch reads as unreachable', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'));
  const { result } = renderHook(() => useDaemonHealth(true));
  await act(async () => {
    await result.current.probeNow();
  });
  expect(result.current.reachable).toBe(false);
});
