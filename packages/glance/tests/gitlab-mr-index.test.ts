#!/usr/bin/env bun
/**
 * fetchMergeRequestIndex: scalar-only MR rows across a group (subgroups
 * included) or a set of projects, bounded by updatedAfter, 100 per page,
 * paginated to exhaustion per scope.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface Call { op: string; query: string; vars: Record<string, unknown> }

function node(iid: number, over: Record<string, unknown> = {}) {
  return {
    iid: String(iid),
    title: `MR ${iid}`,
    state: 'merged',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    mergedAt: '2026-08-02T00:00:00Z',
    sourceBranch: `feat-${iid}`,
    author: { username: 'ada' },
    project: { fullPath: 'g/p' },
    labels: { nodes: [{ title: 'bug' }] },
    ...over,
  };
}

/**
 * Serves one response per call under the root the query names ("group" or
 * "project") and records every call. With `paged`, each response but the
 * last points at the next; without it every response is a final page.
 */
function stubPages(provider: GitLabProvider, pages: Array<ReturnType<typeof node>[]>, paged = true): Call[] {
  const calls: Call[] = [];
  (provider as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
    calls.push({ op, query, vars });
    const idx = calls.length - 1;
    const hasNextPage = paged && idx < pages.length - 1;
    const root = query.includes('group(fullPath') ? 'group' : 'project';
    return {
      [root]: {
        mergeRequests: {
          pageInfo: { hasNextPage, endCursor: hasNextPage ? `c${idx}` : null },
          nodes: pages[idx] ?? [],
        },
      },
    };
  };
  return calls;
}

const UA = '2026-08-01T00:00:00Z';

describe('GitLabProvider.fetchMergeRequestIndex', () => {
  test('group mode walks subgroups, pages to exhaustion, and maps rows', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubPages(p, [[node(1), node(2)], [node(3, { state: 'opened', mergedAt: null, author: null })]]);
    const seen: number[] = [];
    const rows = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, onPage: (n) => seen.push(n) });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.op).toBe('fetchMergeRequestIndex');
    expect(calls[0]!.query).toContain('includeSubgroups: true');
    expect(calls[0]!.vars).toEqual({ fullPath: 'g', ua: UA, after: null });
    expect(calls[1]!.vars.after).toBe('c0');
    expect(seen).toEqual([2, 3]);
    expect(rows[0]).toEqual({
      iid: 1, projectPath: 'g/p', title: 'MR 1', state: 'merged',
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', mergedAt: '2026-08-02T00:00:00Z',
      authorUsername: 'ada', sourceBranch: 'feat-1', labels: ['bug'],
    });
    expect(rows[2]).toMatchObject({ iid: 3, state: 'opened', mergedAt: null, authorUsername: null });
  });

  test('project mode queries each project in turn and never sends includeSubgroups', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubPages(p, [[node(1)], [node(9, { project: { fullPath: 'g/q' } })]], false);
    const rows = await p.fetchMergeRequestIndex({ projectPaths: ['g/p', 'g/q'], updatedAfter: UA });
    expect(calls.map((c) => c.vars.fullPath)).toEqual(['g/p', 'g/q']);
    expect(calls[0]!.query).not.toContain('includeSubgroups');
    expect(rows.map((r) => r.projectPath)).toEqual(['g/p', 'g/q']);
  });

  test('one state is sent to the API; several are filtered here with no state variable', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const page = [node(1, { state: 'merged' }), node(2, { state: 'closed' }), node(3, { state: 'opened' })];
    const calls = stubPages(p, [page, page], false);
    const one = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, states: ['merged'] });
    expect(calls[0]!.vars.state).toBe('merged');
    expect(calls[0]!.query).toContain('$state: MergeRequestState');
    expect(one).toHaveLength(3);
    const many = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, states: ['merged', 'opened'] });
    expect(calls[1]!.vars).not.toHaveProperty('state');
    expect(calls[1]!.query).not.toContain('$state');
    expect(many.map((r) => r.iid)).toEqual([1, 3]);
  });

  test('refuses both or neither scope, and an unparseable updatedAfter', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubPages(p, [[]]);
    await expect(p.fetchMergeRequestIndex({ updatedAfter: UA } as any)).rejects.toThrow('exactly one of groupPath or projectPaths');
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', projectPaths: ['g/p'], updatedAfter: UA })).rejects.toThrow('exactly one of groupPath or projectPaths');
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: 'yesterday' })).rejects.toThrow('ISO-8601');
  });

  test('a cursor that does not advance throws instead of looping', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      group: { mergeRequests: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [node(1)] } },
    });
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA })).rejects.toThrow('non-advancing cursor');
  });

  test('an unknown or inaccessible root throws instead of returning an empty page', async () => {
    const projectProvider = new GitLabProvider('https://gitlab.example', 't');
    (projectProvider as any).runQuery = async () => ({ project: null });
    await expect(
      projectProvider.fetchMergeRequestIndex({ projectPaths: ['g/missing'], updatedAfter: UA })
    ).rejects.toThrow('no project at g/missing');

    const groupProvider = new GitLabProvider('https://gitlab.example', 't');
    (groupProvider as any).runQuery = async () => ({ group: null });
    await expect(
      groupProvider.fetchMergeRequestIndex({ groupPath: 'nope', updatedAfter: UA })
    ).rejects.toThrow('no group at nope');
  });

  test('the capability flag is on', () => {
    expect(new GitLabProvider('https://gitlab.example', 't').capabilities.canFetchMergeRequestIndex).toBe(true);
  });
});
