#!/usr/bin/env bun
/**
 * Unit tests for the `{ authorUsernames, projectPath }` path of
 * GitLabProvider.fetchPullRequests — one GraphQL query per author, deduped by
 * MR global id, with client-side state filtering when multiple states requested.
 *
 * fetch is stubbed so no network is required.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A minimal-but-valid GraphQL MR node that toMR() can normalize. */
function node(id: number, author: string, state = 'opened') {
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

/** Stub fetch to return `byAuthor[author]` nodes; record the query variables. */
function mockGraphQL(byAuthor: Record<string, ReturnType<typeof node>[]>) {
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { variables: Record<string, unknown> };
    calls.push(body.variables);
    const author = body.variables.author as string;
    return new Response(JSON.stringify({ data: { project: { mergeRequests: { nodes: byAuthor[author] ?? [] } } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

describe('fetchPullRequests author batch', () => {
  test('issues one query per author and dedupes by MR id', async () => {
    const provider = new GitLabProvider('https://gitlab.com', 'tok');
    const shared = node(1, 'alice'); // same MR surfaces for both authors
    const calls = mockGraphQL({
      alice: [node(2, 'alice'), shared],
      bob: [node(3, 'bob'), shared],
    });

    const prs = await provider.fetchPullRequests({
      authorUsernames: ['alice', 'bob'],
      projectPath: 'g/p',
    });

    expect(calls.length).toBe(2);
    expect(calls.map((c) => c.author).sort()).toEqual(['alice', 'bob']);
    expect(calls.every((c) => c.projectPath === 'g/p' && c.state === 'opened')).toBe(true);
    expect(prs.map((p) => p.iid).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  test('filters client-side when multiple states are requested', async () => {
    const provider = new GitLabProvider('https://gitlab.com', 'tok');
    const calls = mockGraphQL({
      alice: [node(1, 'alice', 'opened'), node(2, 'alice', 'merged'), node(3, 'alice', 'closed')],
    });

    const prs = await provider.fetchPullRequests({
      authorUsernames: ['alice'],
      projectPath: 'g/p',
      state: ['opened', 'merged'],
    });

    expect(calls[0]!.state).toBe('all'); // multi-state → fetch all, filter locally
    expect(prs.map((p) => p.iid).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
