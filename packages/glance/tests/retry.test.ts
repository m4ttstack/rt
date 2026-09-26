#!/usr/bin/env bun
/**
 * withRetry: per-attempt deadlines and bounded retry. Ported from boxscore's
 * server/util/http.ts test suite; the semantics are the SP4 contract.
 */
import { describe, expect, test } from 'bun:test';
import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from '../src/retry.ts';

async function stallUntilAborted(signal: AbortSignal, callerSignal?: AbortSignal): Promise<never> {
  try {
    await new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } catch (err) {
    throw asRetryable(err, callerSignal);
  }
  throw new Error('unreachable');
}

describe('withRetry', () => {
  test('ends an attempt that never settles and retries it on a fresh deadline', async () => {
    const signals: AbortSignal[] = [];
    let attempts = 0;
    const out = await withRetry(async (signal) => {
      signals.push(signal);
      attempts += 1;
      if (attempts === 1) await stallUntilAborted(signal);
      return 'ok';
    }, { timeoutMs: 40, attempts: 2 });
    expect(out).toBe('ok');
    expect(attempts).toBe(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  test('does not retry caller cancellation', async () => {
    const caller = new AbortController();
    let attempts = 0;
    const p = withRetry(async (signal) => {
      attempts += 1;
      caller.abort();
      await stallUntilAborted(signal, caller.signal);
    }, { signal: caller.signal, timeoutMs: 5_000, attempts: 3 });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  test('a pre-aborted signal rejects before the first attempt runs', async () => {
    const caller = new AbortController();
    caller.abort();
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      return 'never';
    }, { signal: caller.signal });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(0);
  });

  test('a non-retryable rejection propagates untouched on the first attempt', async () => {
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      throw new Error('plain failure');
    }, { attempts: 3 });
    await expect(p).rejects.toThrow('plain failure');
    expect(attempts).toBe(1);
  });

  test('exhausted attempts throw the underlying reason, not the wrapper', async () => {
    let attempts = 0;
    const p = withRetry(async () => {
      attempts += 1;
      throw new RetryableError(new Error('socket dropped'), 0);
    }, { attempts: 2 });
    await expect(p).rejects.toThrow('socket dropped');
    expect(attempts).toBe(2);
  });

  test('honors a RetryableError retryAfterMs of zero without a backoff sleep', async () => {
    let attempts = 0;
    const started = performance.now();
    const out = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new RetryableError(new Error('429'), 0);
      return 'ok';
    }, { attempts: 3 });
    expect(out).toBe('ok');
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('classification', () => {
  test('transient statuses are 408, 429, and 5xx', () => {
    for (const s of [408, 429, 500, 502, 503, 599]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 301, 400, 401, 403, 404, 422]) expect(isTransientStatus(s)).toBe(false);
  });

  test('retryAfterMs reads seconds, an HTTP date, and clamps to 30s', () => {
    const res = (retryAfter?: string) =>
      new Response('', retryAfter === undefined ? {} : { headers: { 'retry-after': retryAfter } });
    expect(retryAfterMs(res())).toBeUndefined();
    expect(retryAfterMs(res('2'))).toBe(2_000);
    expect(retryAfterMs(res('120'))).toBe(30_000);
    const at = retryAfterMs(res(new Date(Date.now() + 5_000).toUTCString()));
    expect(at).toBeGreaterThan(3_000);
    expect(at).toBeLessThanOrEqual(30_000);
    expect(retryAfterMs(res('soon'))).toBeUndefined();
  });

  test('asRetryable passes caller aborts through and wraps everything else', () => {
    const caller = new AbortController();
    caller.abort();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(asRetryable(abortErr)).toBe(abortErr);
    expect(asRetryable(new Error('x'), caller.signal)).toBeInstanceOf(Error);
    expect(asRetryable(new Error('x'), caller.signal)).not.toBeInstanceOf(RetryableError);
    expect(asRetryable(new Error('boom'))).toBeInstanceOf(RetryableError);
  });
});
