#!/usr/bin/env bun
/**
 * The { projectPath } mode of fetchPullRequests: every MR in the project,
 * cursor-paginated (50/page, sequential), member-blind. Closes the former
 * silent fallthrough where projectPath without iids/authorUsernames was
 * ignored and the current-user role queries ran instead.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function node(id: number, state = 'opened') {
  const user = { id: `gid://gitlab/User/${id}`, username: `u${id}`, name: `u${id}`, avatarUrl: null };
  return {
    id: `gid://gitlab/MergeRequest/${id}`,
    iid: String(id),
    projectId: 42,
    title: `MR ${id}`,
    description: null,
    state,
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    webUrl: `https://gitlab.com/g/p/-/merge_requests/${id}`,
    sourceBranch: `feat-${id}`,
    targetBranch: 'main',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    diffHeadSha: 'abc',
    author: user,
    assignees: { nodes: [] },
    reviewers: { nodes: [] },
    approvedBy: { nodes: [] },
    headPipeline: null,
    mergeabilityChecks: [],
    targetProject: { repository: { rootRef: 'main' } },
  };
}

/** Same as `node`, but with a list-weight headPipeline: `{ id, status }` only, no stages/jobs. */
function listWeightNode(id: number, state = 'opened') {
  return {
    ...node(id, state),
    headPipeline: { id: `gid://gitlab/Ci::Pipeline/${id}`, status: 'SUCCESS' },
  };
}

/** Stub fetch serving paged project responses; records query text + variables. */
function mockPaged(pages: Array<ReturnType<typeof node>[]>) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    calls.push(body);
    const idx = calls.length - 1;
    const nodes = pages[idx] ?? [];
    const hasNextPage = idx < pages.length - 1;
    return new Response(
      JSON.stringify({
        data: {
          project: {
            mergeRequests: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor-${idx}` : null },
              nodes,
            },
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return calls;
}

describe('fetchPullRequests({ projectPath })', () => {
  test('single page: returns all project MRs, does NOT run currentUser role queries', async () => {
    const calls = mockPaged([[node(1), node(2)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', state: 'opened' });
    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2]);
    expect(calls.length).toBe(1);
    expect(calls[0].query).toContain('project(fullPath:');
    expect(calls[0].query).not.toContain('currentUser');
    expect(calls[0].variables).toMatchObject({ projectPath: 'g/p', state: 'opened', after: null });
    expect(calls[0].query).toContain('first: 50');
  });

  test('paginates sequentially until hasNextPage is false', async () => {
    const calls = mockPaged([[node(1)], [node(2)], [node(3)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p' });
    expect(prs.length).toBe(3);
    expect(calls.length).toBe(3);
    expect(calls[1].variables.after).toBe('cursor-0');
    expect(calls[2].variables.after).toBe('cursor-1');
  });

  test('multi-state request omits the state filter and filters client-side', async () => {
    const calls = mockPaged([[node(1, 'opened'), node(2, 'merged'), node(3, 'closed')]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', state: ['opened', 'merged'] });
    expect(prs.map((p) => p.state).sort()).toEqual(['merged', 'opened']);
    expect(calls[0].variables.state).toBeUndefined();
  });

  test('iids and authorUsernames paths still take precedence', async () => {
    const calls = mockPaged([[node(9)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    await provider.fetchPullRequests({ projectPath: 'g/p', iids: [9] });
    expect(calls[0].query).toContain('iids:');
  });

  test('throws instead of looping forever when the cursor stops advancing', async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      calls.push(body);
      return new Response(
        JSON.stringify({
          data: {
            project: {
              mergeRequests: {
                pageInfo: { hasNextPage: true, endCursor: 'stuck' },
                nodes: [node(1)],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const provider = new GitLabProvider('https://gitlab.example', 't');
    await expect(provider.fetchPullRequests({ projectPath: 'g/p' })).rejects.toThrow(/non-advancing cursor/);
    // First page: after=null -> endCursor='stuck' (advances, no throw). Second
    // page: after='stuck' -> endCursor='stuck' again (non-advancing) -> throws
    // before a third fetch would repeat the same cursor.
    expect(calls.length).toBe(2);
  });

  test('updatedAfter propagates into the `ua` variable', async () => {
    const calls = mockPaged([[node(1)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    await provider.fetchPullRequests({ projectPath: 'g/p', state: 'opened', updatedAfter: '2026-07-20T00:00:00Z' });
    expect(calls[0].variables.ua).toBe('2026-07-20T00:00:00Z');
  });

  test('omitting updatedAfter sends `ua: null`', async () => {
    const calls = mockPaged([[node(1)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    await provider.fetchPullRequests({ projectPath: 'g/p', state: 'opened' });
    expect(calls[0].variables.ua).toBeNull();
  });

  test('listWeight selects the list-weight query and parses through toMR without a stages tree', async () => {
    const calls = mockPaged([[listWeightNode(1)]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', state: 'opened', listWeight: true });
    expect(calls[0].query).not.toContain('stages(');
    expect(calls[0].query).toContain('MRListFields');
    expect(prs.length).toBe(1);
    expect(prs[0]?.pipeline).toEqual({
      id: 'gitlab:pipeline:1',
      status: 'success',
      createdAt: undefined,
      webUrl: null,
      jobs: [],
    });
  });

  test('all-states + listWeight routes to the NO_STATE list variant', async () => {
    const calls = mockPaged([[listWeightNode(1, 'opened'), listWeightNode(2, 'merged'), listWeightNode(3, 'closed')]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    await provider.fetchPullRequests({
      projectPath: 'g/p',
      state: ['opened', 'merged', 'closed'],
      listWeight: true,
    });
    expect(calls[0].query).not.toContain('state: $state');
    expect(calls[0].query).toContain('MRListFields');
    expect(calls[0].variables.state).toBeUndefined();
  });

  test('isStacked derives from targetBranch vs rootRef', async () => {
    const stacked = { ...node(1), targetBranch: 'feat-parent' };
    const plain = node(2); // targetBranch 'main' per the factory
    mockPaged([[stacked, plain]]);
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const prs = await provider.fetchPullRequests({ projectPath: 'g/p' });
    expect(prs.find((p) => p.iid === 1)?.isStacked).toBe(true);
    expect(prs.find((p) => p.iid === 2)?.isStacked).toBe(false);
  });
});
