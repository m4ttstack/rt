/**
 * Unit tests for GitHubProvider.fetchPullRequests (MAT-13).
 *
 * The method used to take no parameter at all, so every FetchPullRequestsOptions
 * a caller passed was discarded and `is:open` was hardcoded. These cover each
 * option field: state (single and multi), iids, authorUsernames, projectPath,
 * updatedAfter, listWeight.
 *
 * `currentUser`, `searchPRs`, `fetchPR`, `listRepoPRs`, and `fetchCheckRuns`
 * call `octokit.request` directly; `fetchReviews` calls `octokit.paginate`.
 * `(provider as any).api` and `.graphql` are monkey-patched as before, and
 * `toOctokitRequestStub`/`toOctokitPaginateStub` adapt the same Response-shaped
 * stub function onto both seams so every existing path-based assertion keeps
 * its meaning.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';

const API = 'https://api.github.com';

function jsonResponse(body: unknown, ok = true, status?: number): Response {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null }
  } as unknown as Response;
}

/**
 * Adapts an `api()`-shaped stub (method, path) => Response into an
 * `octokit.request(route)` stub, so one fake transport body answers both
 * seams identically: `RequestError` on a non-ok status, `{status, headers,
 * data}` on success, exactly as the real client does.
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
 * Adapts the same `api()`-shaped stub onto `octokit.paginate(route, params)`:
 * fills the route template's `{owner}`/`{repo}`/etc placeholders from
 * `params`, appends `per_page`, and returns the body array directly (what
 * `paginate` resolves to), instead of the `{status, headers, data}` shape
 * `octokit.request` resolves to.
 */
function toOctokitPaginateStub(
  apiFn: (method: string, path: string, body?: unknown) => Promise<Response>
) {
  return async (route: string, params?: Record<string, unknown>) => {
    const spaceIdx = route.indexOf(' ');
    const method = route.slice(0, spaceIdx);
    let path = route
      .slice(spaceIdx + 1)
      .replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key] ?? ''));
    if (params?.per_page !== undefined) {
      path += `${path.includes('?') ? '&' : '?'}per_page=${params.per_page}`;
    }
    const res = await apiFn(method, path);
    if (!res.ok) {
      throw new RequestError(await res.text(), res.status, {
        request: { method, url: `${API}${path}`, headers: {} },
        response: { status: res.status, url: '', headers: {}, data: await res.json() }
      });
    }
    return await res.json();
  };
}

type FakePR = ReturnType<typeof ghPR>;

function ghPR(
  number: number,
  over: Partial<{
    state: string;
    merged_at: string | null;
    updated_at: string;
    login: string;
    base: {
      ref: string;
      repo: { id: number; full_name: string; default_branch?: string };
    };
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
    base: over.base ?? { ref: 'main', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } },
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
  const apiFn = async (_method: string, path: string) => {
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
      return pr ? jsonResponse(pr) : jsonResponse({}, false, 404);
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
  (provider as any).api = apiFn;
  (provider as any).octokit = {
    request: toOctokitRequestStub(apiFn),
    paginate: toOctokitPaginateStub(apiFn)
  };
  (provider as any).graphql = async () => ({ nodes: [] });
  return calls;
}

function searchQueries(calls: string[]): string[] {
  return calls
    .filter((c) => c.startsWith('/search/issues'))
    .map((c) => decodeURIComponent(c));
}

/** The `/repos/{path}/pulls/{n}` detail GETs, one entry per request made. */
function detailCalls(calls: string[]): string[] {
  return calls.filter((c) => /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(c));
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

  test("state ['opened','merged'] runs one search per qualifier, never an unqualified one", async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const open = ghPR(1);
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const closed = ghPR(3, { state: 'closed' });
    const calls = install(provider, [open, merged, closed]);

    const prs = await provider.fetchPullRequests({ state: ['opened', 'merged'] });

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2]);
    expect(prs.find((p) => p.iid === 2)?.state).toBe('merged');

    // `is:open is:closed` would AND to nothing, so the two states are two
    // searches. Dropping the qualifier instead (what this used to do) matches
    // every PR the user ever authored, all time.
    const queries = searchQueries(calls);
    expect(queries.length).toBe(6);
    expect(queries.filter((q) => q.includes('is:open is:pr')).length).toBe(3);
    expect(queries.filter((q) => q.includes('is:closed is:pr')).length).toBe(3);
    expect(queries.every((q) => q.includes('is:open') || q.includes('is:closed'))).toBe(true);
    for (const involvement of ['author:@me', 'review-requested:@me', 'assignee:@me']) {
      expect(queries.filter((q) => q.includes(involvement)).length).toBe(2);
    }
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

  test('an empty iids list asks for nothing, not for the whole repository', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests({
      iids: [],
      projectPath: 'acme/repo'
    });

    expect(prs).toEqual([]);
    expect(searchQueries(calls)).toEqual([]);
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

describe('GitHubProvider.fetchPullRequests: request cost', () => {
  test('a PR that three involvement searches match costs one detail fetch', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    // `install` answers every search with every PR, so all three involvement
    // searches match all three PRs: 9 hits, 3 unique.
    const calls = install(provider, [ghPR(1), ghPR(2), ghPR(3)]);

    const prs = await provider.fetchPullRequests();

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2, 3]);
    expect(detailCalls(calls).length).toBe(3);
    expect(new Set(detailCalls(calls)).size).toBe(3);
  });

  test('roles still accumulate across the searches the dedupe collapsed', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.roles.sort()).toEqual(['assignee', 'author', 'reviewer']);
  });

  test('a mixed-state request still fetches each unique PR once', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const open = ghPR(1);
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const calls = install(provider, [open, merged]);

    await provider.fetchPullRequests({ state: ['opened', 'merged'] });

    // 6 searches over 2 matching PRs, and 2 detail GETs.
    expect(searchQueries(calls).length).toBe(6);
    expect(detailCalls(calls).length).toBe(2);
  });

  test('authorUsernames dedupes across authors before fetching details', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = install(provider, [ghPR(1), ghPR(2)]);

    const prs = await provider.fetchPullRequests({
      authorUsernames: ['ada', 'grace', 'linus'],
      projectPath: 'acme/repo'
    });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(searchQueries(calls).length).toBe(3);
    expect(detailCalls(calls).length).toBe(2);
  });

  test('detail fetches stay under the concurrency bound', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const prs = Array.from({ length: 40 }, (_, i) => ghPR(i + 1));
    install(provider, prs);

    let inFlight = 0;
    let peak = 0;
    const inner = (provider as any).octokit.request;
    (provider as any).octokit.request = async (route: string, params?: unknown) => {
      const path = route.slice(route.indexOf(' ') + 1);
      const isDetail = /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(path);
      if (!isDetail) return inner(route, params);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        return await inner(route, params);
      } finally {
        inFlight--;
      }
    };

    const result = await provider.fetchPullRequests();

    expect(result.length).toBe(40);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});

/**
 * A transport whose searches never run out: every page is a full 100 items
 * cycling `prs`, so only the page cap stops the walk.
 */
function installFullSearchPages(provider: GitHubProvider, prs: FakePR[]): string[] {
  const calls: string[] = [];
  const apiFn = async (_method: string, path: string) => {
    calls.push(path);
    if (path.startsWith('/user')) {
      return jsonResponse({ id: 999, login: 'octocat', avatar_url: null });
    }
    if (path.startsWith('/search/issues')) {
      return jsonResponse({
        items: Array.from({ length: 100 }, (_, i) => searchItem(prs[i % prs.length]!))
      });
    }
    const single = path.match(/^\/repos\/([^?]+)\/pulls\/(\d+)$/);
    if (single) {
      const pr = prs.find((p) => p.number === Number(single[2]));
      return pr ? jsonResponse(pr) : jsonResponse({}, false, 404);
    }
    if (path.includes('/reviews?')) return jsonResponse([]);
    if (path.includes('/check-runs')) return jsonResponse({ check_runs: [] });
    throw new Error(`unexpected path: ${path}`);
  };
  (provider as any).api = apiFn;
  (provider as any).octokit = {
    request: toOctokitRequestStub(apiFn),
    paginate: toOctokitPaginateStub(apiFn)
  };
  (provider as any).graphql = async () => ({ nodes: [] });
  return calls;
}

describe('GitHubProvider.fetchPullRequests: truncation and failures are observable', () => {
  test('the search page cap reaches the caller, not just the logger', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = installFullSearchPages(provider, [ghPR(1), ghPR(2)]);
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider.fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    // 3 involvement searches, 5 pages each, and the same 2 PRs throughout.
    expect(searchQueries(calls).length).toBe(15);
    expect(prs.map((p) => p.iid)).toEqual([1, 2]);

    const capped = warnings.filter((w) => w.kind === 'page-cap');
    expect(capped.length).toBe(3);
    expect(capped[0]?.source).toBe('search');
    expect(capped[0]?.message).toContain('5-page cap');
  });

  test('a quiet fetch means nothing was truncated', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)]);
    const warnings: FetchPullRequestsWarning[] = [];

    await provider.fetchPullRequests({ onWarning: (w) => warnings.push(w) });

    expect(warnings).toEqual([]);
  });

  test('the repository listing page cap reaches the caller', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls: string[] = [];
    const apiFn = async (_method: string, path: string) => {
      calls.push(path);
      if (path.startsWith('/user')) {
        return jsonResponse({ id: 999, login: 'octocat', avatar_url: null });
      }
      if (/^\/repos\/acme\/repo\/pulls\?/.test(path)) {
        const page = Number(
          new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? '1'
        );
        // One open PR per page and 99 closed ones: the walk continues because
        // the page is full, not because the caller wanted more.
        return jsonResponse([
          ghPR(page * 1000),
          ...Array.from({ length: 99 }, (_, i) =>
            ghPR(page * 1000 + i + 1, { state: 'closed' })
          )
        ]);
      }
      if (path.includes('/reviews?')) return jsonResponse([]);
      if (path.includes('/check-runs')) return jsonResponse({ check_runs: [] });
      throw new Error(`unexpected path: ${path}`);
    };
    (provider as any).api = apiFn;
    (provider as any).octokit = {
    request: toOctokitRequestStub(apiFn),
    paginate: toOctokitPaginateStub(apiFn)
  };
    (provider as any).graphql = async () => ({ nodes: [] });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider.fetchPullRequests({
      projectPath: 'acme/repo',
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.length).toBe(20);
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.kind).toBe('page-cap');
    expect(warnings[0]?.source).toBe('list');
    expect(warnings[0]?.target).toBe('acme/repo');
  });

  test('a rate-limited detail fetch is reported instead of vanishing', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1), ghPR(2)]);
    const inner = (provider as any).octokit.request;
    (provider as any).octokit.request = async (route: string, params?: unknown) => {
      const path = route.slice(route.indexOf(' ') + 1);
      if (path === '/repos/acme/repo/pulls/2') {
        throw new RequestError('API rate limit exceeded', 403, {
          request: { method: 'GET', url: `${API}${path}`, headers: {} },
          response: {
            status: 403,
            url: '',
            headers: {},
            data: { message: 'API rate limit exceeded' }
          }
        });
      }
      return inner(route, params);
    };
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider.fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'detail',
      status: 403,
      target: 'acme/repo#2'
    });
  });

  test('a PR GitHub says is gone is not reported as a failure', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    // Search matches PR 9, which the detail endpoint 404s for.
    install(provider, [ghPR(1)]);
    const inner = (provider as any).octokit.request;
    (provider as any).octokit.request = async (route: string, params?: unknown) => {
      const path = route.slice(route.indexOf(' ') + 1);
      if (path.startsWith('/search/issues')) {
        return { status: 200, headers: {}, data: { items: [searchItem(ghPR(9))] } };
      }
      return inner(route, params);
    };
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider.fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('an onWarning that throws does not fail the fetch', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    installFullSearchPages(provider, [ghPR(1)]);

    const prs = await provider.fetchPullRequests({
      onWarning: () => {
        throw new Error('consumer bug');
      }
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
  });
});

describe('GitHubProvider.fetchPullRequests: isStacked', () => {
  test('isStacked derives from base.ref vs default_branch', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const stacked = ghPR(7, {
      base: {
        ref: 'feat-parent',
        repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' }
      }
    });
    const plain = ghPR(8);
    const missingDefaultBranch = ghPR(9, {
      base: { ref: 'feat-x', repo: { id: 1, full_name: 'acme/repo' } }
    });
    install(provider, [stacked, plain, missingDefaultBranch]);

    const prs = await provider.fetchPullRequests({});

    expect(prs.find((p) => p.iid === 7)?.isStacked).toBe(true);
    expect(prs.find((p) => p.iid === 8)?.isStacked).toBe(false);
    expect(prs.find((p) => p.iid === 9)?.isStacked).toBe(false);
  });
});
