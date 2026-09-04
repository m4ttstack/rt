import type { GateRow } from '@mattstack/rt-client';
import { useQuery } from '@tanstack/react-query';

import { client } from '../api';

/** Every open/parked/answered gate whose subject is `run:<id>` -- the
    daemon's own gate registry, filtered server-side to the `run:` prefix
    (see `src/server/gates.ts`). The websocket (`useRunEvents`) is what keeps
    this live; no separate poll here. */
export function useGates() {
  return useQuery({
    queryKey: ['gates'],
    queryFn: async () => {
      const res = await client.api.gates.$get();
      if (!res.ok) throw new Error(`gates list failed: ${res.status}`);
      return res.json();
    },
  });
}

/** True the instant a run has a gate actually waiting on someone -- `parked`
    deliberately does not count here (a pane stepped away from it, it is no
    longer blocking the row the way an `open` one is). Used by RunRow's
    trailing badge slot. */
export function hasOpenGate(
  gates: GateRow[] | undefined,
  runId: string
): boolean {
  const subject = `run:${runId}`;
  return (
    gates?.some(g => g.subject === subject && g.status === 'open') ?? false
  );
}

/**
 * The one gate RunDetail's card should render for this run, or `undefined`
 * when nothing belongs there. `open`/`parked` are always actionable and win
 * outright. Failing that, an `answered` gate still renders as a read-only
 * summary as long as the run itself is still `running` -- the run's own
 * liveness is the scoping window, not a time-based one, so a re-opened gate
 * on the same run never gets stuck behind a stale answered one and an
 * answered gate on a run that has since finished quietly stops rendering.
 * Multiple non-open/parked rows can exist for one run (a consumed gate is
 * terminal; re-asking opens a new one) -- the most recently opened one is
 * the one that matters.
 */
export function activeGateForRun(
  gates: GateRow[] | undefined,
  run: { id: string; status: string }
): GateRow | undefined {
  if (!gates) return undefined;
  const subject = `run:${run.id}`;
  const matches = gates.filter(g => g.subject === subject);

  const openOrParked = matches.find(
    g => g.status === 'open' || g.status === 'parked'
  );
  if (openOrParked) return openOrParked;

  if (run.status !== 'running') return undefined;
  return matches
    .filter(g => g.status === 'answered')
    .sort((a, b) => b.openedAt - a.openedAt)[0];
}
