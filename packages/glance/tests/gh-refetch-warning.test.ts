#!/usr/bin/env bun
/**
 * MAT-143: `fetchSingleMR` and the mutation call sites built on it
 * (`createPullRequest`/`updatePullRequest`/`mergePullRequest`).
 *
 * `fetchSingleMR` has always resolved to `null` on any refetch failure, and
 * still does -- that return contract is shared with `fetchPullRequestByBranch`,
 * which degrades to `null` on its own failures the same way, so changing it
 * would break that caller's contract too. What was missing is a way for a
 * caller that DOES want to know why to find out: an optional `onWarning`
 * (mirroring `FetchPullRequestsOptions['onWarning']`) that fires with the
 * real failure before `fetchSingleMR` swallows it to `null`.
 *
 * The three mutation methods are why this exists: each used to throw the
 * same generic "... but failed to fetch it back" whether the PR was
 * rate-limited on the way back or had somehow genuinely vanished. That
 * message matches no live-harness pattern and reads as an unrelated hard
 * failure. These tests pin that the thrown message now says which one
 * actually happened.
 */
import { describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';

const API = 'https://api.github.com';

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
    labels: []
  };
}

function requestError(status: number, message: string): RequestError {
  return new RequestError(message, status, {
    request: { method: 'GET', url: `${API}/x`, headers: {} },
    response: { status, url: '', headers: {}, data: { message } }
  });
}

describe('GitHubProvider.fetchSingleMR: onWarning captures the real failure', () => {
  test('a rejected detail fetch reaches onWarning, not just the log', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: async () => {
        throw requestError(403, 'API rate limit exceeded');
      },
      paginate: async () => []
    };

    const warnings: FetchPullRequestsWarning[] = [];
    const pr = await provider.fetchSingleMR('acme/repo', 5, null, w =>
      warnings.push(w)
    );

    expect(pr).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'detail',
      status: 403,
      target: 'acme/repo#5'
    });
  });

  test('a rejected reviews fetch reaches onWarning too, distinct from a missing PR', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: async (route: string) => {
        const path = route.slice(route.indexOf(' ') + 1);
        if (path === '/repos/acme/repo/pulls/5') {
          return { status: 200, headers: {}, data: ghPR(5) };
        }
        if (path === '/user') {
          return { status: 200, headers: {}, data: { id: 1, login: 'me', avatar_url: null } };
        }
        throw new Error(`unexpected path: ${path}`);
      },
      paginate: async () => {
        throw requestError(403, 'API rate limit exceeded');
      }
    };
    (provider as any).graphql = async () => ({ nodes: [] });

    const warnings: FetchPullRequestsWarning[] = [];
    const pr = await provider.fetchSingleMR('acme/repo', 5, null, w =>
      warnings.push(w)
    );

    expect(pr).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.source).toBe('reviews');
    expect(warnings[0]?.target).toBe('acme/repo#5');
  });

  test('a transport failure fetching the reviews leg is tagged "reviews", not "detail"', async () => {
    // `fetchPR` and `fetchReviews` each handle their own `RequestError`s
    // internally and never let one reach `fetchSingleMR`'s catch. What
    // does reach it is the rarer case neither call handles: a thrown error
    // with no `.response` (DNS failure, connection reset), which both
    // legs rethrow rather than swallow. Before this fix, one catch block
    // wrapped both `fetchPR` and `enrich`, so a transport failure on the
    // *reviews* leg still got tagged `source: 'detail'` -- correct-looking
    // for the wrong reason, since the tag was really just "whichever leg
    // this method happens to fetch first." Two separate catches, one per
    // leg, is what makes the tag actually name where the failure was.
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: async (route: string) => {
        const path = route.slice(route.indexOf(' ') + 1);
        if (path === '/repos/acme/repo/pulls/5') {
          return { status: 200, headers: {}, data: ghPR(5) };
        }
        if (path === '/user') {
          return { status: 200, headers: {}, data: { id: 1, login: 'me', avatar_url: null } };
        }
        throw new Error(`unexpected path: ${path}`);
      },
      paginate: async () => {
        // No `.response`: a transport failure, not an HTTP result GitHub
        // actually returned -- exactly what `fetchReviews` rethrows rather
        // than converting to a warning itself.
        throw new Error('socket hang up');
      }
    };
    (provider as any).graphql = async () => ({ nodes: [] });

    const warnings: FetchPullRequestsWarning[] = [];
    const pr = await provider.fetchSingleMR('acme/repo', 5, null, w =>
      warnings.push(w)
    );

    expect(pr).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.source).toBe('reviews');
  });

  test('a transport failure fetching the detail leg is tagged "detail"', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: async () => {
        throw new Error('socket hang up');
      },
      paginate: async () => []
    };

    const warnings: FetchPullRequestsWarning[] = [];
    const pr = await provider.fetchSingleMR('acme/repo', 5, null, w =>
      warnings.push(w)
    );

    expect(pr).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.source).toBe('detail');
  });

  test('no onWarning supplied still degrades to null (fetchPullRequestByBranch relies on this)', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = {
      request: async () => {
        throw requestError(500, 'boom');
      },
      paginate: async () => []
    };

    const pr = await provider.fetchSingleMR('acme/repo', 5, null);
    expect(pr).toBeNull();
  });
});

describe('GitHubProvider mutation refetch messages say what actually happened (MAT-143 step 3)', () => {
  function stubMutationRequest(created: ReturnType<typeof ghPR>) {
    return async (route: string) => {
      return { status: 200, headers: {}, data: created };
    };
  }

  test('createPullRequest: a rate-limited refetch names the real cause, not the generic message', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = { request: stubMutationRequest(ghPR(42)) };
    (provider as any).fetchSingleMR = async (
      _p: string,
      _iid: number,
      _u: number | null,
      onWarning?: (w: FetchPullRequestsWarning) => void
    ) => {
      onWarning?.({
        kind: 'request-failed',
        source: 'reviews',
        status: 403,
        target: 'acme/repo#42',
        message: 'GitHub returned HTTP 403 fetching reviews for acme/repo#42; its approval count could not be verified, so it is missing from this result.'
      });
      return null;
    };

    await expect(
      provider.createPullRequest({
        projectPath: 'acme/repo',
        title: 'x',
        sourceBranch: 'feat',
        targetBranch: 'main'
      })
    ).rejects.toThrow(/HTTP 403 fetching reviews/);
  });

  test('createPullRequest: no captured warning reads as "not found", never the old generic wording', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = { request: stubMutationRequest(ghPR(42)) };
    (provider as any).fetchSingleMR = async () => null;

    let message = '';
    try {
      await provider.createPullRequest({
        projectPath: 'acme/repo',
        title: 'x',
        sourceBranch: 'feat',
        targetBranch: 'main'
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toBe('Created PR but failed to fetch it back');
    expect(message).toContain('not found when refetched');
  });

  test('updatePullRequest: the thrown message carries the captured warning', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = { request: stubMutationRequest(ghPR(7)) };
    (provider as any).fetchSingleMR = async (
      _p: string,
      _iid: number,
      _u: number | null,
      onWarning?: (w: FetchPullRequestsWarning) => void
    ) => {
      onWarning?.({
        kind: 'request-failed',
        source: 'detail',
        status: 500,
        target: 'acme/repo#7',
        message: 'GitHub returned HTTP 500 for acme/repo#7; it is missing from this result.'
      });
      return null;
    };

    await expect(
      provider.updatePullRequest('acme/repo', 7, { title: 'new title' })
    ).rejects.toThrow(/HTTP 500 for acme\/repo#7/);
  });

  test('mergePullRequest: the thrown message carries the captured warning', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    (provider as any).octokit = { request: stubMutationRequest(ghPR(9)) };
    (provider as any).fetchSingleMR = async (
      _p: string,
      _iid: number,
      _u: number | null,
      onWarning?: (w: FetchPullRequestsWarning) => void
    ) => {
      onWarning?.({
        kind: 'request-failed',
        source: 'reviews',
        status: 403,
        target: 'acme/repo#9',
        message: 'GitHub returned HTTP 403 fetching reviews for acme/repo#9; its approval count could not be verified, so it is missing from this result.'
      });
      return null;
    };

    await expect(provider.mergePullRequest('acme/repo', 9)).rejects.toThrow(
      /HTTP 403 fetching reviews/
    );
  });
});
