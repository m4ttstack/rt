#!/usr/bin/env bun
/**
 * The REST-backed metric reads. fetch is stubbed so every test asserts the
 * exact URL (path, filters, per_page, page) and the x-next-page walk.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Page { status?: number; body: unknown; nextPage?: string }

/** Answers each fetch with the next page in order and records the URLs asked for. */
function stubFetch(pages: Page[]): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    const page = pages[urls.length - 1] ?? { body: [] };
    const headers = new Headers();
    if (page.nextPage !== undefined) headers.set('x-next-page', page.nextPage);
    return new Response(JSON.stringify(page.body), { status: page.status ?? 200, headers });
  }) as typeof fetch;
  return urls;
}

const p = () => new GitLabProvider('https://gitlab.example', 't');

describe('fetchProject', () => {
  test('resolves a path to a scoped id', async () => {
    const urls = stubFetch([{ body: { id: 42, path_with_namespace: 'g/p' } }]);
    expect(await p().fetchProject('g/p')).toEqual({ id: 'gitlab:42', fullPath: 'g/p' });
    expect(urls).toEqual(['https://gitlab.example/api/v4/projects/g%2Fp']);
  });

  test('404 is null; any other failure throws', async () => {
    stubFetch([{ status: 404, body: { message: '404 Project Not Found' } }]);
    expect(await p().fetchProject('g/missing')).toBeNull();
    stubFetch([{ status: 500, body: {} }]);
    await expect(p().fetchProject('g/p')).rejects.toThrow('fetchProject: HTTP 500');
  });
});

describe('fetchGroupProjects', () => {
  test('pages the group projects connection, subgroups included', async () => {
    const prov = p();
    const calls: Array<{ op: string; query: string; vars: Record<string, unknown> }> = [];
    const pages = [
      { group: { projects: { pageInfo: { hasNextPage: true, endCursor: 'c0' }, nodes: [{ fullPath: 'g/a' }] } } },
      { group: { projects: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ fullPath: 'g/sub/b' }] } } },
    ];
    (prov as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
      calls.push({ op, query, vars });
      return pages[calls.length - 1];
    };
    expect(await prov.fetchGroupProjects('g')).toEqual(['g/a', 'g/sub/b']);
    expect(calls[0]!.query).toContain('includeSubgroups: true');
    expect(calls.map((c) => c.vars.after)).toEqual([null, 'c0']);
  });

  test('an unknown group throws rather than reading as empty', async () => {
    const prov = p();
    (prov as any).runQuery = async () => ({ group: null });
    await expect(prov.fetchGroupProjects('nope')).rejects.toThrow('no group at nope');
  });
});

describe('fetchProjectPipelines', () => {
  test('filters by user and window, walks x-next-page, and maps summaries', async () => {
    const urls = stubFetch([
      { body: [{ id: 1, status: 'SUCCESS', created_at: '2026-08-02T00:00:00Z' }], nextPage: '2' },
      { body: [{ id: 2, status: 'failed', created_at: null }], nextPage: '' },
    ]);
    const out = await p().fetchProjectPipelines('g/p', {
      username: 'ada', updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z',
    });
    expect(urls).toEqual([
      'https://gitlab.example/api/v4/projects/g%2Fp/pipelines?username=ada&updated_after=2026-08-01T00%3A00%3A00Z&updated_before=2026-08-31T00%3A00%3A00Z&per_page=100&page=1',
      'https://gitlab.example/api/v4/projects/g%2Fp/pipelines?username=ada&updated_after=2026-08-01T00%3A00%3A00Z&updated_before=2026-08-31T00%3A00%3A00Z&per_page=100&page=2',
    ]);
    expect(out).toEqual([
      { id: 'gitlab:pipeline:1', status: 'success', createdAt: '2026-08-02T00:00:00Z', username: 'ada' },
      { id: 'gitlab:pipeline:2', status: 'failed', createdAt: null, username: 'ada' },
    ]);
  });

  test('no username means an unfiltered listing with a null username', async () => {
    const urls = stubFetch([{ body: [] }]);
    const out = await p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z' });
    expect(urls[0]).not.toContain('username=');
    expect(out).toEqual([]);
  });

  test('refuses an unparseable bound and a page that does not advance', async () => {
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: 'x', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('updatedAfter must be an ISO-8601 instant');
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: 'x' })).rejects.toThrow('updatedBefore must be an ISO-8601 instant');
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('updatedAfter must be an ISO-8601 instant');
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('updatedAfter must be an ISO-8601 instant');
    stubFetch([{ body: [], nextPage: '1' }]);
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('non-advancing page');
  });
});

describe('fetchUserEvents', () => {
  test('reads the numeric id out of the scoped user id and maps events', async () => {
    const urls = stubFetch([{ body: [
      { action_name: 'pushed to', created_at: '2026-08-02T09:00:00Z', project_id: 42 },
      { action_name: 'pushed new', created_at: '2026-08-03T09:00:00Z', project_id: null },
    ] }]);
    const out = await p().fetchUserEvents('gitlab:user:7', { action: 'pushed', after: '2026-07-31', before: '2026-09-01' });
    expect(urls).toEqual(['https://gitlab.example/api/v4/users/7/events?action=pushed&after=2026-07-31&before=2026-09-01&per_page=100&page=1']);
    expect(out).toEqual([
      { action: 'pushed to', createdAt: '2026-08-02T09:00:00Z', repositoryId: 'gitlab:42' },
      { action: 'pushed new', createdAt: '2026-08-03T09:00:00Z', repositoryId: null },
    ]);
  });

  test('refuses a non-GitLab user id and non-date bounds', async () => {
    await expect(p().fetchUserEvents('github:user:7', { action: 'pushed', after: '2026-07-31', before: '2026-09-01' })).rejects.toThrow('scoped GitLab user id');
    await expect(p().fetchUserEvents('gitlab:user:7', { action: 'pushed', after: '2026-07-31T00:00:00Z', before: '2026-09-01' })).rejects.toThrow('after must be a calendar date');
  });
});

describe('capability flags', () => {
  test('all four REST-backed reads are on', () => {
    const c = p().capabilities;
    expect([c.canFetchGroupProjects, c.canFetchProject, c.canFetchProjectPipelines, c.canFetchUserEvents]).toEqual([true, true, true, true]);
  });
});
