#!/usr/bin/env bun
/**
 * MAT-133: every way a GraphQL call can fail must reach the caller.
 *
 * `graphql()` swallows all of these into a warn and a null, which is fine for
 * reads that report "unknown". `graphqlOrThrow()` is what mutations use, and a
 * mutation that returns null is indistinguishable from one that did nothing.
 * These tests drive it through `setDraft`, the one existing caller, because
 * `graphqlOrThrow` is private.
 *
 * No network: `octokit.graphql` is replaced outright.
 */
import { describe, expect, test } from 'bun:test';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

/** A provider whose GraphQL transport does whatever `impl` does. */
function providerWithGraphql(impl: () => Promise<unknown>): GitHubProvider {
  const provider = new GitHubProvider('https://github.com', 'tok');
  (provider as any).octokit = { graphql: impl };
  return provider;
}

/** The `GraphqlResponseError` shape `@octokit/graphql` throws. */
function graphqlResponseError(
  errors: Array<{ message: string }>,
  data: unknown = null
): GraphqlResponseError<unknown> {
  return new GraphqlResponseError(
    { method: 'POST', url: 'https://api.github.com/graphql' } as never,
    {} as never,
    { data, errors } as never
  );
}

/** `setDraft` is reached through `updatePullRequest`'s `draft` toggle. */
function setDraft(provider: GitHubProvider): Promise<unknown> {
  return (provider as any).setDraft('PR_node_id', true);
}

describe('graphqlOrThrow: failure categories reach the caller', () => {
  test('GraphQL errors surface their messages', async () => {
    const provider = providerWithGraphql(async () => {
      throw graphqlResponseError([{ message: 'Resource not accessible' }]);
    });

    await expect(setDraft(provider)).rejects.toThrow(/Resource not accessible/);
  });

  test('an HTTP failure surfaces its status', async () => {
    const provider = providerWithGraphql(async () => {
      throw new RequestError('Bad credentials', 401, {
        request: { method: 'POST', url: 'https://api.github.com/graphql', headers: {} },
        response: { status: 401, url: '', headers: {}, data: {} }
      });
    });

    await expect(setDraft(provider)).rejects.toThrow(/401/);
  });

  test('a transport throw is not swallowed', async () => {
    const provider = providerWithGraphql(async () => {
      throw new Error('socket hang up');
    });

    await expect(setDraft(provider)).rejects.toThrow(/socket hang up/);
  });

  test('a null payload throws rather than resolving', async () => {
    const provider = providerWithGraphql(async () => null);

    await expect(setDraft(provider)).rejects.toThrow(/no data/);
  });

  test('an empty `errors` array is success, matching graphql()', async () => {
    // `@octokit/graphql` throws whenever the response body has an `errors`
    // key at all, and `[]` is truthy. The pre-Octokit code tested
    // `payload.errors?.length`, so an empty array read as success. Both
    // helpers have to keep reading it that way.
    const provider = providerWithGraphql(async () => {
      throw graphqlResponseError([], {
        convertPullRequestToDraft: { pullRequest: { isDraft: true } }
      });
    });

    await expect(setDraft(provider)).resolves.toBeUndefined();
  });
});
