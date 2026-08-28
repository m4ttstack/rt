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
    {
      name: 'chat',
      displayName: 'Chat',
      url: 'https://chat.mattstack',
      icon: null,
    },
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
  const fn = stubFetch({
    apps: [
      {
        name: 'chat',
        displayName: 'Chat',
        url: 'https://chat.mattstack',
        icon: null,
      },
    ],
  });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledTimes(1);
});

test('non-array apps payload loads empty, never throws, and is not cached', async () => {
  const fn = stubFetch({ apps: 'nope' });
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  await act(async () => {
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledTimes(2);
});

test('missing apps key loads empty, never throws, and is not cached', async () => {
  const fn = stubFetch({});
  const { result } = renderHook(() =>
    useDiscoveryApps('https://deck.mattstack')
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.apps).toEqual([]);
  await act(async () => {
    await result.current.refresh();
  });
  expect(fn).toHaveBeenCalledTimes(2);
});

test('a deckBase change within the cache window still refetches', async () => {
  const fn = stubFetch({
    apps: [
      {
        name: 'chat',
        displayName: 'Chat',
        url: 'https://chat.mattstack',
        icon: null,
      },
    ],
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
    {
      name: 'chat',
      displayName: 'Chat',
      url: 'https://chat.mattstack',
      icon: null,
    },
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
    {
      name: 'chat',
      displayName: 'Chat',
      url: 'https://chat.mattstack',
      icon: null,
    },
  ]);
  expect(fn).toHaveBeenCalledTimes(1);
});

function deferredResponse() {
  let resolve!: (body: unknown) => void;
  const promise = new Promise<Response>(res => {
    resolve = (body: unknown) =>
      res({ ok: true, json: async () => body } as Response);
  });
  return { promise, resolve };
}

test('a stale in-flight request is discarded when a newer one resolves first', async () => {
  const appsA = [
    { name: 'a', displayName: 'A', url: 'https://a.mattstack', icon: null },
  ];
  const appsB = [
    { name: 'b', displayName: 'B', url: 'https://b.mattstack', icon: null },
  ];
  const defA = deferredResponse();
  const defB = deferredResponse();
  const fn = vi.fn((url: string) =>
    url.startsWith('https://deck.mattstack') ? defA.promise : defB.promise
  );
  vi.stubGlobal('fetch', fn);

  const { result, rerender } = renderHook(
    ({ deckBase }: { deckBase: string }) => useDiscoveryApps(deckBase),
    { initialProps: { deckBase: 'https://deck.mattstack' } }
  );

  let refreshA!: Promise<void>;
  act(() => {
    refreshA = result.current.refresh();
  });

  rerender({ deckBase: 'https://other.mattstack' });

  let refreshB!: Promise<void>;
  act(() => {
    refreshB = result.current.refresh();
  });

  defB.resolve({ apps: appsB });
  await act(async () => {
    await refreshB;
  });
  expect(result.current.apps).toEqual(appsB);

  defA.resolve({ apps: appsA });
  await act(async () => {
    await refreshA;
  });

  expect(result.current.apps).toEqual(appsB);
  expect(fn).toHaveBeenCalledTimes(2);
});

test('a non-OK response loads empty and never throws', async () => {
  const fn = stubFetch(
    {
      apps: [
        {
          name: 'chat',
          displayName: 'Chat',
          url: 'https://chat.mattstack',
          icon: null,
        },
      ],
    },
    false
  );
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
