import { useCallback, useRef, useState } from 'react';

import type { DiscoveryApp, DiscoveryResponse } from './deck-discovery';

interface DiscoveryState {
  apps: DiscoveryApp[];
  loaded: boolean;
}

const CACHE_MS = 30_000;

/**
 * Fetches `${deckBase}/api/apps` on demand (the launcher calls `refresh` when
 * its popover opens) and caches the last good list for CACHE_MS so rapid
 * reopens do not refetch. A null base, a rejected fetch, or a non-array
 * payload all resolve to an empty (or last-good) list and never throw: an
 * unreachable deck must not break the host app's header.
 */
export function useDiscoveryApps(deckBase: string | null) {
  const [state, setState] = useState<DiscoveryState>({
    apps: [],
    loaded: false,
  });
  const fetchedAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!deckBase) {
      setState({ apps: [], loaded: true });
      return;
    }
    if (fetchedAt.current && Date.now() - fetchedAt.current < CACHE_MS) return;
    try {
      const res = await fetch(`${deckBase}/api/apps`);
      const data = (await res.json()) as DiscoveryResponse;
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      fetchedAt.current = Date.now();
      setState({ apps, loaded: true });
    } catch {
      setState(prev => ({ apps: prev.apps, loaded: true }));
    }
  }, [deckBase]);

  return { ...state, refresh };
}
