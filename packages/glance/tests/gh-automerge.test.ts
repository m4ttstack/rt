#!/usr/bin/env bun
/**
 * MAT-134: auto-merge on GitHub is a pair of GraphQL mutations.
 *
 * The load-bearing assertions here are the end-state checks. Both mutations
 * can be accepted by GitHub and change nothing, and a resolved promise would
 * then read as "auto-merge is on" when it is off. That is the MAT-15 shape
 * and the reason `graphqlOrThrow` exists.
 *
 * The transport is stubbed; nothing here touches a network.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

/**
 * A provider whose PR lookup returns a fixed node id and whose GraphQL
 * transport answers mutations with `payload`.
 *
 * `requests` captures every `octokit.request` call's route and params: the
 * stub used to ignore its arguments entirely, so nothing verified that
 * `owner`, `repo`, and `pull_number` were actually derived from
 * `projectPath` and `mrIid` rather than, say, swapped or hardcoded.
 */
function providerWith(payload: unknown) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const requests: Array<{ route: string; params?: Record<string, unknown> }> = [];
  (provider as any).octokit = {
    request: async (route: string, params?: Record<string, unknown>) => {
      requests.push({ route, params });
      return {
        status: 200,
        headers: {},
        data: { number: 5, node_id: 'PR_kwABC' }
      };
    },
    graphql: async (query: string, variables: Record<string, unknown>) => {
      mutations.push({ query, variables });
      return payload;
    }
  };
  return { provider, mutations, requests };
}

/** A provider whose PR lookup fails, for exercising `pullRequestNodeId`'s own error paths. */
function providerWithLookup(handler: () => Promise<{ status: number; headers: unknown; data: unknown }>) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  (provider as any).octokit = {
    request: handler,
    graphql: async () => {
      throw new Error('graphql should not be reached when the PR lookup itself fails');
    }
  };
  return provider;
}

describe('setAutoMerge', () => {
  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canAutoMerge).toBe(true);
  });

  test('enables auto-merge against the PR node id', async () => {
    const { provider, mutations, requests } = providerWith({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    });

    await provider.setAutoMerge('acme/repo', 5);

    // Proves the PR lookup itself was scoped to the right repo and PR, not
    // just that some request happened to return a usable node id.
    expect(requests.length).toBe(1);
    expect(requests[0]?.route).toBe('GET /repos/{owner}/{repo}/pulls/{pull_number}');
    expect(requests[0]?.params).toMatchObject({ owner: 'acme', repo: 'repo', pull_number: 5 });

    expect(mutations.length).toBe(1);
    expect(mutations[0]?.query).toContain('enablePullRequestAutoMerge');
    expect(mutations[0]?.variables.id).toBe('PR_kwABC');
  });

  test('an accepted mutation that enabled nothing throws', async () => {
    const { provider } = providerWith({
      enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } }
    });

    await expect(provider.setAutoMerge('acme/repo', 5)).rejects.toThrow(/reported no auto-merge/i);
  });
});

describe('cancelAutoMerge', () => {
  test('disables auto-merge against the PR node id', async () => {
    const { provider, mutations, requests } = providerWith({
      disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } }
    });

    await provider.cancelAutoMerge('acme/repo', 5);

    expect(requests[0]?.route).toBe('GET /repos/{owner}/{repo}/pulls/{pull_number}');
    expect(requests[0]?.params).toMatchObject({ owner: 'acme', repo: 'repo', pull_number: 5 });

    expect(mutations[0]?.query).toContain('disablePullRequestAutoMerge');
    expect(mutations[0]?.variables.id).toBe('PR_kwABC');
  });

  test('an accepted mutation that left auto-merge on throws', async () => {
    const { provider } = providerWith({
      disablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    });

    await expect(provider.cancelAutoMerge('acme/repo', 5)).rejects.toThrow(
      /still reports auto-merge/i
    );
  });
});

describe("pullRequestNodeId's failure paths", () => {
  test('an HTTP error from the PR lookup surfaces its status', async () => {
    const provider = providerWithLookup(async () => {
      throw new RequestError('Not Found', 404, {
        request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
        response: { status: 404, url: '', headers: {}, data: { message: 'Not Found' } }
      });
    });

    // Both setAutoMerge and cancelAutoMerge share this lookup; setAutoMerge
    // exercises it here since either call site proves the same code path.
    await expect(provider.setAutoMerge('acme/repo', 5)).rejects.toThrow(
      /setAutoMerge failed: 404/
    );
  });

  test('a PR payload with no node_id throws rather than sending an empty id to GraphQL', async () => {
    const provider = providerWithLookup(async () => ({
      status: 200,
      headers: {},
      // No node_id on an otherwise-normal 200 response. Passing `undefined`
      // through to the GraphQL mutation as the `id` variable would fail with
      // a generic schema-validation error far from this call site instead of
      // the specific message pullRequestNodeId is meant to raise here.
      data: { number: 5 }
    }));

    await expect(provider.setAutoMerge('acme/repo', 5)).rejects.toThrow(
      /carries no GraphQL node id/
    );
  });
});
