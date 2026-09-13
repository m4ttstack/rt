import { focusPane as realFocusPane } from './focus-pane.ts';

export interface DedupLane {
  status: string;
  tabId?: string;
  paneId?: string;
}

export type DedupOutcome =
  | { kind: 'focused' }
  | { kind: 'launch' }
  | { kind: 'refused'; reason: string };

export interface DedupDeps {
  focusPane: (lane: { paneId?: string; tabId?: string }) => Promise<unknown>;
}

/** The launch endpoints' in-flight dedup: a lane with a live pane re-focuses
    it instead of spawning a second one, a gone pane lets a launch start fresh.
    `focusOnly` is a focus click: it may focus or refuse, never launch. The
    reconciler may have told the row "running" while its pane is long gone,
    and a click meant to look at a pane must not quietly start a new run. */
export async function dedupInFlight(
  existing: DedupLane | undefined,
  inFlight: ReadonlySet<string>,
  focusOnly: boolean,
  deps: DedupDeps = { focusPane: realFocusPane }
): Promise<DedupOutcome> {
  if (!existing?.tabId || !inFlight.has(existing.status)) {
    return focusOnly
      ? { kind: 'refused', reason: 'nothing running to focus' }
      : { kind: 'launch' };
  }
  try {
    await deps.focusPane(existing);
    return { kind: 'focused' };
  } catch {
    return focusOnly
      ? { kind: 'refused', reason: 'pane is gone' }
      : { kind: 'launch' };
  }
}

export const REVIEW_IN_FLIGHT: ReadonlySet<string> = new Set([
  'queued',
  'reviewing',
]);
export const RESPOND_IN_FLIGHT: ReadonlySet<string> = new Set([
  'queued',
  'triaging',
  'implementing',
  'drafting',
]);
export const DOCTOR_IN_FLIGHT: ReadonlySet<string> = new Set([
  'queued',
  'diagnosing',
  'rebasing',
  'fixing',
  'watching',
]);
