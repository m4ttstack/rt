import { afterEach, describe, expect, it, vi } from "vitest";

import { linearRequest } from "../src/server/linear/client.js";
import { RetryableError, asRetryable, isTransientStatus, retryAfterMs, withRetry } from "../src/server/util/http.js";

afterEach(() => vi.unstubAllGlobals());

/** A run body that only ever settles when its attempt signal fires, exactly as fetch would. */
async function stallUntilAborted(signal: AbortSignal, callerSignal?: AbortSignal): Promise<never> {
  try {
    await new Promise((_resolve, reject) => {
      // Already-aborted signals emit no event, so check before subscribing.
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  } catch (err) {
    throw asRetryable(err, callerSignal);
  }
  throw new Error("unreachable");
}

describe("withRetry", () => {
  // The bug this exists for: one MR-detail request stalled with nothing below the
  // 10-minute job abort able to end it, freezing the whole refresh at 133/134.
  it("ends an attempt that never settles and retries it on a fresh deadline", async () => {
    const signals: AbortSignal[] = [];
    let attempts = 0;

    const out = await withRetry(async (signal) => {
      signals.push(signal);
      attempts += 1;
      if (attempts === 1) await stallUntilAborted(signal);
      return "ok";
    }, { timeoutMs: 40, attempts: 2 });

    expect(out).toBe("ok");
    expect(attempts).toBe(2);
    // Each attempt gets its own deadline; reusing the first would abort the retry instantly.
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("does not retry caller cancellation ... an aborted job means stop", async () => {
    const caller = new AbortController();
    let attempts = 0;

    const p = withRetry(async (signal) => {
      attempts += 1;
      caller.abort();
      await stallUntilAborted(signal, caller.signal);
    }, { signal: caller.signal, timeoutMs: 5_000, attempts: 3 });

    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(attempts).toBe(1);
  });

  it("surfaces the underlying error once attempts run out", async () => {
    let attempts = 0;

    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new RetryableError(new Error("socket hang up"));
      }, { attempts: 2, timeoutMs: 100 }),
    ).rejects.toThrow("socket hang up");

    expect(attempts).toBe(2);
  });
});

describe("transient classification", () => {
  it("treats rate limits and server faults as retryable, client errors as final", () => {
    expect([429, 408, 500, 502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([200, 400, 401, 403, 404, 422].some(isTransientStatus)).toBe(false);
  });

  it("reads Retry-After in seconds, and ignores a missing or unparseable one", () => {
    const withHeader = (v: string) => new Response("", { status: 429, headers: { "retry-after": v } });
    expect(retryAfterMs(withHeader("2"))).toBe(2_000);
    expect(retryAfterMs(withHeader("garbage"))).toBeUndefined();
    expect(retryAfterMs(new Response("", { status: 429 }))).toBeUndefined();
  });
});

describe("GraphQL transport (Linear)", () => {
  it("retries a dropped connection and succeeds on the next attempt", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    });

    await expect(linearRequest("key", "query { ok }", {})).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not retry a query error ... a bad field is bad on every attempt", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ errors: [{ message: "no field x" }] }), { status: 200 });
    });

    await expect(linearRequest("key", "query { x }", {})).rejects.toThrow(/no field x/);
    expect(calls).toBe(1);
  });

  it("retries a transient 502 and returns the retry's body", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return calls === 1
        ? new Response("bad gateway", { status: 502 })
        : new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    });

    await expect(linearRequest("key", "query { ok }", {})).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not retry a 404 ... a missing resource stays missing", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls += 1; return new Response("nope", { status: 404 }); });

    await expect(linearRequest("key", "query { ok }", {})).rejects.toThrow(/Linear HTTP 404/);
    expect(calls).toBe(1);
  });
});
