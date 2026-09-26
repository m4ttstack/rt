import { useCallback, useState } from 'react';
import { useInterval } from 'react-interval-hook';

interface DaemonHealthState {
  reachable: boolean;
  downSince?: number;
  probeCount: number;
  lastAnsweredAt?: number;
}

/**
 * Polls `GET /api/daemon` every 5s and tracks what the banner needs beyond
 * the bare boolean: how long the outage has run and how many probes it has
 * seen, neither of which the server tracks across requests. `seed` is a
 * one-time starting value read once, never watched, so a test never needs a
 * live poll.
 */
export function useDaemonHealth(seed?: boolean) {
  const [state, setState] = useState<DaemonHealthState>(() => {
    const now = Date.now();
    if (seed === false)
      return { reachable: false, downSince: now, probeCount: 1 };
    return {
      reachable: true,
      probeCount: 0,
      lastAnsweredAt: seed === true ? now : undefined,
    };
  });

  const probe = useCallback(async () => {
    let reachable = false;
    try {
      const res = await fetch('/api/daemon');
      const data = (await res.json()) as { reachable: boolean };
      reachable = data.reachable;
    } catch {
      reachable = false;
    }
    const now = Date.now();
    setState(prev => {
      if (reachable)
        return { reachable: true, probeCount: 0, lastAnsweredAt: now };
      return {
        reachable: false,
        downSince: prev.reachable ? now : (prev.downSince ?? now),
        probeCount: prev.reachable ? 1 : prev.probeCount + 1,
        lastAnsweredAt: prev.lastAnsweredAt,
      };
    });
  }, []);

  useInterval(probe, 5000);

  return { ...state, probeNow: probe };
}
