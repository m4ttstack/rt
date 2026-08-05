#!/usr/bin/env bun
/**
 * The parts of `fetchPullRequests` both providers must answer identically.
 *
 * These gates used to disagree: GitHub threw for `iids` without `projectPath`
 * while GitLab fell through to the role-based involvement set, so the same call
 * returned a team board on one provider and an exception on the other. Same for
 * an unparseable `updatedAfter`, which GitHub rejected and GitLab forwarded raw.
 *
 * Both providers' transports are stubbed; nothing here touches a network.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A GitLab provider whose transport fails the test if it is ever reached. */
function gitlabNoNetwork(): GitLabProvider {
  globalThis.fetch = (async () => {
    throw new Error('fetch should not be reached');
  }) as typeof fetch;
  return new GitLabProvider('https://gitlab.com', 'tok');
}

/** A GitLab provider whose GraphQL calls return no MRs; returns the variables seen. */
function gitlabRecording(): { provider: GitLabProvider; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { variables: Record<string, unknown> };
    calls.push(body.variables);
    return new Response(
      JSON.stringify({
        data: {
          project: { mergeRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
          currentUser: {
            authoredMergeRequests: { nodes: [] },
            reviewRequestedMergeRequests: { nodes: [] },
            assignedMergeRequests: { nodes: [] },
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { provider: new GitLabProvider('https://gitlab.com', 'tok'), calls };
}

/** A GitHub provider whose REST/GraphQL calls return nothing; returns the paths seen. */
function githubRecording(): { provider: GitHubProvider; calls: string[] } {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const calls: string[] = [];
  const answer = (path: string) => (path.startsWith('/search/issues') ? { items: [] } : {});
  // validateToken/currentUser/fetchPR/listRepoPRs/searchPRs/fetchCheckRuns go
  // through octokit.request directly now; fetchReviews (via fetchAllPages)
  // still goes through api(). Both stubs record into the same `calls` array
  // so the path-based assertions below don't care which transport carried a
  // given call.
  (provider as any).octokit = {
    request: async (route: string) => {
      const path = route.slice(route.indexOf(' ') + 1);
      calls.push(path);
      return { status: 200, headers: {}, data: answer(path) };
    },
  };
  (provider as any).api = async (_method: string, path: string) => {
    calls.push(path);
    const body = answer(path);
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: { get: () => null },
    } as unknown as Response;
  };
  (provider as any).graphql = async () => ({ nodes: [] });
  return { provider, calls };
}

describe('fetchPullRequests contract: options that require a projectPath', () => {
  test('`iids` without `projectPath` throws on both providers', async () => {
    const expected = /fetchPullRequests: `iids` requires `projectPath`/;

    await expect(gitlabNoNetwork().fetchPullRequests({ iids: [1] })).rejects.toThrow(expected);
    await expect(
      githubRecording().provider.fetchPullRequests({ iids: [1] }),
    ).rejects.toThrow(expected);
  });

  test('`authorUsernames` without `projectPath` throws on both providers', async () => {
    const expected = /fetchPullRequests: `authorUsernames` requires `projectPath`/;

    await expect(gitlabNoNetwork().fetchPullRequests({ authorUsernames: ['ada'] })).rejects.toThrow(
      expected,
    );
    await expect(
      githubRecording().provider.fetchPullRequests({ authorUsernames: ['ada'] }),
    ).rejects.toThrow(expected);
  });

  test('GitLab does not answer an `iids` request with the involvement set', async () => {
    const { provider, calls } = gitlabRecording();

    await expect(provider.fetchPullRequests({ iids: [7] })).rejects.toThrow();

    expect(calls).toEqual([]);
  });
});

describe('fetchPullRequests contract: updatedAfter validation', () => {
  test('a non-ISO `updatedAfter` throws on both providers', async () => {
    const expected = /updatedAfter must be an ISO-8601 instant/;

    await expect(
      gitlabNoNetwork().fetchPullRequests({ projectPath: 'g/p', updatedAfter: 'last tuesday' }),
    ).rejects.toThrow(expected);
    await expect(
      githubRecording().provider.fetchPullRequests({
        projectPath: 'acme/repo',
        updatedAfter: 'last tuesday',
      }),
    ).rejects.toThrow(expected);
  });

  test('GitLab rejects it in modes that do not honor it, as GitHub does', async () => {
    await expect(
      gitlabNoNetwork().fetchPullRequests({ updatedAfter: 'whenever' }),
    ).rejects.toThrow(/updatedAfter must be an ISO-8601 instant/);
  });

  test('an ISO `updatedAfter` reaches the GitLab project query', async () => {
    const { provider, calls } = gitlabRecording();

    await provider.fetchPullRequests({ projectPath: 'g/p', updatedAfter: '2026-07-15T00:00:00Z' });

    expect(calls.length).toBe(1);
    expect(calls[0]?.ua).toBe('2026-07-15T00:00:00Z');
  });
});

describe('fetchPullRequests contract: an empty list asks for nothing', () => {
  test('empty `iids` selects the batch mode on both providers', async () => {
    const gitlab = gitlabRecording();
    const github = githubRecording();

    expect(await gitlab.provider.fetchPullRequests({ iids: [], projectPath: 'g/p' })).toEqual([]);
    expect(await github.provider.fetchPullRequests({ iids: [], projectPath: 'acme/repo' })).toEqual(
      [],
    );

    expect(gitlab.calls.length).toBe(1);
    expect(gitlab.calls[0]?.iids).toEqual([]);
    expect(github.calls.filter((c) => c.startsWith('/search/issues'))).toEqual([]);
  });

  test('empty `authorUsernames` queries no authors rather than every MR', async () => {
    const gitlab = gitlabRecording();
    const github = githubRecording();

    expect(
      await gitlab.provider.fetchPullRequests({ authorUsernames: [], projectPath: 'g/p' }),
    ).toEqual([]);
    expect(
      await github.provider.fetchPullRequests({ authorUsernames: [], projectPath: 'acme/repo' }),
    ).toEqual([]);

    expect(gitlab.calls).toEqual([]);
    expect(github.calls.filter((c) => c.startsWith('/search/issues'))).toEqual([]);
  });
});
