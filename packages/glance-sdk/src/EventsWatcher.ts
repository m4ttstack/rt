/**
 * EventsWatcher: the loop around EventsPoller.
 *
 * A setTimeout chain (never setInterval, so ticks cannot overlap) with
 * ±10% jitter per tick. On tick failure the cursor freezes, the loop backs
 * off exponentially (interval * 2^failures, capped at 5 minutes, or the
 * server's Retry-After when a 429 exposes one), and onStatus reports the
 * degraded/live transitions. The next successful tick catches up from the
 * frozen cursor, so nothing is lost during an outage.
 */
import type { InvalidationBatch, WatchEventsOptions, WatchEventsStatus } from './types.ts';
import { EventsPoller, type FetchEvents } from './EventsPoller.ts';

const MAX_BACKOFF_MS = 5 * 60_000;

/** Duck-typed error classification. GitbeakerRequestError carries
 *  `cause.response`; GitbeakerRetryError mentions the last status code in
 *  its message; anything without an HTTP shape is a network problem. */
function classifyError(err: unknown): NonNullable<WatchEventsStatus['cause']> {
  const status: unknown = (err as any)?.cause?.response?.status;
  if (status === 429) return 'rate-limited';
  if (typeof status === 'number') return 'http-error';
  const message = err instanceof Error ? err.message : '';
  if (/\b429\b/.test(message)) return 'rate-limited';
  if (/status code: \d{3}/.test(message)) return 'http-error';
  return 'network';
}

/** Seconds from a Retry-After header when the error exposes one. */
function retryAfterMs(err: unknown): number | null {
  const headers: unknown = (err as any)?.cause?.response?.headers;
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  if (typeof get !== 'function') return null;
  const raw = get.call(headers, 'retry-after');
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function startEventsWatcher(
  fetchEvents: FetchEvents,
  options: WatchEventsOptions,
  onInvalidations: (batch: InvalidationBatch) => void,
): () => void {
  const intervalMs = options.intervalMs ?? 15_000;
  const poller = new EventsPoller({
    fetchEvents,
    cursor: options.cursor,
    perPage: options.perPage,
    maxPagesPerTick: options.maxPagesPerTick,
  });

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let lastSyncedAt: string | null = null;

  const jittered = (ms: number) => ms * (0.9 + Math.random() * 0.2);

  function schedule(delayMs: number): void {
    if (disposed) return;
    timer = setTimeout(run, jittered(delayMs));
  }

  async function run(): Promise<void> {
    if (disposed) return;
    try {
      const before = poller.getCursor().lastEventId;
      const result = await poller.tick();
      lastSyncedAt = new Date().toISOString();

      if (consecutiveFailures > 0) {
        consecutiveFailures = 0;
        options.onStatus?.({ state: 'live', lastSyncedAt });
      }
      if (result.cursor.lastEventId !== before) {
        options.onCursor?.(result.cursor);
      }
      if (result.invalidations.length > 0) {
        onInvalidations({
          invalidations: result.invalidations,
          syncedAt: lastSyncedAt,
          cursor: result.cursor,
        });
      }
      schedule(intervalMs);
    } catch (err) {
      consecutiveFailures++;
      const backoff = Math.min(intervalMs * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
      const delay = retryAfterMs(err) ?? backoff;
      options.onStatus?.({
        state: 'degraded',
        cause: classifyError(err),
        lastSyncedAt,
        nextRetryAt: new Date(Date.now() + delay).toISOString(),
      });
      schedule(delay);
    }
  }

  // First tick soon after start; jitter still applies through schedule().
  schedule(1);

  return function dispose(): void {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
