#!/usr/bin/env bun
/**
 * The io parameter on the transports: absent means one attempt and no signal
 * (frozen legacy behavior); { retry: true } retries transient faults; a signal
 * reaches fetch and cancels between attempts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Hit = { status?: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(hits: Hit[]): { count: () => number; signals: (AbortSignal | null | undefined)[] } {
  const signals: (AbortSignal | null | undefined)[] = [];
  let n = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const hit = hits[Math.min(n, hits.length - 1)];
    n += 1;
    signals.push(init?.signal);
    return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status ?? 200, headers: hit.headers });
  }) as typeof fetch;
  return { count: () => n, signals };
}

const p = () => new GitLabProvider('https://gitlab.example', 't');

describe('restRequest io', () => {
  test('without io a 503 is returned once, not retried, with no signal', async () => {
    const s = stubFetch([{ status: 503 }]);
    const res = await p().restRequest('GET', '/projects/1');
    expect(res.status).toBe(503);
    expect(s.count()).toBe(1);
    expect(s.signals[0] ?? null).toBeNull();
  });

  test('with retry a 503 is retried and the success returned', async () => {
    const s = stubFetch([{ status: 503, headers: { 'retry-after': '0' } }, { status: 200, body: { id: 1 } }]);
    const res = await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true });
    expect(res.status).toBe(200);
    expect(s.count()).toBe(2);
  });

  test('with retry a 404 comes back on the first attempt', async () => {
    const s = stubFetch([{ status: 404 }]);
    const res = await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true });
    expect(res.status).toBe(404);
    expect(s.count()).toBe(1);
  });

  test('a pre-aborted signal rejects without any fetch', async () => {
    const s = stubFetch([{ status: 200 }]);
    const caller = new AbortController();
    caller.abort();
    await expect(
      p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true, signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });

  test('the attempt signal reaches fetch when io carries one', async () => {
    const s = stubFetch([{ status: 200 }]);
    const caller = new AbortController();
    await p().restRequest('GET', '/projects/1', undefined, 'op', { retry: true, signal: caller.signal });
    expect(s.signals[0]).toBeDefined();
  });
});

describe('runQuery io (via fetchGroupProjects wiring in Task 3, exercised here through a raw GraphQL call path)', () => {
  test('without io a GraphQL 502 throws once', async () => {
    const s = stubFetch([{ status: 502 }]);
    await expect(
      (p() as unknown as { runQuery: (op: string, q: string) => Promise<unknown> }).runQuery('op', 'query {}'),
    ).rejects.toThrow('502');
    expect(s.count()).toBe(1);
  });

  test('with retry a GraphQL 502 then 200 succeeds', async () => {
    const s = stubFetch([
      { status: 502, headers: { 'retry-after': '0' } },
      { status: 200, body: { data: { ok: true } } },
    ]);
    const out = await (
      p() as unknown as { runQuery: (op: string, q: string, v?: unknown, io?: unknown) => Promise<unknown> }
    ).runQuery('op', 'query {}', undefined, { retry: true });
    expect(out).toEqual({ ok: true });
    expect(s.count()).toBe(2);
  });
});
