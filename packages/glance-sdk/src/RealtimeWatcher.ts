/**
 * RealtimeWatcher — generic self-healing subscription + polling module.
 *
 * Combines a push subscription (WebSocket / SSE / any transport) with an
 * adaptive polling safety net. Implements the production-standard patterns
 * used by Socket.IO, Ably, Pusher, and AWS SDK:
 *
 *  • Adaptive poll rate — fast when push is down, slow when push is healthy
 *  • Full-jitter exponential backoff on repeated fetch failures
 *    (AWS Architecture Blog: "Exponential Backoff and Jitter")
 *  • Push-event debouncing — burst events collapsed into one refetch
 *  • Immediate refetch on push reconnect — catches events missed during outage
 *  • Clean disposal — all timers and subscriptions cleaned up on dispose()
 *
 * Usage:
 *   const dispose = createRealtimeWatcher({ subscribe, fetch, onUpdate });
 *   dispose(); // cleans up everything
 *
 * The subscribe callback is transport-agnostic: it receives three callbacks
 * ({ onConnected, onDisconnected, onEvent }) and must return a dispose function.
 * Wire any push mechanism — ActionCable, SSE, socket — into those callbacks.
 */

import { type ForgeLogger, noopLogger } from './logger.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Callbacks supplied to the `subscribe` function. The caller wires these into
 * whatever push transport they are using (ActionCable, SSE, etc.).
 */
export interface WatcherSubscribeCallbacks {
  /** Call when the push connection is established (or re-established). */
  onConnected: () => void;
  /** Call when the push connection is lost. */
  onDisconnected: () => void;
  /** Call when the server pushes a data event. */
  onEvent: () => void;
}

/** Connection + health status exposed to consumers. */
export interface WatcherStatus {
  /** WebSocket / push connection state. */
  connection: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  /** Number of consecutive fetch failures (0 = healthy). */
  consecutiveErrors: number;
  /** Last error encountered, if any. Cleared on successful fetch. */
  lastError?: Error;
}

export interface RealtimeWatcherOptions {
  /**
   * Poll interval while the push subscription is connected (safety net).
   * Default: 30_000 ms.
   */
  pollIntervalMs?: number;
  /**
   * Poll interval while the push subscription is disconnected.
   * Should be shorter than `pollIntervalMs` to compensate for missing push events.
   * Default: 10_000 ms.
   */
  pollIntervalWsDownMs?: number;
  logger?: ForgeLogger;
  logContext?: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Creates a self-healing realtime watcher.
 *
 * @param subscribe  Wires the push subscription. Receives `{ onConnected,
 *   onDisconnected, onEvent }` and must return a dispose function.
 * @param fetch      Returns the latest snapshot, or `null` if unavailable.
 *   Called on push events, poll ticks, and push reconnects.
 * @param onUpdate   Called with each successful fetch result.
 * @param options    Optional tuning for poll intervals and logging.
 * @returns          dispose() — cancels all subscriptions, timers, and
 *   in-flight fetches. Safe to call multiple times.
 */
export function createRealtimeWatcher<T>(params: {
  subscribe: (callbacks: WatcherSubscribeCallbacks) => () => void;
  fetch: () => Promise<T | null>;
  onUpdate: (data: T) => void;
  onStatusChange?: (status: WatcherStatus) => void;
  options?: RealtimeWatcherOptions;
}): () => void {
  const { subscribe, fetch: doFetch, onUpdate, onStatusChange, options = {} } = params;
  const log = options.logger ?? noopLogger;
  const ctx = options.logContext ?? 'RealtimeWatcher';

  const POLL_WS_UP = options.pollIntervalMs ?? 30_000;
  const POLL_WS_DOWN = options.pollIntervalWsDownMs ?? 10_000;

  // Exponential backoff constants (AWS "Full Jitter" pattern).
  const BACKOFF_BASE = 2_000;
  const BACKOFF_MAX = 60_000;

  let disposed = false;
  let wsConnected = false;
  let pollFailures = 0;
  let lastError: Error | undefined;

  // ── Status emission ─────────────────────────────────────────────────────────
  const emitStatus = (): void => {
    if (disposed || !onStatusChange) return;
    onStatusChange({
      connection: wsConnected
        ? 'connected'
        : pollFailures > 0
          ? 'reconnecting'
          : 'connecting',
      consecutiveErrors: pollFailures,
      lastError,
    });
  };

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposeSub: (() => void) | null = null;

  const clearPoll = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  // ── Core fetch ─────────────────────────────────────────────────────────────
  const runFetch = async (reason: string): Promise<void> => {
    if (disposed) return;
    try {
      const result = await doFetch();
      if (!disposed && result !== null) {
        const hadErrors = pollFailures > 0;
        pollFailures = 0; // reset backoff streak on success
        lastError = undefined;
        onUpdate(result);
        if (hadErrors) emitStatus(); // notify recovery
      }
    } catch (err) {
      pollFailures++;
      lastError = err instanceof Error ? err : new Error(String(err));
      log.warn(`${ctx}: fetch failed`, {
        reason,
        consecutiveFailures: pollFailures,
        error: lastError.message
      });
      emitStatus();
    }
  };

  // ── Adaptive poll scheduler ─────────────────────────────────────────────────
  // Uses setTimeout (not setInterval) so each tick recalculates its own delay
  // based on current connection state and failure count.
  const schedulePoll = (): void => {
    clearPoll();
    if (disposed) return;

    let delay: number;

    if (pollFailures > 0) {
      // Full-jitter exponential backoff — proven to distribute retry load optimally
      // across many concurrent clients (AWS Architecture Blog, 2015).
      // delay = random(0, min(base × 2ⁿ, cap))
      const cap = Math.min(
        BACKOFF_BASE * Math.pow(2, pollFailures - 1),
        BACKOFF_MAX
      );
      delay = Math.random() * cap;
    } else {
      // ±10% jitter on healthy polls prevents lock-step across many instances
      // even when connection state is identical.
      const base = wsConnected ? POLL_WS_UP : POLL_WS_DOWN;
      const jitter = base * 0.1 * (Math.random() * 2 - 1);
      delay = base + jitter;
    }

    log.debug(`${ctx}: next poll in ${Math.round(delay)}ms`, {
      wsConnected,
      pollFailures
    });

    pollTimer = setTimeout(async () => {
      await runFetch(wsConnected ? 'poll:safetynet' : 'poll:wsdown');
      schedulePoll(); // reschedule after each tick for dynamic interval recalculation
    }, delay);
  };

  // ── Push-event debounce ────────────────────────────────────────────────────
  // GitLab (and other providers) may emit multiple subscription events in rapid
  // succession (e.g. approval + merge-status firing within milliseconds).
  // Collapse them into one refetch 150ms after the last event.
  const onEvent = (): void => {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runFetch('push:event');
    }, 150);
  };

  // ── Push connection callbacks ──────────────────────────────────────────────
  const onConnected = (): void => {
    wsConnected = true;
    // Immediately refetch to catch any events missed during the outage window.
    void runFetch('push:reconnect');
    // Switch poll back to slow/healthy rate.
    schedulePoll();
    emitStatus();
    log.debug(`${ctx}: push connected`);
  };

  const onDisconnected = (): void => {
    wsConnected = false;
    // Switch poll to fast rate to compensate for lost push events.
    schedulePoll();
    emitStatus();
    log.warn(`${ctx}: push disconnected — fast-poll activated`, {
      pollIntervalWsDownMs: POLL_WS_DOWN
    });
  };

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  void (async () => {
    // Emit the initial snapshot immediately before wiring the subscription.
    await runFetch('init');
    if (disposed) return;

    // Start safety-net polling immediately (before push connects).
    schedulePoll();

    // Wire the push subscription.
    disposeSub = subscribe({ onConnected, onDisconnected, onEvent });
  })();

  // ── Dispose ────────────────────────────────────────────────────────────────
  return () => {
    if (disposed) return;
    disposed = true;
    clearPoll();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    disposeSub?.();
    log.debug(`${ctx}: disposed`);
  };
}
