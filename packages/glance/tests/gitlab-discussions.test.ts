#!/usr/bin/env bun
/**
 * GitLab discussions carry a real resolution state.
 *
 * `MRDetailFetcher` used to hardcode discussion-level `resolvable` and
 * `resolved` to null while mapping the per-note values correctly, so every
 * GitLab thread read as indeterminate. That is the same hardcoded-constant
 * shape as MAT-14 and MAT-27, and it meant the provider GitHub's behavior was
 * supposed to match reported nothing to match against.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { MRDetailFetcher } from '../src/MRDetailFetcher.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const AUTHOR = { id: 1, username: 'ada', name: 'Ada', avatar_url: null };

/** One GitLab REST note. `resolvable` undefined means a non-resolvable note. */
function note(
  id: number,
  resolvable?: boolean,
  resolved?: boolean
): Record<string, unknown> {
  return {
    id,
    type: resolvable ? 'DiffNote' : 'DiscussionNote',
    body: `note ${id}`,
    author: AUTHOR,
    created_at: '2026-08-01T00:00:00Z',
    system: false,
    resolvable,
    resolved
  };
}

/** A fetcher whose one REST call returns `discussions`. */
function fetcherWith(discussions: unknown[]): MRDetailFetcher {
  const fetcher = new MRDetailFetcher('https://gitlab.com', 'tok');
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(discussions), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
  return fetcher;
}

/**
 * A fetcher whose REST calls are answered per page, keyed by the `page`
 * query param, with the raw request URLs recorded in `urls`.
 */
function fetcherWithPages(
  pages: Record<string, { discussions: unknown[]; nextPage: string }>
): { fetcher: MRDetailFetcher; urls: string[] } {
  const fetcher = new MRDetailFetcher('https://gitlab.com', 'tok');
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    const page = new URL(url).searchParams.get('page') ?? '1';
    const entry = pages[page];
    if (!entry) throw new Error(`unexpected page ${page}`);
    return new Response(JSON.stringify(entry.discussions), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-next-page': entry.nextPage }
    });
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}

describe('MRDetailFetcher: discussion resolution state', () => {
  test('a fully resolved thread reports resolved: true', async () => {
    const f = fetcherWith([
      { id: 'd1', notes: [note(1, true, true), note(2, true, true)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(true);
  });

  test('one outstanding note keeps the thread unresolved', async () => {
    const f = fetcherWith([
      { id: 'd2', notes: [note(1, true, true), note(2, true, false)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(false);
  });

  test('a thread with no resolvable notes is not resolvable', async () => {
    // A plain comment thread. Reporting `resolved: false` here would claim it
    // is outstanding, when in fact it has nothing to resolve.
    const f = fetcherWith([{ id: 'd3', notes: [note(1), note(2)] }]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(false);
    expect(detail.discussions[0]?.resolved).toBe(null);
  });

  test('a mixed thread rolls up only its resolvable notes', async () => {
    const f = fetcherWith([
      { id: 'd4', notes: [note(1), note(2, true, true), note(3)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(true);
    expect(detail.discussions[0]?.resolved).toBe(true);
  });

  test('an empty thread is not resolvable', async () => {
    const f = fetcherWith([{ id: 'd5', notes: [] }]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.resolvable).toBe(false);
    expect(detail.discussions[0]?.resolved).toBe(null);
  });

  test('per-note state is still mapped, not replaced by the rollup', async () => {
    // The note-level fields were always correct. The rollup must not clobber
    // them or derive them from itself.
    const f = fetcherWith([
      { id: 'd6', notes: [note(1, true, true), note(2, true, false)] }
    ]);

    const detail = await f.fetchDetail(42, 7);

    expect(detail.discussions[0]?.notes[0]?.resolved).toBe(true);
    expect(detail.discussions[0]?.notes[1]?.resolved).toBe(false);
  });

  test('discussions are independent of one another', async () => {
    const f = fetcherWith([
      { id: 'd7', notes: [note(1, true, true)] },
      { id: 'd8', notes: [note(2, true, false)] },
      { id: 'd9', notes: [note(3)] }
    ]);

    const detail = await f.fetchDetail(42, 7);
    const byId = Object.fromEntries(
      detail.discussions.map(d => [d.id, [d.resolvable, d.resolved]])
    );

    expect(byId.d7).toEqual([true, true]);
    expect(byId.d8).toEqual([true, false]);
    expect(byId.d9).toEqual([false, null]);
  });
});

describe('MRDetailFetcher: discussion pagination', () => {
  test('walks x-next-page and returns discussions from every page in order', async () => {
    const { fetcher, urls } = fetcherWithPages({
      '1': { discussions: [{ id: 'd1', notes: [note(1, true, true)] }], nextPage: '2' },
      '2': { discussions: [{ id: 'd2', notes: [note(2, true, false)] }], nextPage: '' }
    });

    const detail = await fetcher.fetchDetail(42, 7);

    expect(detail.discussions.map(d => d.id)).toEqual(['d1', 'd2']);
    expect(urls[1]).toContain('page=2');
    expect(urls[1]).toContain('per_page=100');
  });

  test('a non-advancing page rejects instead of looping forever', async () => {
    const { fetcher } = fetcherWithPages({
      '1': { discussions: [{ id: 'd1', notes: [note(1, true, true)] }], nextPage: '1' }
    });

    await expect(fetcher.fetchDetail(42, 7)).rejects.toThrow(/non-advancing page/);
  });
});
