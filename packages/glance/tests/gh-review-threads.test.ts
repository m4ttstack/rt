/**
 * Unit tests for unresolved review-thread counts on GitHub PRs (MAT-14).
 *
 * `toPullRequest` used to hardcode `unresolvedThreadCount: 0`, which reads as
 * "nothing outstanding" and silenced gitq's pre-rebase warning. The count now
 * comes from GraphQL `reviewThreads { isResolved }`, batched across the PRs of
 * one fetch, and is null (unknown) when it cannot be read.
 *
 * `(provider as any).api` is monkey-patched and the GraphQL transport is
 * replaced with a recorder, so no network is involved. `currentUser`,
 * `searchPRs`, and `fetchPR` now call `octokit.request` directly rather than
 * `api()`, so the same stub body is also adapted onto `octokit.request` via
 * `toOctokitRequestStub`.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
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

/**
 * Adapts an `api()`-shaped stub (method, path) => Response into an
 * `octokit.request(route)` stub: `RequestError` on a non-ok status,
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

function ghPR(number: number) {
  return {
    id: number * 10,
    node_id: `PR_node_${number}`,
    number,
    title: `PR ${number}`,
    body: null,
    state: 'open',
    draft: false,
    merged_at: null,
    html_url: `https://github.com/acme/repo/pull/${number}`,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-10T00:00:00Z',
    head: { sha: `sha${number}`, ref: `feature/${number}` },
    base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
    user: { id: 999, login: 'octocat', avatar_url: null },
    assignees: [],
    requested_reviewers: [],
    labels: [],
    mergeable_state: 'blocked'
  };
}

type ThreadNode = { id: string; resolved: boolean[]; hasNextPage?: boolean };

/**
 * Route REST at `prs` and GraphQL at `threads`. Returns the recorded GraphQL
 * variable batches so tests can assert how many round-trips it took.
 */
function install(
  provider: GitHubProvider,
  prs: ReturnType<typeof ghPR>[],
  threads: ThreadNode[] | null
): { batches: string[][] } {
  const apiFn = async (_method: string, path: string) => {
    if (path.startsWith('/user')) {
      return jsonResponse({ id: 999, login: 'octocat', avatar_url: null });
    }
    if (path.startsWith('/search/issues')) {
      const page = Number(
        new URLSearchParams(path.split('?')[1] ?? '').get('page') ?? '1'
      );
      return jsonResponse({
        items:
          page === 1
            ? prs.map((pr) => ({
                number: pr.number,
                state: pr.state,
                updated_at: pr.updated_at,
                repository_url: `${API}/repos/acme/repo`,
                pull_request: { url: '', merged_at: pr.merged_at }
              }))
            : []
      });
    }
    const single = path.match(/^\/repos\/([^?]+)\/pulls\/(\d+)$/);
    if (single) {
      const pr = prs.find((p) => p.number === Number(single[2]));
      return pr ? jsonResponse(pr) : jsonResponse({}, false);
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

  const batches: string[][] = [];
  (provider as any).graphql = async (
    _query: string,
    variables: Record<string, unknown>
  ) => {
    batches.push(variables.ids as string[]);
    if (threads === null) return null;
    return {
      nodes: threads.map((t) => ({
        id: t.id,
        reviewThreads: {
          pageInfo: { hasNextPage: t.hasNextPage ?? false },
          nodes: t.resolved.map((isResolved) => ({ isResolved }))
        }
      }))
    };
  };

  return { batches };
}

describe('GitHubProvider unresolved review threads', () => {
  test('a PR with unresolved threads reports how many are open', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], [
      { id: 'PR_node_1', resolved: [false, true, false] }
    ]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.unresolvedThreadCount).toBe(2);
  });

  test('a PR whose threads are all resolved reports zero', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], [{ id: 'PR_node_1', resolved: [true, true] }]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.unresolvedThreadCount).toBe(0);
  });

  test('a PR with no review threads reports zero', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], [{ id: 'PR_node_1', resolved: [] }]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.unresolvedThreadCount).toBe(0);
  });

  test('an unreadable count is null, never zero', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], null);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.unresolvedThreadCount).toBeNull();
  });

  test('a PR with more threads than one page is unknown, not undercounted', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], [
      { id: 'PR_node_1', resolved: [false], hasNextPage: true }
    ]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.unresolvedThreadCount).toBeNull();
  });

  test('a PR missing from the GraphQL response is unknown', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1), ghPR(2)], [
      { id: 'PR_node_1', resolved: [false] }
    ]);

    const prs = await provider.fetchPullRequests();

    expect(prs.find((p) => p.iid === 1)?.unresolvedThreadCount).toBe(1);
    expect(prs.find((p) => p.iid === 2)?.unresolvedThreadCount).toBeNull();
  });

  test('counts for a whole fetch are batched into one GraphQL request', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const prs = [ghPR(1), ghPR(2), ghPR(3)];
    const { batches } = install(
      provider,
      prs,
      prs.map((pr) => ({ id: pr.node_id, resolved: [false] }))
    );

    await provider.fetchPullRequests();

    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual(['PR_node_1', 'PR_node_2', 'PR_node_3']);
  });

  test('fetchSingleMR carries the count too', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(4)], [{ id: 'PR_node_4', resolved: [false, false] }]);

    const pr = await provider.fetchSingleMR('acme/repo', 4, null);

    expect(pr?.unresolvedThreadCount).toBe(2);
  });

  test('detailedMergeStatus stays null on GitHub (GitLab-only field)', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    install(provider, [ghPR(1)], [{ id: 'PR_node_1', resolved: [] }]);

    const prs = await provider.fetchPullRequests();

    expect(prs[0]?.detailedMergeStatus).toBeNull();
  });
});
