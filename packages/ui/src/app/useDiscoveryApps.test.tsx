import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDiscoveryApps } from './useDiscoveryApps';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => body }) as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

test('a null deck base loads an empty list without fetching', async () => {
  const fn = stubFetch({ apps: [] });
  const { result } = renderHook(() => useDiscoveryApps(null));
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  expect(fn).not.toHaveBeenCalled();
});

test('refresh fetches <base>/api/apps and exposes the rows', async () => {
  const apps = [
    { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null },
  ];
  const fn = stubFetch({ apps });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledWith('https://deck.mattstack/api/apps');
  await waitFor(() => expect(result.current.apps).toEqual(apps));
});

test('a rejected fetch loads empty and never throws', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down');
    })
  );
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
});

test('refresh caches for 30s and does not refetch within the window', async () => {
  const fn = stubFetch({ apps: [{ name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null }] });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledTimes(1);
});

test('non-array apps payload loads empty and never throws', async () => {
  const fn = stubFetch({ apps: 'nope' });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('missing apps key loads empty and never throws', async () => {
  const fn = stubFetch({});
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('a deckBase change within the cache window still refetches', async () => {
  const fn = stubFetch({
    apps: [{ name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null }],
  });
  const { result, rerender } = renderHook(
    ({ deckBase }: { deckBase: string }) => useDiscoveryApps(deckBase),
    { initialProps: { deckBase: 'https://deck.mattstack' } }
  );
  await act(async () => {
    await result.current.refresh();
  });
  rerender({ deckBase: 'https://other.mattstack' });
  await act(async () => {
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledTimes(2);
  expect(fn).toHaveBeenNthCalledWith(1, 'https://deck.mattstack/api/apps');
  expect(fn).toHaveBeenNthCalledWith(2, 'https://other.mattstack/api/apps');
});

test('malformed entries are filtered out, valid ones survive', async () => {
  const apps = [
    null,
    { name: 'x' },
    { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null },
  ];
  const fn = stubFetch({ apps });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([
    { name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null },
  ]);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('a non-OK response loads empty and never throws', async () => {
  const fn = stubFetch({ apps: [{ name: 'chat', displayName: 'Chat', url: 'https://chat.mattstack', icon: null }] }, false);
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  expect(fn).toHaveBeenCalledTimes(1);
});
