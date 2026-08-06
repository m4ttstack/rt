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
import type { EventCursor, InvalidationBatch, WatchEventsOptions, WatchEventsStatus } from './types.ts';
import { EventsPoller, type FetchEvents } from './EventsPoller.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';

const MAX_BACKOFF_MS = 5 * 60_000;

/** Provider-agnostic tick outcome the shared loop consumes. */
export interface LoopTick {
  batch: InvalidationBatch | null; // null = nothing to deliver (cold start or no fresh events)
  cursor: EventCursor; // always delivered to onCursor when changed
  /** When set, overrides options.intervalMs for the NEXT wait (server-directed cadence). */
  nextIntervalMs?: number;
}

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

/**
 * Milliseconds from a Retry-After header when the error exposes one, capped
 * at MAX_BACKOFF_MS -- an unbounded server-supplied value must not be able
 * to stall the loop far past our own backoff ceiling.
 *
 * Honesty note: in production this path rarely fires. A 429 from a
 * gitbeaker-based provider surfaces as GitbeakerRetryError, which does not
 * carry the original response/headers, so `err.cause.response.headers` is
 * absent and this returns null (falling back to exponential backoff). This
 * function only matters for callers that inject `fetchEvents` via direct
 * `fetch()` and construct a duck-typed error exposing real headers.
 */
function retryAfterMs(err: unknown): number | null {
  const headers: unknown = (err as any)?.cause?.response?.headers;
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  if (typeof get !== 'function') return null;
  const raw = get.call(headers, 'retry-after');
  const seconds = raw ? Number(raw) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_BACKOFF_MS);
}

export function startEventsWatcher(
  fetchEvents: FetchEvents,
  options: WatchEventsOptions,
  onInvalidations: (batch: InvalidationBatch) => void,
  logger: ForgeLogger = noopLogger,
): () => void {
  const poller = new EventsPoller({
    fetchEvents,
    cursor: options.cursor,
    perPage: options.perPage,
    maxPagesPerTick: options.maxPagesPerTick,
  });

  return startWatcherLoop(
    async (): Promise<LoopTick> => {
      const result = await poller.tick();
      const batch: InvalidationBatch | null =
        result.invalidations.length > 0 && !result.coldStart
          ? {
              invalidations: result.invalidations,
              syncedAt: new Date().toISOString(),
              cursor: result.cursor,
            }
          : null;
      // GitLab has no server-directed cadence: never overrides intervalMs.
      return { batch, cursor: result.cursor };
    },
    options,
    onInvalidations,
    logger,
  );
}

/**
 * Provider-agnostic watcher loop. A setTimeout chain (never setInterval, so
 * ticks cannot overlap) with ±10% jitter per tick. On tick failure the loop
 * backs off exponentially (interval * 2^failures, capped at MAX_BACKOFF_MS,
 * or the server's Retry-After when a 429 exposes one), and onStatus reports
 * the degraded/live transitions. `tick` reports its own outcome (a batch to
 * deliver or not, the current cursor, and an optional server-directed
 * override for the next wait) rather than throwing on ordinary "nothing
 * fresh" ticks -- only a genuine failure to reach the provider should throw.
 */
export function startWatcherLoop(
  tick: () => Promise<LoopTick>,
  options: WatchEventsOptions,
  onInvalidations: (batch: InvalidationBatch) => void,
  logger: ForgeLogger = noopLogger,
): () => void {
  const intervalMs = options.intervalMs ?? 15_000;

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let lastSyncedAt: string | null = null;
  let lastCursor: EventCursor = options.cursor ?? { since: null, lastEventId: null };

  const jittered = (ms: number) => ms * (0.9 + Math.random() * 0.2);

  function schedule(delayMs: number): void {
    if (disposed) return;
    timer = setTimeout(run, jittered(delayMs));
  }

  /** Runs a consumer callback in isolation: a throw is logged and swallowed,
   *  never allowed to be misread as a fetch failure or crash the loop. */
  function safeInvoke(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('watchEvents: consumer callback threw', { message });
    }
  }

  async function run(): Promise<void> {
    if (disposed) return;
    const before = lastCursor;

    let result: LoopTick;
    try {
      result = await tick();
    } catch (err) {
      if (disposed) return;
      consecutiveFailures++;
      const backoff = Math.min(intervalMs * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
      const delay = retryAfterMs(err) ?? backoff;
      const nextRetryAt = new Date(Date.now() + delay).toISOString();
      schedule(delay);
      safeInvoke(() =>
        options.onStatus?.({
          state: 'degraded',
          cause: classifyError(err),
          lastSyncedAt,
          nextRetryAt,
        }),
      );
      return;
    }

    if (disposed) return;

    lastSyncedAt = new Date().toISOString();
    const wasDegraded = consecutiveFailures > 0;
    consecutiveFailures = 0;
    schedule(result.nextIntervalMs ?? intervalMs);

    if (wasDegraded) {
      const syncedAt = lastSyncedAt;
      safeInvoke(() => options.onStatus?.({ state: 'live', lastSyncedAt: syncedAt }));
    }
    // A consumer callback can call dispose() from inside itself (e.g. to
    // tear down on the first successful sync). Re-check after every
    // success-path callback so a reentrant dispose stops the rest of this
    // tick's deliveries, matching the in-flight-tick dispose behavior above.
    if (disposed) return;
    // Compare both fields: an empty cold tick only moves `since` (it plants
    // a time anchor without a lastEventId), and callers still need that
    // persisted via onCursor.
    if (result.cursor.lastEventId !== before.lastEventId || result.cursor.since !== before.since) {
      lastCursor = result.cursor;
      safeInvoke(() => options.onCursor?.(result.cursor));
    }
    if (disposed) return;
    if (result.batch) {
      const batch = result.batch;
      safeInvoke(() => onInvalidations(batch));
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
