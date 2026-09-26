#!/usr/bin/env bun
/**
 * Unit tests for GitHubProvider.fetchPullRequestsByBranches (MAT-151).
 *
 * GitLab answers this in one GraphQL query with a `sourceBranches` array
 * filter. GitHub's schema has no such filter, so the batch is built from one
 * aliased `pullRequests(headRefName:)` field per branch, chunked at
 * BRANCH_BATCH_SIZE per request, and each hit is then resolved through the
 * same `fetchSingleMR` detail path `fetchPullRequestByBranch` uses -- these
 * tests pin the alias/chunk mechanics, the state mapping, and the fact that
 * misses cost no detail request.
 *
 * No network: `octokit.graphql` is replaced outright and `fetchSingleMR` is
 * stubbed, so a detail call is observable as a recorded call rather than a
 * fixture.
 */
import { describe, expect, test } from 'bun:test';
import { GraphqlResponseError } from '@octokit/graphql';
import { GitHubProvider } from '../src/GitHubProvider.ts';

interface GraphqlCall {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * A provider whose GraphQL transport answers from `answer` and records every
 * call. `answer` receives the alias->branch mapping already decoded from the
 * variables, so a test says "branch X has PR 7" rather than "alias b2 does".
 */
function stubGraphql(
  provider: GitHubProvider,
  prNumberFor: (branch: string) => number | undefined
): GraphqlCall[] {
  const calls: GraphqlCall[] = [];
  (provider as any).octokit = {
    graphql: async (query: string, variables: Record<string, unknown>) => {
      calls.push({ query, variables });
      const repository: Record<string, { nodes: Array<{ number: number }> }> = {};
      for (const [key, value] of Object.entries(variables)) {
        if (!/^h\d+$/.test(key)) continue;
        const number = prNumberFor(value as string);
        repository[`b${key.slice(1)}`] = {
          nodes: number == null ? [] : [{ number }]
        };
      }
      return { repository };
    }
  };
  return calls;
}

/** Records every `fetchSingleMR` call and answers with a marker PR. */
function stubDetail(provider: GitHubProvider): Array<[string, number]> {
  const calls: Array<[string, number]> = [];
  (provider as any).fetchSingleMR = async (projectPath: string, mrIid: number) => {
    calls.push([projectPath, mrIid]);
    return { iid: mrIid } as any;
  };
  return calls;
}

function newProvider(): GitHubProvider {
  return new GitHubProvider('https://github.com', 'tok');
}

/** Every alias variable in a call, in alias order. */
function branchesOf(call: GraphqlCall): string[] {
  return Object.entries(call.variables)
    .filter(([k]) => /^h\d+$/.test(k))
    .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
    .map(([, v]) => v as string);
}

describe('GitHubProvider.fetchPullRequestsByBranches', () => {
  test('every input branch is a key; misses are null and cost no detail request', async () => {
    const provider = newProvider();
    const graphqlCalls = stubGraphql(provider, (branch) =>
      branch === 'feature/has-a-pr' ? 7 : undefined
    );
    const detailCalls = stubDetail(provider);

    const map = await provider.fetchPullRequestsByBranches!(
      'acme/repo',
      ['feature/has-a-pr', 'feature/no-pr', 'main'],
      'all'
    );

    expect([...map.keys()]).toEqual(['feature/has-a-pr', 'feature/no-pr', 'main']);
    expect(map.get('feature/has-a-pr')).toEqual({ iid: 7 } as any);
    expect(map.get('feature/no-pr')).toBeNull();
    expect(map.get('main')).toBeNull();

    // The hit went through the same detail path fetchPullRequestByBranch
    // uses, and the two misses issued nothing.
    expect(detailCalls).toEqual([['acme/repo', 7]]);
    expect(graphqlCalls.length).toBe(1);
  });

  test('branch names travel as GraphQL variables, never interpolated into the query', async () => {
    const provider = newProvider();
    const graphqlCalls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    // A branch name that is neither a valid GraphQL identifier nor safe to
    // splice into query text.
    const hostile = 'feature/a-b) { evil } #';
    await provider.fetchPullRequestsByBranches!('acme/repo', [hostile], 'all');

    const call = graphqlCalls[0]!;
    expect(call.query).not.toContain(hostile);
    expect(call.query).toContain('$h0');
    expect(call.variables.h0).toBe(hostile);
    expect(call.variables.owner).toBe('acme');
    expect(call.variables.repo).toBe('repo');
  });

  test("state 'opened' sends states: [OPEN]", async () => {
    const provider = newProvider();
    const calls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    await provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'opened');

    expect(calls[0]!.variables.states).toEqual(['OPEN']);
    expect(calls[0]!.query).toContain('states: $states');
    expect(calls[0]!.query).toContain('$states: [PullRequestState!]');
  });

  test("state 'merged' sends [MERGED]", async () => {
    const provider = newProvider();
    const calls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    await provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'merged');

    expect(calls[0]!.variables.states).toEqual(['MERGED']);
  });

  test("state 'closed' sends [CLOSED, MERGED], matching the REST path's is:closed", async () => {
    // GraphQL splits CLOSED from MERGED; REST does not, so
    // `fetchPullRequestByBranch` sends `state=closed` and matches merged PRs
    // on a 'closed' lookup. The batch path has to answer the same question
    // its sibling does.
    const provider = newProvider();
    const calls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    await provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'closed');

    expect(calls[0]!.variables.states).toEqual(['CLOSED', 'MERGED']);
  });

  test("state 'all' omits the filter entirely", async () => {
    const provider = newProvider();
    const calls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    await provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'all');

    expect(calls[0]!.variables.states).toBeUndefined();
    expect(calls[0]!.query).not.toContain('states');
  });

  test("an omitted state defaults to 'opened', as GitLab's batch method does", async () => {
    // GitLabProvider.fetchPullRequestsByBranches defaults `state` to
    // 'opened'. This method exists so one call answers the same question on
    // either forge, so a caller naming no state must not get a wider answer
    // here than it would there.
    const provider = newProvider();
    const calls = stubGraphql(provider, () => undefined);
    stubDetail(provider);

    await provider.fetchPullRequestsByBranches!('acme/repo', ['b']);

    expect(calls[0]!.variables.states).toEqual(['OPEN']);
    expect(calls[0]!.query).toContain('states: $states');
  });

  test('a branch with two PRs resolves to the same one fetchPullRequestByBranch picks', async () => {
    // The reused-branch case, where "which PR?" has two defensible answers
    // and the two paths must not each pick a different one. Both PRs are
    // open on `feature/reused`:
    //
    //   #10  created first,  updated most recently
    //   #20  created second, updated earlier
    //
    // REST's `GET /pulls` defaults to created-descending and
    // fetchPullRequestByBranch takes the first result, so the single path
    // answers #20. The batch query must order the same way -- ordering by
    // UPDATED_AT would answer #10 and quietly disagree about one branch.
    const prs = [
      { number: 10, created: 1, updated: 99 },
      { number: 20, created: 2, updated: 2 }
    ];
    const provider = newProvider();
    const detailCalls = stubDetail(provider);

    let orderedBy: string | undefined;
    (provider as any).octokit = {
      // REST: created-descending, GitHub's own default sort for this route.
      request: async () => ({
        status: 200,
        headers: {},
        data: [...prs]
          .sort((a, b) => b.created - a.created)
          .map((p) => ({ number: p.number, head: { ref: 'feature/reused' } }))
      }),
      // GraphQL: honours whatever `orderBy` field the query actually asked
      // for, so this test fails on the ordering rather than on a string
      // match against the query text.
      graphql: async (query: string) => {
        orderedBy = /field:\s*(\w+)/.exec(query)?.[1];
        const sorted = [...prs].sort((a, b) =>
          orderedBy === 'UPDATED_AT' ? b.updated - a.updated : b.created - a.created
        );
        return { repository: { b0: { nodes: [{ number: sorted[0]!.number }] } } };
      }
    };

    const single = await provider.fetchPullRequestByBranch('acme/repo', 'feature/reused');
    const batch = await provider.fetchPullRequestsByBranches!('acme/repo', ['feature/reused']);

    expect(orderedBy).toBe('CREATED_AT');
    expect(single).toEqual({ iid: 20 } as any);
    expect(batch.get('feature/reused')).toEqual(single as any);
    expect(detailCalls).toEqual([
      ['acme/repo', 20],
      ['acme/repo', 20]
    ]);
  });

  test('60 branches chunk into exactly 2 GraphQL requests of 50 and 10', async () => {
    const provider = newProvider();
    const branches = Array.from({ length: 60 }, (_, i) => `feature/b-${i}`);
    const calls = stubGraphql(provider, () => undefined);
    const detailCalls = stubDetail(provider);

    const map = await provider.fetchPullRequestsByBranches!('acme/repo', branches, 'all');

    expect(calls.length).toBe(2);
    expect(branchesOf(calls[0]!)).toEqual(branches.slice(0, 50));
    expect(branchesOf(calls[1]!)).toEqual(branches.slice(50));
    expect(map.size).toBe(60);
    expect([...map.values()].every((v) => v === null)).toBe(true);
    expect(detailCalls).toEqual([]);
  });

  test('hits from a later chunk still resolve, keyed by their own branch', async () => {
    const provider = newProvider();
    const branches = Array.from({ length: 60 }, (_, i) => `feature/b-${i}`);
    stubGraphql(provider, (branch) => (branch === 'feature/b-55' ? 555 : undefined));
    const detailCalls = stubDetail(provider);

    const map = await provider.fetchPullRequestsByBranches!('acme/repo', branches, 'all');

    expect(detailCalls).toEqual([['acme/repo', 555]]);
    expect(map.get('feature/b-55')).toEqual({ iid: 555 } as any);
    expect(map.get('feature/b-54')).toBeNull();
  });

  test('an empty branches array returns an empty Map with zero requests', async () => {
    const provider = newProvider();
    const calls = stubGraphql(provider, () => 1);
    const detailCalls = stubDetail(provider);

    const map = await provider.fetchPullRequestsByBranches!('acme/repo', [], 'all');

    expect(map.size).toBe(0);
    expect(calls).toEqual([]);
    expect(detailCalls).toEqual([]);
  });

  test('a GraphQL error propagates rather than degrading the whole call to nulls', async () => {
    const provider = newProvider();
    (provider as any).octokit = {
      graphql: async () => {
        throw new GraphqlResponseError(
          { method: 'POST', url: 'https://api.github.com/graphql' } as never,
          {} as never,
          { data: null, errors: [{ message: 'Resource not accessible' }] } as never
        );
      }
    };
    stubDetail(provider);

    await expect(
      provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'all')
    ).rejects.toThrow(/Resource not accessible/);
  });

  test('a transport throw propagates', async () => {
    const provider = newProvider();
    (provider as any).octokit = {
      graphql: async () => {
        throw new Error('socket hang up');
      }
    };
    stubDetail(provider);

    await expect(
      provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'all')
    ).rejects.toThrow(/socket hang up/);
  });

  test('a missing repository throws rather than reporting every branch as a miss', async () => {
    const provider = newProvider();
    (provider as any).octokit = { graphql: async () => ({ repository: null }) };
    stubDetail(provider);

    await expect(
      provider.fetchPullRequestsByBranches!('acme/repo', ['b'], 'all')
    ).rejects.toThrow(/acme\/repo/);
  });
});
