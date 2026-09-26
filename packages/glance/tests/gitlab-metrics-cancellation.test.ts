#!/usr/bin/env bun
/**
 * The six metric reads: a signal cancels the walk, transient faults retry,
 * and non-transient failures do not.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Hit = { status?: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(hits: Hit[]): { count: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const hit = hits[Math.min(n, hits.length - 1)];
    n += 1;
    return new Response(JSON.stringify(hit.body ?? {}), { status: hit.status ?? 200, headers: hit.headers });
  }) as typeof fetch;
  return { count: () => n };
}

const p = () => new GitLabProvider('https://gitlab.example', 't');
const UA = '2026-08-01T00:00:00Z';

const indexPage = (hasNext: boolean, cursor: string | null) => ({
  data: {
    project: {
      mergeRequests: {
        pageInfo: { hasNextPage: hasNext, endCursor: cursor },
        nodes: [],
      },
    },
  },
});

describe('metric reads under io', () => {
  test('fetchMergeRequestIndex retries a 502 page and completes', async () => {
    const s = stubFetch([
      { status: 502, headers: { 'retry-after': '0' } },
      { status: 200, body: indexPage(false, null) },
    ]);
    const rows = await p().fetchMergeRequestIndex({ projectPaths: ['g/p'], updatedAfter: UA });
    expect(rows).toEqual([]);
    expect(s.count()).toBe(2);
  });

  test('a pre-aborted signal stops fetchMergeRequestIndex before any request', async () => {
    const s = stubFetch([{ status: 200, body: indexPage(false, null) }]);
    const caller = new AbortController();
    caller.abort();
    await expect(
      p().fetchMergeRequestIndex({ projectPaths: ['g/p'], updatedAfter: UA, signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });

  test('an abort between index pages stops the walk', async () => {
    const caller = new AbortController();
    const s = stubFetch([
      { status: 200, body: indexPage(true, 'c1') },
      { status: 200, body: indexPage(false, null) },
    ]);
    await expect(
      p().fetchMergeRequestIndex({
        projectPaths: ['g/p'],
        updatedAfter: UA,
        signal: caller.signal,
        onPage: () => caller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(1);
  });

  test('fetchProject passes the signal and still maps 404 to null on the first attempt', async () => {
    const s = stubFetch([{ status: 404 }]);
    const out = await p().fetchProject('g/p', { signal: new AbortController().signal });
    expect(out).toBeNull();
    expect(s.count()).toBe(1);
  });

  test('fetchGroupProjects retries a transient page fault', async () => {
    const s = stubFetch([
      { status: 503, headers: { 'retry-after': '0' } },
      {
        status: 200,
        body: { data: { group: { projects: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ fullPath: 'g/p' }] } } } },
      },
    ]);
    const out = await p().fetchGroupProjects('g');
    expect(out).toEqual(['g/p']);
    expect(s.count()).toBe(2);
  });

  test('fetchProjectPipelines retries a 429 and keeps its rows', async () => {
    const s = stubFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: [{ id: 9, status: 'SUCCESS', created_at: UA }] },
    ]);
    const out = await p().fetchProjectPipelines('g/p', { updatedAfter: UA, updatedBefore: UA });
    expect(out).toHaveLength(1);
    expect(s.count()).toBe(2);
  });

  test('fetchUserEvents does not retry a 400', async () => {
    const s = stubFetch([{ status: 400 }]);
    await expect(
      p().fetchUserEvents('gitlab:user:1', { action: 'pushed', after: '2026-01-01', before: '2026-02-01' }),
    ).rejects.toThrow('400');
    expect(s.count()).toBe(1);
  });

  test('fetchMergeRequestMetrics takes a signal in its new options bag', async () => {
    const caller = new AbortController();
    caller.abort();
    const s = stubFetch([{ status: 200, body: {} }]);
    await expect(
      p().fetchMergeRequestMetrics('g/p', 7, { signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.count()).toBe(0);
  });
});
