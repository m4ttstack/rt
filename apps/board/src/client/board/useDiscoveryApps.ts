import { useCallback, useRef, useState } from 'react';

import type { DiscoveryApp, DiscoveryResponse } from './deck-discovery.ts';

interface DiscoveryState {
  apps: DiscoveryApp[];
  loaded: boolean;
}

const CACHE_MS = 30_000;

function isValidApp(a: unknown): a is DiscoveryApp {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.displayName === 'string' &&
    typeof o.url === 'string' &&
    (o.icon === null || typeof o.icon === 'string')
  );
}

/**
 * Fetches `${deckBase}/api/apps` on demand (the launcher calls `refresh` when
 * its popover opens) and caches the last good list for CACHE_MS, keyed by
 * `deckBase` so a base change is never served the previous deck's cache. A
 * null base, a rejected fetch, a non-OK response, or a non-array payload all
 * resolve to an empty (or last-good) list, are never cached, and never
 * throw: an unreachable deck must not break the host app's header.
 */
export function useDiscoveryApps(deckBase: string | null) {
  const [state, setState] = useState<DiscoveryState>({
    apps: [],
    loaded: false,
  });
  const cache = useRef<{ base: string; at: number } | null>(null);
  const reqId = useRef(0);

  const refresh = useCallback(async () => {
    // Bump on every entry, including early returns: a cache-hit or
    // null-base call must still invalidate any older pending request.
    const myReq = ++reqId.current;
    if (!deckBase) {
      setState({ apps: [], loaded: true });
      return;
    }
    if (
      cache.current &&
      cache.current.base === deckBase &&
      Date.now() - cache.current.at < CACHE_MS
    )
      return;
    try {
      const res = await fetch(`${deckBase}/api/apps`);
      if (myReq !== reqId.current) return;
      if (!res.ok) {
        setState({ apps: [], loaded: true });
        return;
      }
      const data = (await res.json()) as DiscoveryResponse;
      if (myReq !== reqId.current) return;
      if (!Array.isArray(data?.apps)) {
        setState({ apps: [], loaded: true });
        return;
      }
      const apps = data.apps.filter(isValidApp);
      cache.current = { base: deckBase, at: Date.now() };
      setState({ apps, loaded: true });
    } catch {
      if (myReq !== reqId.current) return;
      setState(prev => ({ apps: prev.apps, loaded: true }));
    }
  }, [deckBase]);

  return { ...state, refresh };
}
