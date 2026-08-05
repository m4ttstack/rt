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
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const API = 'https://api.github.com';

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
 * Adapts an `api()`-shaped stub (method, path, body) => Response into an
 * `octokit.request(route, params)` stub: `RequestError` on a non-ok status,
 * `{status, headers, data}` on success, matching the real client.
 */
function toOctokitRequestStub(
  apiFn: (method: string, path: string, body?: unknown) => Promise<Response>
) {
  return async (route: string, params?: { data?: unknown }) => {
    const spaceIdx = route.indexOf(' ');
    const method = route.slice(0, spaceIdx);
    const path = route.slice(spaceIdx + 1);
    const res = await apiFn(method, path, params?.data);
    if (!res.ok) {
      throw new RequestError(await res.text(), res.status, {
        request: { method, url: `${API}${path}`, headers: {} },
        response: { status: res.status, url: '', headers: {}, data: await res.json() }
      });
    }
    return { status: res.status, headers: {}, data: await res.json() };
  };
}

/**
 * Records every api() call and answers all of them 200. `fetchSingleMR` is
 * stubbed too: mergePullRequest re-fetches the PR to return it, and that read
 * is not what these tests are about.
 *
 * `headRepoFullName` defaults to the same repo the merge is against, since
 * that is the ordinary (non-fork) case. Pass a different value, or `null`, to
 * exercise the fork / unknown-head-repo paths.
 *
 * `mergePullRequest`'s `shouldRemoveSourceBranch` path calls `fetchPR`, which
 * now goes through `octokit.request` rather than `api()`. Every per-test
 * override below replaces `.api` (for the DELETE and git/ref/heads checks)
 * but never that raw-PR GET route, so binding `octokit.request` once, here,
 * to this same base `apiFn` keeps it answering correctly no matter what a
 * later override does to `.api`.
 */
function stubGitHub(
  provider: GitHubProvider,
  sourceBranch = 'feature-branch',
  headRepoFullName: string | null = 'acme/repo'
): MergeCall[] {
  const calls: MergeCall[] = [];
  const apiFn = async (
    method: string,
    path: string,
    body?: unknown
  ) => {
    calls.push({ method, path, body: body as Record<string, unknown> | undefined });
    // The raw-PR GET that mergePullRequest issues to resolve the head repo,
    // distinct from the merge PUT (.../merge) and the git/ref GETs.
    if (method === 'GET' && /\/pulls\/\d+$/.test(path)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          head: {
            sha: 'abc123',
            ref: sourceBranch,
            repo: headRepoFullName ? { full_name: headRepoFullName } : null
          }
        }),
        text: async () => '',
        headers: { get: () => null }
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      headers: { get: () => null }
    } as unknown as Response;
  };
  (provider as any).api = apiFn;
  (provider as any).octokit = { request: toOctokitRequestStub(apiFn) };
  (provider as any).fetchSingleMR = async () => ({ iid: 1, sourceBranch });
  return calls;
}

/**
 * Some tests below replace `.api` after `stubGitHub` to simulate a specific
 * DELETE/GET response shape for `deleteMergedSourceBranch`. That method now
 * calls `octokit.request` rather than `.api`, so the override has to reach
 * both, or the migrated code keeps talking to the original recorder and
 * never sees the simulated response.
 */
function overrideApi(
  provider: GitHubProvider,
  apiFn: (method: string, path: string, body?: unknown) => Promise<Response>
): void {
  (provider as any).api = apiFn;
  (provider as any).octokit = { request: toOctokitRequestStub(apiFn) };
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

  test('squashCommitMessage alone, no mergeMethod, still reaches commit_title', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      squashCommitMessage: 'only message the caller gave'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('only message the caller gave');
    expect(body.merge_method).toBeUndefined();
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

  test('a message beginning with a newline strips the leading newline and extracts title', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: '\nBody text'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('Body text');
    expect(body.commit_message).toBeUndefined();
  });

  test('a message of only newlines omits commit_title', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: '\n\n'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBeUndefined();
    expect(body.commit_message).toBeUndefined();
  });
});

describe('GitHubProvider shouldRemoveSourceBranch (MAT-127)', () => {
  test('deletes the source ref after a successful merge', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'feature/x');

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    const deletion = calls.find(c => c.method === 'DELETE');
    expect(deletion?.path).toBe('/repos/acme/repo/git/refs/heads/feature%2Fx');
    // The delete must follow the merge PUT, not race or precede it: deleting a
    // branch that has not merged yet would delete unmerged work.
    const mergeIndex = calls.findIndex(c => c.path.endsWith('/merge'));
    const deleteIndex = calls.findIndex(c => c.method === 'DELETE');
    expect(mergeIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(mergeIndex);
  });

  test('sends no delete_branch field, which GitHub would ignore', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    expect(mergeBody(calls).delete_branch).toBeUndefined();
  });

  test('deletes nothing when the caller did not ask', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: false
    });

    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  test('an already-deleted ref is the requested end state, not an error', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 422,
          json: async () => ({}),
          text: async () => '{"message":"Reference does not exist"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      // The DELETE failed, so we verify by checking if the ref still exists.
      // Return 404 (ref not found) to indicate it is gone.
      if (method === 'GET' && path.includes('git/ref/heads/')) {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '{}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    // The repository-level delete_branch_on_merge setting races this call, so
    // "already gone" has to read as success or every merge on a repo with that
    // setting enabled would throw.
    const pr = await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    expect(pr.iid).toBe(1);
    // The deletion must still have been attempted: the GET verified the ref was
    // actually gone before returning success.
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
    expect(calls.some(c => c.method === 'GET' && c.path.includes('git/ref/heads/'))).toBe(true);
  });

  test('a real deletion failure throws rather than reporting a silent no-op', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider);
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => '{"message":"Protected branch"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/could not delete source branch/);
  });

  test('DELETE fails with 409 while the ref still exists, must throw and name the branch', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'main-protected');
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 409,
          json: async () => ({}),
          text: async () => '{"message":"Reference cannot be deleted"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      // GET check: the ref still exists (200).
      if (method === 'GET' && path.includes('git/ref/heads/')) {
        calls.push({ method, path, body: undefined });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/could not delete source branch "main-protected"/);
  });

  test('DELETE fails with 422 while the ref is already gone, must resolve', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 422,
          json: async () => ({}),
          text: async () => '{"message":"Reference does not exist"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      // GET check: the ref is already gone (404).
      if (method === 'GET' && path.includes('git/ref/heads/')) {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '{}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    const pr = await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    expect(pr.iid).toBe(1);
    // The DELETE and GET verification must both have been attempted.
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
    expect(calls.some(c => c.method === 'GET' && c.path.includes('git/ref/heads/'))).toBe(true);
  });

  test('DELETE fails and the existence check itself fails, must throw', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => '{"message":"Server error"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      // GET check also fails (we cannot verify the end state).
      if (method === 'GET' && path.includes('git/ref/heads/')) {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => '{"message":"Server error"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/could not delete source branch/);
  });

  test('DELETE returns 422 (ambiguous) while the ref is still present, must throw', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'release/v1.2.3');
    const api = (provider as any).api;
    overrideApi(provider, async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 422,
          json: async () => ({}),
          text: async () => '{"message":"Reference cannot be deleted"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      // GET check: the ref still exists. 422 is ambiguous (can mean either
      // "reference does not exist" or "deletion blocked"), so the fix must
      // verify the actual state. If it still exists, this is a failure.
      if (method === 'GET' && path.includes('git/ref/heads/')) {
        calls.push({ method, path, body: undefined });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    });

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/could not delete source branch "release\/v1\.2\.3"/);

    // Assert that the existence check was performed, so a future revert to
    // status-code-only inference (which would swallow 422) would be caught.
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
    expect(calls.some(c => c.method === 'GET' && c.path.includes('git/ref/heads/'))).toBe(true);
  });
});

describe('GitHubProvider shouldRemoveSourceBranch targets the head repository (fork PRs)', () => {
  test('same-repo PR deletes against the base repo, unchanged behavior', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'feature/x', 'acme/repo');

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    const deletion = calls.find(c => c.method === 'DELETE');
    expect(deletion?.path).toBe('/repos/acme/repo/git/refs/heads/feature%2Fx');
  });

  test('fork PR deletes against the fork\'s full_name, not the base repo', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'feature/x', 'contributor/repo-fork');

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    const deletion = calls.find(c => c.method === 'DELETE');
    expect(deletion?.path).toBe(
      '/repos/contributor/repo-fork/git/refs/heads/feature%2Fx'
    );
    // Must not have targeted the base repo for the fork's branch.
    expect(
      calls.some(c => c.method === 'DELETE' && c.path.startsWith('/repos/acme/repo/'))
    ).toBe(false);
  });

  test('a PR whose head.repo is null throws rather than guessing', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 'feature/x', null);

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/head repository is unknown/);
  });
});
