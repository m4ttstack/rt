#!/usr/bin/env bun
/**
 * Merge semantics on GitHub (MAT-25, MAT-127).
 *
 * GitHub's merge endpoint carries one commit-message pair, `commit_title` plus
 * `commit_message`, which are the title and body of a single commit. It has no
 * separate squash-message field and no delete-branch parameter. `commitMessage`
 * and `squashCommitMessage` are alternates selected by merge strategy, so
 * exactly one of them can reach any given merge.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface MergeCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

/**
 * Records every api() call and answers all of them 200. `fetchSingleMR` is
 * stubbed too: mergePullRequest re-fetches the PR to return it, and that read
 * is not what these tests are about.
 */
function stubGitHub(
  provider: GitHubProvider,
  sourceBranch = 'feature-branch'
): MergeCall[] {
  const calls: MergeCall[] = [];
  (provider as any).api = async (
    method: string,
    path: string,
    body?: unknown
  ) => {
    calls.push({ method, path, body: body as Record<string, unknown> | undefined });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      headers: { get: () => null }
    } as unknown as Response;
  };
  (provider as any).fetchSingleMR = async () => ({ iid: 1, sourceBranch });
  return calls;
}

function mergeBody(calls: MergeCall[]): Record<string, unknown> {
  const call = calls.find(c => c.path.endsWith('/merge'));
  if (!call) throw new Error('no merge call was made');
  return call.body ?? {};
}

describe('GitHubProvider merge commit messages (MAT-25)', () => {
  test('commitMessage reaches commit_title on a default-strategy merge', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'Ship the thing'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('Ship the thing');
    expect(body.commit_message).toBeUndefined();
    expect(body.merge_method).toBeUndefined();
  });

  test('squashCommitMessage does not reach a non-squash merge at all', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'merge-commit-message',
      squashCommitMessage: 'squash-commit-message'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('merge-commit-message');
    expect(JSON.stringify(body)).not.toContain('squash-commit-message');
  });

  test('squash selects squashCommitMessage and drops commitMessage', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      squash: true,
      commitMessage: 'merge-commit-message',
      squashCommitMessage: 'squash-commit-message'
    });

    const body = mergeBody(calls);
    expect(body.merge_method).toBe('squash');
    expect(body.commit_title).toBe('squash-commit-message');
    expect(JSON.stringify(body)).not.toContain('merge-commit-message');
  });

  test('squashing with no squash message falls back to commitMessage', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      mergeMethod: 'squash',
      commitMessage: 'the only message the caller gave'
    });

    const body = mergeBody(calls);
    expect(body.merge_method).toBe('squash');
    expect(body.commit_title).toBe('the only message the caller gave');
  });

  test('a multi-line message splits into title and body', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'Short title\n\nA longer explanation.\nSecond line.'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('Short title');
    expect(body.commit_message).toBe('A longer explanation.\nSecond line.');
  });

  test('no messages sends neither field', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, { sha: 'abc123' });

    const body = mergeBody(calls);
    expect(body.commit_title).toBeUndefined();
    expect(body.commit_message).toBeUndefined();
    expect(body.sha).toBe('abc123');
  });
});
