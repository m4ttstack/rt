/**
 * Unit tests for GitHubProvider.fetchPullRequestByBranch:
 *  - fork PR fallback when the head-filtered fast path (base-owner scoped)
 *    finds nothing
 *  - MRState -> GitHub `state` query param mapping
 *  - the 2-arg call shape still works (default state 'opened')
 *
 * `(provider as any).octokit.request` is monkey-patched so no network is
 * involved; `fetchSingleMR` is stubbed to avoid needing a full GHPullRequest
 * fixture.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { ForgeLogger } from '../src/logger.ts';

/** Installs an octokit.request stub and returns the paths (route minus method) it saw. */
function stubRequest(
  provider: GitHubProvider,
  answer: (path: string) => unknown
): string[] {
  const calls: string[] = [];
  (provider as any).octokit = {
    request: async (route: string) => {
      const path = route.slice(route.indexOf(' ') + 1);
      calls.push(path);
      return { status: 200, headers: {}, data: answer(path) };
    }
  };
  return calls;
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

function nonMatchingPage(count: number, startId: number) {
  return Array.from({ length: count }, (_, i) => forkPR(startId + i, `unrelated-${startId + i}`));
}

function fakeLogger(): ForgeLogger & { calls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> } {
  const calls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
  return {
    calls,
    debug(msg, meta) {
      calls.push({ level: 'debug', msg, meta });
    },
    info(msg, meta) {
      calls.push({ level: 'info', msg, meta });
    },
    warn(msg, meta) {
      calls.push({ level: 'warn', msg, meta });
    },
    error(msg, meta) {
      calls.push({ level: 'error', msg, meta });
    }
  };
}

describe('GitHubProvider.fetchPullRequestByBranch', () => {
  test('falls back to listing + client-side head.ref match when the head-filtered query is empty (fork PR)', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const fork = forkPR(42, 'feature/fork-branch');

    const calls = stubRequest(provider, (path) => {
      if (path.includes('head=')) {
        return []; // fast path: no match (fork PR)
      }
      if (path.includes('/pulls?state=')) {
        return [forkPR(1, 'unrelated'), fork];
      }
      throw new Error(`unexpected path: ${path}`);
    });

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

    const calls = stubRequest(provider, () => []);
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

    const calls = stubRequest(provider, () => []);
    (provider as any).fetchSingleMR = async () => null;

    await provider.fetchPullRequestByBranch('acme/repo', 'some-branch');

    const headCall = calls.find((c) => c.includes('head='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain('state=open');
    expect(headCall).not.toContain('state=opened');
  });

  test('fallback paginates past page 1: a match on page 2 is found', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const match = forkPR(9999, 'feature/deep-fork-branch');

    const calls = stubRequest(provider, (path) => {
      if (path.includes('head=')) {
        return []; // fast path: no match
      }
      if (path.includes('page=2')) {
        return [...nonMatchingPage(5, 5000), match];
      }
      if (path.includes('/pulls?state=')) {
        // page 1 (or unspecified page=1): full page, no match -> forces page 2
        return nonMatchingPage(100, 1);
      }
      throw new Error(`unexpected path: ${path}`);
    });

    let fetchSingleMRCall: [string, number] | null = null;
    (provider as any).fetchSingleMR = async (projectPath: string, mrIid: number) => {
      fetchSingleMRCall = [projectPath, mrIid];
      return { iid: mrIid } as any;
    };

    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'feature/deep-fork-branch'
    );

    const listCalls = calls.filter((c) => c.includes('/pulls?state='));
    expect(listCalls.some((c) => c.includes('page=2'))).toBe(true);
    expect(fetchSingleMRCall).toEqual(['acme/repo', 9999]);
    expect(result).toEqual({ iid: 9999 } as any);
  });

  test('fallback stops after 5 full pages with no match, returns null, and warns about the page limit', async () => {
    const logger = fakeLogger();
    const provider = new GitHubProvider('https://github.com', 'tok', { logger });

    const calls = stubRequest(provider, (path) => {
      if (path.includes('head=')) {
        return [];
      }
      if (path.includes('/pulls?state=')) {
        // Every page is a full, non-matching page of 100.
        return nonMatchingPage(100, 1);
      }
      throw new Error(`unexpected path: ${path}`);
    });

    let fetchSingleMRCalled = false;
    (provider as any).fetchSingleMR = async () => {
      fetchSingleMRCalled = true;
      return null;
    };

    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'never-found-branch'
    );

    const listCalls = calls.filter((c) => c.includes('/pulls?state='));
    expect(listCalls.length).toBe(5);
    expect(fetchSingleMRCalled).toBe(false);
    expect(result).toBeNull();

    const warnCall = logger.calls.find(
      (c) => c.level === 'warn' && c.msg.includes('fetchPullRequestByBranch: fallback scan hit page limit')
    );
    expect(warnCall).toBeDefined();
    expect(warnCall?.meta).toEqual({
      projectPath: 'acme/repo',
      sourceBranch: 'never-found-branch'
    });
  });
});
