/**
 * Per-attempt deadline plus bounded retry for the provider transports; ported from boxscore,
 * which retires its wrapper in SP4.
 *
 * A refresh fans a few hundred requests at one host over pooled keep-alive sockets. Without
 * a deadline below the 10-minute job abort, one stalled socket froze the entire run at
 * N-1/N -- and when that abort finally fired it discarded every request that HAD completed.
 * Every attempt now carries its own deadline covering headers AND body read, and transport
 * stalls / transient server faults get another go. Caller cancellation never retries.
 */

/** Wraps an error worth another attempt. Anything else thrown by a runner is final. */
export class RetryableError extends Error {
  override readonly name = 'RetryableError';
  constructor(
    readonly reason: Error,
    /** Server-requested wait, when it sent a usable Retry-After. */
    readonly retryAfterMs?: number,
  ) {
    super(reason.message);
  }
}

export interface RetryOptions {
  /** Caller cancellation (the refresh job's abort). Never retried. */
  signal?: AbortSignal;
  /** Deadline for ONE attempt. Observed p50 for the heaviest query is under 2s. */
  timeoutMs?: number;
  /** Total attempts, including the first. */
  attempts?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 5_000;
/** Cap on an honored Retry-After, so a hostile header can't park the job for minutes. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Statuses worth another attempt: rate limits and transient server-side faults. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/** `Retry-After` as ms, or undefined when absent/unparseable. Accepts seconds or an HTTP date. */
export function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return clampWait(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : clampWait(at - Date.now());
}

/**
 * Classify a fetch or body-read rejection. Caller cancellation comes back as-is so it
 * propagates untouched; everything else (this attempt's deadline, a dropped socket)
 * becomes retryable. Callers `throw` the result, which keeps TypeScript's narrowing honest.
 */
export function asRetryable(err: unknown, callerSignal?: AbortSignal): Error {
  const e = err as Error;
  if (e?.name === 'AbortError' || callerSignal?.aborted) return e;
  return new RetryableError(e);
}

/**
 * Run one HTTP round-trip under a per-attempt deadline, retrying `RetryableError`s.
 *
 * `run` receives the signal it must hand to fetch: the caller's cancellation combined with
 * this attempt's deadline, so a response that stalls mid-body trips it too.
 */
export async function withRetry<T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, attempts = DEFAULT_ATTEMPTS } = opts;

  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      return await run(signal ? AbortSignal.any([signal, deadline]) : deadline);
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      if (attempt >= attempts) throw err.reason;
      await sleep(err.retryAfterMs ?? backoffMs(attempt), signal);
    }
  }
}

const clampWait = (ms: number): number => Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));

/** Exponential, half-jittered so a fanned-out burst doesn't resynchronize on the retry. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/** Sleep that gives up the moment the job is cancelled, rather than holding it open. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
