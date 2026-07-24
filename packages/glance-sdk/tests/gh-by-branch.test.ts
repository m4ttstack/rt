/**
 * Unit tests for GitHubProvider.fetchPullRequestByBranch:
 *  - fork PR fallback when the head-filtered fast path (base-owner scoped)
 *    finds nothing
 *  - MRState -> GitHub `state` query param mapping
 *  - the 2-arg call shape still works (default state 'opened')
 *
 * `(provider as any).api` is monkey-patched so no network is involved;
 * `fetchSingleMR` is stubbed to avoid needing a full GHPullRequest fixture.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  } as unknown as Response;
}

function forkPR(number: number, headRef: string) {
  return {
    id: number,
    number,
    title: `PR ${number}`,
    body: null,
    state: 'open',
    draft: false,
    merged_at: null,
    html_url: `https://github.com/acme/repo/pull/${number}`,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    head: { sha: 'abc123', ref: headRef },
    base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
    user: { id: 999, login: 'forker', avatar_url: '' },
    assignees: [],
    requested_reviewers: [],
    labels: []
  };
}

describe('GitHubProvider.fetchPullRequestByBranch', () => {
  test('falls back to listing + client-side head.ref match when the head-filtered query is empty (fork PR)', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls: string[] = [];
    const fork = forkPR(42, 'feature/fork-branch');

    (provider as any).api = async (_method: string, path: string) => {
      calls.push(path);
      if (path.includes('head=')) {
        return jsonResponse([]); // fast path: no match (fork PR)
      }
      if (path.includes('/pulls?state=')) {
        return jsonResponse([forkPR(1, 'unrelated'), fork]);
      }
      throw new Error(`unexpected path: ${path}`);
    };

    let fetchSingleMRCall: [string, number] | null = null;
    (provider as any).fetchSingleMR = async (projectPath: string, mrIid: number) => {
      fetchSingleMRCall = [projectPath, mrIid];
      return { iid: mrIid } as any;
    };

    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'feature/fork-branch'
    );

    expect(calls.some((c) => c.includes('head='))).toBe(true);
    expect(calls.some((c) => c.includes('/pulls?state='))).toBe(true);
    expect(fetchSingleMRCall).toEqual(['acme/repo', 42]);
    expect(result).toEqual({ iid: 42 } as any);
  });

  test("state 'merged' maps to state=closed in the fallback list request", async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls: string[] = [];

    (provider as any).api = async (_method: string, path: string) => {
      calls.push(path);
      if (path.includes('head=')) return jsonResponse([]);
      return jsonResponse([]);
    };
    (provider as any).fetchSingleMR = async () => null;

    await provider.fetchPullRequestByBranch('acme/repo', 'some-branch', 'merged');

    const headCall = calls.find((c) => c.includes('head='));
    const listCall = calls.find((c) => c.includes('/pulls?state='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain('state=closed');
    expect(listCall).toBeDefined();
    expect(listCall).toContain('state=closed');
  });

  test('2-arg call still works: default state is opened -> state=open in the URL', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls: string[] = [];

    (provider as any).api = async (_method: string, path: string) => {
      calls.push(path);
      return jsonResponse([]);
    };
    (provider as any).fetchSingleMR = async () => null;

    await provider.fetchPullRequestByBranch('acme/repo', 'some-branch');

    const headCall = calls.find((c) => c.includes('head='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain('state=open');
    expect(headCall).not.toContain('state=opened');
  });
});
