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
import { GitHubProvider } from '../src/GitHubProvider.ts';

/**
 * A provider whose PR lookup returns a fixed node id and whose GraphQL
 * transport answers mutations with `payload`.
 */
function providerWith(payload: unknown) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
  (provider as any).octokit = {
    request: async () => ({
      status: 200,
      headers: {},
      data: { number: 5, node_id: 'PR_kwABC' }
    }),
    graphql: async (query: string, variables: Record<string, unknown>) => {
      mutations.push({ query, variables });
      return payload;
    }
  };
  return { provider, mutations };
}

describe('setAutoMerge', () => {
  test('the capability flag is true', () => {
    expect(new GitHubProvider('https://github.com', 'tok').capabilities.canAutoMerge).toBe(true);
  });

  test('enables auto-merge against the PR node id', async () => {
    const { provider, mutations } = providerWith({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-08-05T00:00:00Z' } }
      }
    });

    await provider.setAutoMerge('acme/repo', 5);

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
    const { provider, mutations } = providerWith({
      disablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: null } }
    });

    await provider.cancelAutoMerge('acme/repo', 5);

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
