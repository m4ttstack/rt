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

  test(
    'a transport-level validateToken failure propagates the original error, not a translated one',
    async () => {
      // Mirrors the transport-level restRequest case above: no `.response`
      // means this never reached an HTTP outcome, so it must come out as the
      // original `RequestError` (with `.status`/`.request` intact), not a
      // plain `Error` laundered through a message-building helper. Unlike
      // that restRequest case, `validateToken` always issues a GET, which
      // the retry plugin's default 3-retry, quadratic-backoff schedule (see
      // `@octokit/plugin-retry`'s `error-request.js`) does not skip -- only
      // non-idempotent verbs get `retries: 0` from the `before` hook in
      // `githubClient.ts`. The exhausted-retries wait is real, not a stall,
      // hence the longer test timeout below.
      globalThis.fetch = (async () => {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }) as typeof fetch;

      const provider = new GitHubProvider('https://github.com', 'tok');

      let caught: unknown;
      try {
        await provider.validateToken();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RequestError);
      expect((caught as RequestError).response).toBeUndefined();
    },
    20000
  );

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
    const urls = stubFetch(() => jsonResponse({ items: [] }));

    const provider = new GitHubProvider('https://github.com', 'tok');
    await provider.fetchPullRequests();

    const searchCall = urls.find(u => u.includes('/search/issues'));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain('is%3Apr');
    expect(searchCall).toContain('author%3A%40me');
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
