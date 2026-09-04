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
 * Every gate RunDetail's page should render for this run, most recently
 * opened first. Supersede only fires within the same (subject, kind) --
 * different-kind gates (a `clarify` alongside a `self-review`, say) can be
 * open on one run at once, so this is a list, not a pick-one: every
 * `open`/`parked` gate is always actionable and included, and an `answered`
 * one is included too as long as the run itself is still `running` -- the
 * run's own liveness is the scoping window, not a time-based one, so a
 * re-opened gate on the same (subject, kind) never gets stuck behind a
 * stale answered one, and an answered gate on a run that has since finished
 * quietly stops rendering.
 */
export function activeGatesForRun(
  gates: GateRow[] | undefined,
  runId: string,
  runStatus: string
): GateRow[] {
  if (!gates) return [];
  const subject = `run:${runId}`;
  return gates
    .filter(
      g =>
        g.subject === subject &&
        (g.status === 'open' ||
          g.status === 'parked' ||
          (g.status === 'answered' && runStatus === 'running'))
    )
    .sort((a, b) => b.openedAt - a.openedAt);
}
