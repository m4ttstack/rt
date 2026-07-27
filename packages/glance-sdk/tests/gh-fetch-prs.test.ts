/**
 * Unit tests for GitHubProvider.fetchPullRequests (MAT-13).
 *
 * The method used to take no parameter at all, so every FetchPullRequestsOptions
 * a caller passed was discarded and `is:open` was hardcoded. These cover each
 * option field: state (single and multi), iids, authorUsernames, projectPath,
 * updatedAfter, listWeight.
 *
 * `(provider as any).api` and `.graphql` are monkey-patched, so no network is
 * involved.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const API = 'https://api.github.com';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null }
  } as unknown as Response;
}

type FakePR = ReturnType<typeof ghPR>;

function ghPR(
  number: number,
  over: Partial<{
    state: string;
    merged_at: string | null;
    updated_at: string;
    login: string;
  }> = {}
) {
  return {
    id: number * 10,
    node_id: `PR_node_${number}`,
    number,
    title: `PR ${number}`,
    body: null,
    state: over.state ?? 'open',
    draft: false,
    merged_at: over.merged_at ?? null,
    html_url: `https://github.com/acme/repo/pull/${number}`,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: over.updated_at ?? '2026-07-10T00:00:00Z',
    head: { sha: `sha${number}`, ref: `feature/${number}` },
    base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
    user: { id: 999, login: over.login ?? 'octocat', avatar_url: null },
    assignees: [],
    requested_reviewers: [],
    labels: []
  };
}

function searchItem(pr: FakePR) {
  return {
    number: pr.number,
    state: pr.state,
    updated_at: pr.updated_at,
    repository_url: `${API}/repos/acme/repo`,
    pull_request: { url: '', merged_at: pr.merged_at }
  };
}

/**
 * Route the provider's REST calls at `prs`. Search returns every PR on page 1
 * regardless of qualifiers, so the client-side filtering is what the state
 * assertions actually exercise.
 */
function install(provider: GitHubProvider, prs: FakePR[]): string[] {
  const calls: string[] = [];
  (provider as any).api = async (_method: string, path: string) => {
    calls.push(path);
    if (path.startsWith('/user')) {
      return jsonResponse({ id: 999, login: 'octocat', avatar_url: null });
    }
    if (path.startsWith('/search/issues')) {
      const page = Number(
        new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? '1'
      );
      return jsonResponse({ items: page === 1 ? prs.map(searchItem) : [] });
    }
    const single = path.match(/^\/repos\/([^?]+)\/pulls\/(\d+)$/);
    if (single) {
      const pr = prs.find((p) => p.number === Number(single[2]));
      return pr ? jsonResponse(pr) : jsonResponse({}, false);
    }
    if (path.includes('/reviews?')) return jsonResponse([]);
    if (path.includes('/check-runs')) return jsonResponse({ check_runs: [] });
    if (/^\/repos\/[^/]+\/[^/]+\/pulls\?/.test(path)) {
      const page = Number(
        new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? '1'
      );
      return jsonResponse(page === 1 ? prs : []);
    }
    throw new Error(`unexpected path: ${path}`);
  };
  (provider as any).graphql = async () => ({ nodes: [] });
  return calls;
}

function searchQueries(calls: string[]): string[] {
  return calls
    .filter((c) => c.startsWith('/search/issues'))
    .map((c) => decodeURIComponent(c));
}

describe('GitHubProvider.fetchPullRequests: state', () => {
  test('no options: open PRs only, is:open on every search', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests();

    expect(prs.map((p) => p.iid)).toEqual([1]);
    const queries = searchQueries(calls);
    expect(queries.length).toBe(3);
    expect(queries.every((q) => q.includes('is:open is:pr'))).toBe(true);
  });

  test("state 'merged' searches is:closed and drops closed-unmerged PRs", async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const closed = ghPR(3, { state: 'closed' });
    const calls = install(provider, [merged, closed]);

    const prs = await provider.fetchPullRequests({ state: 'merged' });

    expect(prs.map((p) => p.iid)).toEqual([2]);
    expect(prs[0]?.state).toBe('merged');
    expect(searchQueries(calls).every((q) => q.includes('is:closed'))).toBe(true);
  });

  test("state ['opened','merged'] returns both, without a state qualifier (MAT-13)", async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const open = ghPR(1);
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const closed = ghPR(3, { state: 'closed' });
    const calls = install(provider, [open, merged, closed]);

    const prs = await provider.fetchPullRequests({ state: ['opened', 'merged'] });

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2]);
    expect(prs.find((p) => p.iid === 2)?.state).toBe('merged');
    // `is:open is:closed` would AND to nothing, so neither qualifier is sent.
    const queries = searchQueries(calls);
    expect(queries.some((q) => q.includes('is:open') || q.includes('is:closed'))).toBe(false);
  });

  test('a closed-unmerged PR is excluded from a merged-only request', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(3, { state: 'closed' })]);

    expect(await provider.fetchPullRequests({ state: 'merged' })).toEqual([]);
    expect(
      (await provider.fetchPullRequests({ state: 'closed' })).map((p) => p.iid)
    ).toEqual([3]);
  });
});

describe('GitHubProvider.fetchPullRequests: repository modes', () => {
  test('iids + projectPath fetches those PRs by number and skips search', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1), ghPR(7)]);

    const prs = await provider.fetchPullRequests({
      iids: [7],
      projectPath: 'acme/repo'
    });

    expect(prs.map((p) => p.iid)).toEqual([7]);
    expect(searchQueries(calls)).toEqual([]);
    expect(calls).toContain('/repos/acme/repo/pulls/7');
  });

  test('iids without projectPath throws instead of silently ignoring it', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)]);

    await expect(provider.fetchPullRequests({ iids: [1] })).rejects.toThrow(
      /`iids` requires `projectPath`/
    );
  });

  test('authorUsernames + projectPath searches once per author', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests({
      authorUsernames: ['ada', 'grace'],
      projectPath: 'acme/repo'
    });

    // Both searches return PR 1; the result is deduped.
    expect(prs.map((p) => p.iid)).toEqual([1]);
    const queries = searchQueries(calls);
    expect(queries.length).toBe(2);
    expect(queries.some((q) => q.includes('repo:acme/repo author:ada'))).toBe(true);
    expect(queries.some((q) => q.includes('repo:acme/repo author:grace'))).toBe(true);
  });

  test('authorUsernames without projectPath throws', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)]);

    await expect(
      provider.fetchPullRequests({ authorUsernames: ['ada'] })
    ).rejects.toThrow(/`authorUsernames` requires `projectPath`/);
  });

  test('projectPath alone lists the repository instead of searching', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1), ghPR(2)]);

    const prs = await provider.fetchPullRequests({ projectPath: 'acme/repo' });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(searchQueries(calls)).toEqual([]);
    const listCall = calls.find((c) => c.startsWith('/repos/acme/repo/pulls?'));
    expect(listCall).toContain('state=open');
    expect(listCall).toContain('per_page=100');
  });

  test('projectPath with multiple states lists state=all', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [
      ghPR(1),
      ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' })
    ]);

    const prs = await provider.fetchPullRequests({
      projectPath: 'acme/repo',
      state: ['opened', 'merged']
    });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(calls.find((c) => c.startsWith('/repos/acme/repo/pulls?'))).toContain(
      'state=all'
    );
  });
});

describe('GitHubProvider.fetchPullRequests: updatedAfter and listWeight', () => {
  test('updatedAfter drops older PRs and narrows the search', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const fresh = ghPR(1, { updated_at: '2026-07-20T00:00:00Z' });
    const stale = ghPR(2, { updated_at: '2026-06-01T00:00:00Z' });
    const calls = install(provider, [fresh, stale]);

    const prs = await provider.fetchPullRequests({
      updatedAfter: '2026-07-15T00:00:00Z'
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(searchQueries(calls).every((q) => q.includes('updated:>=2026-07-15'))).toBe(true);
  });

  test('a non-ISO updatedAfter is rejected rather than ignored', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)]);

    await expect(provider.fetchPullRequests({ updatedAfter: 'last tuesday' })).rejects.toThrow(
      /updatedAfter must be an ISO-8601 instant/
    );
  });

  test('listWeight skips the per-PR check-run fetch', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests({ listWeight: true });

    expect(prs[0]?.pipeline).toBeNull();
    expect(calls.some((c) => c.includes('/check-runs'))).toBe(false);
  });

  test('without listWeight the check runs are fetched', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1)]);

    await provider.fetchPullRequests();

    expect(calls.some((c) => c.includes('/check-runs'))).toBe(true);
  });
});
