#!/usr/bin/env bun
/**
 * onRequest hook: GraphQL transport coverage via runQuery.
 * fetch is stubbed so no network is required.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { safeEmit, type RequestInfo } from '../src/instrumentation.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function gqlResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Minimal valid GQL MR node (same shape as tests/author-batch.test.ts). */
function node(id: number, author = 'luke', state = 'opened') {
  const user = { id: `gid://gitlab/User/${id}`, username: author, name: author, avatarUrl: null };
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
    sourceBranch: 'feat',
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
  };
}

describe('safeEmit', () => {
  test('swallows a throwing hook', () => {
    const info: RequestInfo = { op: 'x', transport: 'graphql', method: 'POST', path: '/api/graphql', durationMs: 1, status: 200 };
    expect(() => safeEmit(() => { throw new Error('boom'); }, info)).not.toThrow();
    expect(() => safeEmit(undefined, info)).not.toThrow();
  });
});

describe('runQuery onRequest', () => {
  test('emits one graphql info per query with op label and status', async () => {
    globalThis.fetch = (async () =>
      gqlResponse({ project: { mergeRequests: { nodes: [node(7)] } } })) as unknown as typeof fetch;
    const seen: RequestInfo[] = [];
    const provider = new GitLabProvider('https://gitlab.example', 't', { onRequest: (i) => seen.push(i) });
    await provider.fetchPullRequests({ iids: [7], projectPath: 'g/p' });
    const gql = seen.filter((i) => i.transport === 'graphql');
    expect(gql.length).toBe(1);
    expect(gql[0].op).toBe('fetchPullRequests.iids');
    expect(gql[0].method).toBe('POST');
    expect(gql[0].path).toBe('/api/graphql');
    expect(gql[0].status).toBe(200);
    expect(gql[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test('emits failure status before throwing', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const seen: RequestInfo[] = [];
    const provider = new GitLabProvider('https://gitlab.example', 't', { onRequest: (i) => seen.push(i) });
    await expect(provider.fetchPullRequests({ iids: [7], projectPath: 'g/p' })).rejects.toThrow();
    expect(seen.some((i) => i.transport === 'graphql' && i.status === 500)).toBe(true);
  });

  test('a throwing hook never breaks the request', async () => {
    globalThis.fetch = (async () =>
      gqlResponse({ project: { mergeRequests: { nodes: [] } } })) as unknown as typeof fetch;
    const provider = new GitLabProvider('https://gitlab.example', 't', {
      onRequest: () => { throw new Error('hook bug'); },
    });
    const prs = await provider.fetchPullRequests({ iids: [1], projectPath: 'g/p' });
    expect(prs).toEqual([]);
  });
});
