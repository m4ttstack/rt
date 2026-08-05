#!/usr/bin/env bun
/**
 * End-to-end coverage of GitHubProvider's api() over the real Octokit
 * transport, stubbing `fetch` itself rather than `api()`.
 *
 * Every other GitHub test in this suite monkey-patches `(provider as
 * any).api`, which means none of them ever exercise what Octokit actually
 * does to a path or a response: whether a colon in a query value survives
 * as a literal colon, whether a 204 comes back as a valid Response, whether
 * a 404 still resolves rather than throwing, and whether a transport-level
 * failure surfaces as itself rather than as a fabricated Response. Octokit
 * reads `globalThis.fetch` at call time (see
 * `@octokit/request/dist-src/fetch-wrapper.js`: `requestOptions.request?.fetch
 * || globalThis.fetch`), so stubbing the global here reaches all the way
 * through the real client built by `createGitHubClient`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { RequestError } from '@octokit/request-error';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Installs a fetch stub that records every requested URL and answers via `respond`. */
function stubFetch(respond: (url: string) => Response | Promise<Response>): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return urls;
}

/**
 * Runs `fn` with `setTimeout` collapsed to fire on the next tick regardless
 * of the requested delay, then restores the real one.
 *
 * The retry plugin (`@octokit/plugin-retry`, via Bottleneck) schedules its
 * backoff with a bare, module-scope `setTimeout` -- see `bottleneck/light.js`
 * -- so patching the global reaches it without needing to know Bottleneck's
 * internals. This exists so a test that drives a GET through exhausted
 * retries (which cannot get `retries: 0` the way a DELETE test can, since
 * that flag only applies to non-idempotent verbs) can assert on the outcome
 * without paying for the real quadratic backoff, which the test is not
 * verifying.
 */
async function withInstantTimers<T>(fn: () => Promise<T>): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    _ms?: number,
    ...args: unknown[]
  ) => realSetTimeout(callback, 0, ...args)) as typeof setTimeout;
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

describe('GitHubProvider transport (real Octokit, fetch stubbed)', () => {
  test('fetchPullRequestByBranch sends head=owner:branch intact, even when the branch contains a slash', async () => {
    // This is the regression case for the Octokit placeholder bug: Octokit's
    // endpoint parser (@octokit/endpoint) rewrites `:word` into a route
    // placeholder before the path is used, and an unmatched placeholder
    // expands to the empty string. Against the pre-fix call site (raw
    // `${owner}:${encodeURIComponent(branch)}`), the URL that actually
    // reaches fetch drops everything from the colon onward instead of
    // carrying `head=acme%3Afeature%2Fmy-branch`, so this assertion fails
    // against the unfixed code.
    const urls = stubFetch(() => jsonResponse([]));

    const provider = new GitHubProvider('https://github.com', 'tok');
    await provider.fetchPullRequestByBranch('acme/repo', 'feature/my-branch');

    const headCall = urls.find(u => u.includes('/pulls?head='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain(`head=${encodeURIComponent('acme:feature/my-branch')}`);
  });

  test('a 204 response is handled without throwing and constructs a Response with a null body', async () => {
    // `new Response("", { status: 204 })` is permitted by Bun but throws a
    // TypeError under Node, and Octokit's fetch wrapper hands back
    // `data: ""` for 204/205 either way. This assertion must hold on the
    // constructed Response's shape (status + null body), not merely on the
    // absence of a throw, since the throw itself only happens under Node
    // and this suite runs on Bun.
    stubFetch(() => new Response(null, { status: 204 }));

    const provider = new GitHubProvider('https://github.com', 'tok');
    const res = await (provider as any).api(
      'DELETE',
      '/repos/acme/repo/git/refs/heads/some-branch'
    );

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  test('a 404 through restRequest resolves with ok: false instead of throwing', async () => {
    // branchExists() in the live harness, and several call sites in this
    // provider, depend on a 404 coming back as a Response they can branch
    // on rather than as a thrown error.
    stubFetch(() => jsonResponse({ message: 'Not Found' }, 404));

    const provider = new GitHubProvider('https://github.com', 'tok');
    const res = await provider.restRequest('GET', '/repos/acme/repo/branches/missing');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  test('a transport-level failure (fetch rejects) propagates the original error rather than a synthetic 500', async () => {
    // Octokit's fetch wrapper turns a network-level throw into a
    // RequestError(message, 500, { request }) with no `response`. Turning
    // that into a fabricated 500 Response would make fetchAllPages's
    // `if (!res.ok) break` read a dropped connection mid-pagination as "no
    // more pages" and silently truncate results instead of surfacing the
    // failure.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    }) as typeof fetch;

    const provider = new GitHubProvider('https://github.com', 'tok');

    let caught: unknown;
    try {
      // DELETE is non-idempotent, so this fails on the first attempt
      // instead of running through the retry plugin's GET-only backoff,
      // which is not what this test is checking.
      await provider.restRequest('DELETE', '/repos/acme/repo/git/refs/heads/x');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).response).toBeUndefined();
    expect((caught as RequestError).status).toBe(500);
  });

  test('validateToken keeps its original failure wording, including statusText', async () => {
    // The message shape here predates `ghError` and the live harness
    // pattern-matches on it: `${op} failed: ${status} ${statusText}`, no
    // body. A prior pass through this migration accidentally rerouted it
    // through `ghError`'s default (plain) style, which reads
    // `validateToken failed: 401 <body>` -- same information, different
    // wording -- so this pins the exact string rather than just a substring.
    stubFetch(() => jsonResponse({ message: 'Bad credentials' }, 401));

    const provider = new GitHubProvider('https://github.com', 'bad-tok');

    await expect(provider.validateToken()).rejects.toThrow(
      /^GitHub token validation failed: 401 Unauthorized$/
    );
  });

  test('a transport-level validateToken failure propagates the original error, not a translated one', async () => {
    // Mirrors the transport-level restRequest case above: no `.response`
    // means this never reached an HTTP outcome, so it must come out as the
    // original `RequestError` (with `.status`/`.request` intact), not a
    // plain `Error` laundered through a message-building helper. Unlike that
    // restRequest case, `validateToken` always issues a GET, which the retry
    // plugin's default 3-retry, quadratic backoff (see
    // `@octokit/plugin-retry`'s `error-request.js`) does not skip -- only
    // non-idempotent verbs get `retries: 0` from the `before` hook in
    // `githubClient.ts`, and `validateToken` cannot pass request options to
    // opt out the way a DELETE-based test can. What this test verifies is the
    // untouched-error propagation, not the backoff timing, so the backoff
    // itself is collapsed via `withInstantTimers` rather than paid for.
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    }) as typeof fetch;

    const provider = new GitHubProvider('https://github.com', 'tok');

    let caught: unknown;
    await withInstantTimers(async () => {
      try {
        await provider.validateToken();
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).response).toBeUndefined();
  });

  test('search queries encode colons in the qualifiers, not raw', async () => {
    // searchPRs's only defense against Octokit's `:word` -> `{word}`
    // placeholder rewrite is `encodeURIComponent(qualifiers)` before the
    // query is spliced into the route string. `gh-fetch-prs.test.ts`'s
    // `searchQueries()` helper decodes the recorded path before asserting on
    // it, so removing that `encodeURIComponent` call would leave every
    // unit-test assertion green while every real search went out with a
    // `:` Octokit's parser rewrites into an empty placeholder -- the exact
    // shape of bug Task 2 fixed at the `head=owner:branch` call site,
    // recurring here undefended. Only a test against the real transport
    // (this file stubs `fetch`, not `octokit.request`) can catch it.
    //
    // `fetchPullRequests()` issues three involvement searches, and the
    // throttling plugin's `search` Bottleneck group enforces a real
    // `minTime` between them (see `@octokit/plugin-throttling`'s
    // `index.js`) to respect GitHub's search rate limit -- a real delay this
    // test has no interest in paying for, since it is checking the query
    // string, not the pacing between requests.
    const urls = stubFetch(() => jsonResponse({ items: [] }));

    const provider = new GitHubProvider('https://github.com', 'tok');
    await withInstantTimers(() => provider.fetchPullRequests());

    const searchCall = urls.find(u => u.includes('/search/issues'));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain('is%3Apr');
    expect(searchCall).toContain('author%3A%40me');
  });

  test('createPullRequest names the sub-operation and the created PR number when reviewers 422s', async () => {
    // The create POST succeeds (the PR exists on GitHub by this point), then
    // the reviewers sub-request 422s -- a live case (requesting yourself, or
    // a non-collaborator). Before this fix, the thrown message was
    // `createPullRequest failed: 422 ...`, indistinguishable from "no PR was
    // created," which would send a caller who retries straight into GitHub's
    // own "a pull request already exists" 422. The op label now names the
    // sub-operation and the PR number so a caller can find #7 instead.
    //
    // Both requests here land in Octokit's real "write" throttle group
    // (`@octokit/plugin-throttling`'s `groups.write`, `minTime: 1000`), a
    // real, non-retry pacing delay between writes that only exists because
    // this file drives the real transport. `withInstantTimers` collapses it;
    // the assertion is about the thrown message, not the pacing.
    stubFetch(url => {
      if (url.endsWith('/pulls')) {
        return jsonResponse({ number: 7, node_id: 'PR_7' }, 201);
      }
      if (url.includes('/requested_reviewers')) {
        return jsonResponse({ message: 'Review cannot be requested from pull request author' }, 422);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const provider = new GitHubProvider('https://github.com', 'tok');

    await withInstantTimers(() =>
      expect(
        provider.createPullRequest({
          projectPath: 'acme/repo',
          title: 'My feature',
          sourceBranch: 'feat',
          targetBranch: 'main',
          reviewers: ['octocat']
        })
      ).rejects.toThrow(/^createPullRequest reviewers for #7 failed: 422 /)
    );
  });

  test('updatePullRequest names the sub-operation and the PR number when labels 422s', async () => {
    // Mirrors the createPullRequest case above, on the update path: the
    // PATCH has already landed (title/base/state, whichever were sent) by
    // the time the labels sub-request fails, so the thrown message must not
    // read as "nothing happened." Same real write-throttle pacing between
    // the two requests as above, collapsed the same way.
    stubFetch(url => {
      if (/\/pulls\/9$/.test(url)) {
        return jsonResponse({ number: 9, node_id: 'PR_9', draft: false }, 200);
      }
      if (url.includes('/issues/9/labels')) {
        return jsonResponse({ message: 'Label does not exist' }, 422);
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const provider = new GitHubProvider('https://github.com', 'tok');

    await withInstantTimers(() =>
      expect(
        provider.updatePullRequest('acme/repo', 9, { labels: ['no-such-label'] })
      ).rejects.toThrow(/^updatePullRequest labels for #9 failed: 422 /)
    );
  });

  test('a transport-level failure on a PR write sub-request propagates the original RequestError untouched', async () => {
    // Same shape as the restRequest and validateToken transport-failure
    // cases above: no `.response` means this never reached an HTTP outcome,
    // so it must come out as the original `RequestError`, not translated
    // through `ghError` into a plain `Error` that has lost `.status` and
    // `.request`. The create POST succeeds; the assignees sub-request is
    // what drops the connection. The assignees POST is non-idempotent, so
    // the retry hook's `retries: 0` applies and this fails on the first
    // attempt with no real retry wait; `withInstantTimers` is only needed
    // here for the same real write-throttle pacing the two tests above hit
    // between the create POST and the assignees POST.
    let call = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      call++;
      if (url.endsWith('/pulls')) {
        return jsonResponse({ number: 3, node_id: 'PR_3' }, 201);
      }
      if (url.includes('/assignees')) {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }
      throw new Error(`unexpected URL in test (call ${call}): ${url}`);
    }) as typeof fetch;

    const provider = new GitHubProvider('https://github.com', 'tok');

    let caught: unknown;
    await withInstantTimers(async () => {
      try {
        await provider.createPullRequest({
          projectPath: 'acme/repo',
          title: 'My feature',
          sourceBranch: 'feat',
          targetBranch: 'main',
          assignees: ['octocat']
        });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(RequestError);
    expect((caught as RequestError).response).toBeUndefined();
  });

  test('an absolute URL passed to restRequest reaches fetch unmangled', async () => {
    // A blanket colon-escape would rewrite the scheme separator too:
    // `https://...` becomes `https%3A//...`, which still passes Octokit's
    // `/^http/` check (see @octokit/endpoint/dist-src/parse.js) so no
    // baseUrl gets prepended, and fetch then receives a malformed URL. This
    // path is live for restRequest, documented to accept an absolute URL,
    // and for fetchAllPages following a Link header.
    const urls = stubFetch(() => jsonResponse([]));

    const provider = new GitHubProvider('https://github.com', 'tok');
    await provider.restRequest('GET', 'https://api.github.com/repos/acme/repo/pulls?page=2');

    expect(urls).toEqual(['https://api.github.com/repos/acme/repo/pulls?page=2']);
  });
});
