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
import { type ForgeLogger, noopLogger } from './logger.ts';

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
    const before = poller.getCursor();

    let result: Awaited<ReturnType<typeof poller.tick>>;
    try {
      result = await poller.tick();
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
    schedule(intervalMs);

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
      safeInvoke(() => options.onCursor?.(result.cursor));
    }
    if (disposed) return;
    if (result.invalidations.length > 0) {
      const syncedAt = lastSyncedAt;
      safeInvoke(() =>
        onInvalidations({
          invalidations: result.invalidations,
          syncedAt,
          cursor: result.cursor,
        }),
      );
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
