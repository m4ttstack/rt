import type { RunSummary } from '@mattstack/rt-client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Board rows warn once the floor is close enough to matter -- the spec's
    own example is "ages out in 2 days". */
export const AGING_WARNING_THRESHOLD_DAYS = 3;

/**
 * Days remaining before rt's own pruner (`lib/runs/prune.ts` in repo-tools)
 * would remove this run. That pruner ages a finished run from `ended_at`
 * and a still-running one from its run-dir mtime, which client-side has no
 * counterpart except `last_event_at` -- the same "last write" moment, so it
 * is the anchor used here for a running run.
 */
export function daysUntilPrune(
  run: Pick<RunSummary, 'ended_at' | 'last_event_at'>,
  pruneDays: number,
  now: number = Date.now()
): number {
  const anchor = run.ended_at ?? run.last_event_at;
  return Math.ceil((anchor + pruneDays * DAY_MS - now) / DAY_MS);
}

/** Null once a run is either safely far from the floor or already past it
    -- a run at or below zero days is rt's to prune, not this console's to
    keep announcing. */
export function agingWarning(
  run: Pick<RunSummary, 'ended_at' | 'last_event_at'>,
  pruneDays: number | undefined,
  now: number = Date.now()
): string | null {
  if (pruneDays == null) return null;
  const days = daysUntilPrune(run, pruneDays, now);
  if (days <= 0 || days > AGING_WARNING_THRESHOLD_DAYS) return null;
  return `ages out in ${days} day${days === 1 ? '' : 's'}`;
}
