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
    // path is live because `restRequest` is documented to accept an
    // absolute URL.
    const urls = stubFetch(() => jsonResponse([]));

    const provider = new GitHubProvider('https://github.com', 'tok');
    await provider.restRequest('GET', 'https://api.github.com/repos/acme/repo/pulls?page=2');

    expect(urls).toEqual(['https://api.github.com/repos/acme/repo/pulls?page=2']);
  });
});

/**
 * Real `octokit.paginate` following a real `Link: rel="next"` header, unlike
 * every other GitHub reviews test in this suite: those stub `octokit.request`
 * (or `octokit.paginate` wholesale), so none of them exercise multi-page
 * aggregation, and none of them would notice if `fetchReviews` regressed to a
 * pre-interpolated path or dropped `per_page` -- both would leave every
 * path-stubbed unit test green while silently breaking pagination against
 * real GitHub. Only driving `fetch` itself, as this file does, can catch that.
 */
describe('GitHubProvider transport: reviews pagination (real octokit.paginate)', () => {
  const PULL_URL = 'https://api.github.com/repos/acme/repo/pulls/5';
  const REVIEWS_PAGE1_URL = `${PULL_URL}/reviews?per_page=100`;
  const REVIEWS_PAGE2_URL = `${REVIEWS_PAGE1_URL}&page=2`;

  /** Minimal PR fixture: only the fields `withRoles` and `toPullRequest` read. */
  function reviewsPR() {
    return {
      id: 50,
      node_id: 'PR_node_5',
      number: 5,
      title: 'PR 5',
      body: null,
      state: 'open',
      draft: false,
      merged_at: null,
      html_url: 'https://github.com/acme/repo/pull/5',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-10T00:00:00Z',
      head: { sha: 'sha5', ref: 'feature/5' },
      base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
      user: { id: 999, login: 'octocat', avatar_url: null },
      assignees: [],
      requested_reviewers: [],
      labels: []
    };
  }

  function review(id: number, login: string, submittedAt: string) {
    return {
      id,
      user: { id, login, avatar_url: null },
      state: 'APPROVED',
      submitted_at: submittedAt
    };
  }

  /**
   * Answers `/user`, the GraphQL thread-count batch, and the single PR
   * detail GET identically for both tests below, and delegates anything
   * to do with the reviews pages to `onReviews`, so each test only has to
   * describe the one thing it's varying.
   */
  function stubAroundReviews(
    onReviews: (url: string) => Response | undefined
  ): string[] {
    return stubFetch(url => {
      if (url === 'https://api.github.com/user') {
        return jsonResponse({ id: 1, login: 'me', avatar_url: null });
      }
      if (url === 'https://api.github.com/graphql') {
        return jsonResponse({ data: { nodes: [] } });
      }
      if (url === PULL_URL) {
        return jsonResponse(reviewsPR());
      }
      const answer = onReviews(url);
      if (answer) return answer;
      throw new Error(`unexpected URL in test: ${url}`);
    });
  }

  test('two review pages aggregate to both reviewers, not just page one', async () => {
    // The parity this migration must not break: page one (bob) and page two
    // (carol) both succeed, so `approvedBy` must carry both. Asserting the
    // exact URLs fetch received also pins the route template and
    // `per_page=100` -- either regressing would leave this failing even
    // though it would look identical to every path-stubbed unit test.
    const urls = stubAroundReviews(url => {
      if (url === REVIEWS_PAGE1_URL) {
        return new Response(
          JSON.stringify([review(1, 'bob', '2026-07-01T00:00:00Z')]),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              Link: `<${REVIEWS_PAGE2_URL}>; rel="next"`
            }
          }
        );
      }
      if (url === REVIEWS_PAGE2_URL) {
        return jsonResponse([review(2, 'carol', '2026-07-02T00:00:00Z')]);
      }
      return undefined;
    });

    const provider = new GitHubProvider('https://github.com', 'tok');
    // A GraphQL request is a POST, so `@octokit/plugin-throttling`'s
    // `isWrite` (`options.method !== "GET" && !== "HEAD"`) is already true
    // for it and routes it into the SAME process-wide "write" Bottleneck
    // group (`minTime: 1000`, keyed by the shared default id "no-id") that
    // the write tests above already exercise -- see
    // `@octokit/plugin-throttling/dist-src/wrap-request.js`. (The plugin
    // also has a separate `isGraphQL` flag there, but that only gates a
    // GraphQL-specific rate-limit check later in the same function; it is
    // not what puts GraphQL in the write group -- `isWrite` alone already
    // does. Proof: a GHES host posts to `/api/graphql`, which the plugin's
    // `isGraphQL` check, `pathname.startsWith('/graphql')`, does not match,
    // yet GHES shows this same 1s pacing.) Task 8 moved `graphql()` onto
    // `octokit.graphql`, so this test's single GraphQL call (for thread
    // counts) now queues behind that shared group too. The group's internal
    // "next allowed dispatch" clock already ran ahead of real time from the
    // earlier `withInstantTimers`-collapsed write tests, so without
    // collapsing timers here too, this test pays that backlog back in real
    // wall-clock time and blows past the default 5s timeout.
    const prs = await withInstantTimers(() =>
      provider.fetchPullRequests({
        iids: [5],
        projectPath: 'acme/repo',
        listWeight: true
      })
    );

    expect(prs[0]?.approvedBy.map(u => u.username).sort()).toEqual([
      'bob',
      'carol'
    ]);
    expect(urls).toContain(REVIEWS_PAGE1_URL);
    expect(urls).toContain(REVIEWS_PAGE2_URL);
  });

  test('a failed second reviews page fails the fetch, not a truncated approval count', async () => {
    // This is the actual defect scenario, constructed for real rather than
    // by stubbing `octokit.paginate` to reject outright: page one succeeds
    // with bob's approval and a genuine `rel="next"` Link header, then page
    // two fails. The old `fetchAllPages` did `if (!res.ok) break` here and
    // returned page one alone -- a PR reading "approved by bob" with
    // carol's approval on page two silently dropped and no error raised
    // anywhere. Driving the real `paginate` plugin through a stubbed
    // `fetch` (never a stubbed `paginate`) proves the Link-following itself
    // surfaces the failure, not merely that some rejection propagates.
    stubAroundReviews(url => {
      if (url === REVIEWS_PAGE1_URL) {
        return new Response(
          JSON.stringify([review(1, 'bob', '2026-07-01T00:00:00Z')]),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              Link: `<${REVIEWS_PAGE2_URL}>; rel="next"`
            }
          }
        );
      }
      if (url === REVIEWS_PAGE2_URL) {
        // A plain 403 with no rate-limit-shaped message or headers: this is
        // in the retry plugin's `doNotRetry` list and matches neither of the
        // throttling plugin's retry triggers, so the failure surfaces on
        // the first attempt with no real backoff to collapse.
        return jsonResponse({ message: 'page two unavailable' }, 403);
      }
      return undefined;
    });

    const provider = new GitHubProvider('https://github.com', 'tok');

    // Same shared write-group backlog as the test above applies to this
    // test's own GraphQL thread-count call.
    await withInstantTimers(() =>
      expect(
        provider.fetchPullRequests({
          iids: [5],
          projectPath: 'acme/repo',
          listWeight: true
        })
      ).rejects.toThrow()
    );
  });
});

describe('GitHubProvider transport: graphql() endpoint resolution (real octokit.graphql)', () => {
  /**
   * Task 8 moved `graphql()` onto `octokit.graphql`, which derives its own
   * endpoint from the client's REST `baseUrl` rather than reading the
   * `graphqlURL` this provider used to fetch directly. `@octokit/graphql`
   * detects a `/api/v3` suffix (GHES) and rewrites it to `/api/graphql`
   * itself (see `GHES_V3_SUFFIX_REGEX` in
   * `@octokit/graphql/dist-src/graphql.js`); for github.com's
   * `https://api.github.com` base, which has no such suffix, it appends the
   * default `/graphql`. Both must be proven by URL, not inferred, since no
   * other fixture in this suite exercises a GHES host at all.
   */
  test('github.com sends the GraphQL request to https://api.github.com/graphql', async () => {
    const urls = stubFetch(() => jsonResponse({ data: { ok: true } }));

    const provider = new GitHubProvider('https://github.com', 'tok');
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toEqual(['https://api.github.com/graphql']);
    expect(data).toEqual({ ok: true });
  });

  test('a GitHub Enterprise host sends the GraphQL request under /api/graphql, not /api/v3', async () => {
    const urls = stubFetch(() => jsonResponse({ data: { ok: true } }));

    const provider = new GitHubProvider('https://ghe.corp.example', 'tok');
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toEqual(['https://ghe.corp.example/api/graphql']);
    expect(data).toEqual({ ok: true });
  });
});

describe('GitHubProvider transport: graphql() swallows failures (MAT-133, phase 4)', () => {
  /**
   * MAT-133 is explicitly out of scope for this transport swap: `graphql()`
   * has always swallowed transport, HTTP, and GraphQL-level errors alike,
   * warning and returning null instead of throwing. Under the old bare
   * `fetch` call these three outcomes were read off a parsed payload; under
   * `octokit.graphql` they arrive as three different thrown shapes
   * (`GraphqlResponseError`, `RequestError` with a `.response`, and anything
   * else), so the catch block has to re-derive the same three log.warn calls
   * explicitly. These tests pin that nothing here started throwing, and that
   * the warn message strings and payload shapes are unchanged.
   */
  function makeLogSpy() {
    const warnings: Array<{ message: string; payload: unknown }> = [];
    return {
      warnings,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (message: string, payload?: unknown) =>
          warnings.push({ message, payload }),
        error: () => {}
      }
    };
  }

  test('an HTTP failure warns "GitHub GraphQL request failed" with the status and returns null', async () => {
    stubFetch(() => jsonResponse({ message: 'Bad credentials' }, 401));
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(data).toBeNull();
    expect(warnings).toEqual([
      { message: 'GitHub GraphQL request failed', payload: { status: 401 } }
    ]);
  });

  test('a 200 response carrying GraphQL errors warns "GitHub GraphQL returned errors" with the messages and returns null', async () => {
    stubFetch(() =>
      jsonResponse({
        data: null,
        errors: [{ message: 'Field "x" does not exist' }]
      })
    );
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { x }', {})
    );

    expect(data).toBeNull();
    expect(warnings).toEqual([
      {
        message: 'GitHub GraphQL returned errors',
        payload: { messages: ['Field "x" does not exist'] }
      }
    ]);
  });

  test('a transport-level failure warns "GitHub GraphQL request threw" with the message and returns null', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    }) as typeof fetch;
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(data).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe('GitHub GraphQL request threw');
    // Octokit's fetch wrapper turns the thrown TypeError into a
    // `RequestError` whose `.message` is built from `cause.message`
    // ("ECONNREFUSED") rather than the original "fetch failed" -- a detail
    // of how `@octokit/request` reports network failures, unrelated to this
    // catch block, which still just forwards whatever `err.message` is.
    expect((warnings[0]?.payload as { message: string }).message).toContain(
      'ECONNREFUSED'
    );
  });

  test('a 200 reporting a RATE_LIMITED GraphQL error swallows after exactly one fetch, not a real wait for x-ratelimit-reset', async () => {
    // `@octokit/plugin-throttling` treats a GraphQL response whose `errors`
    // array contains a `RATE_LIMITED` entry as a retryable rate limit (see
    // `wrap-request.js`), which would otherwise retry through
    // `createGitHubClient`'s REST retry budget (2 attempts) before this
    // catch ever ran -- waiting out `x-ratelimit-reset` in real time each
    // time. Before this fix that measured as 3 fetches and a real wait
    // (collapsed here only by `withInstantTimers`); `createGitHubClient`'s
    // `onRateLimit` now declines to retry a GraphQL request, so this must
    // still resolve after exactly one fetch, with the exact same warn the
    // old bare-fetch code emitted for any GraphQL-level error.
    const resetInTwoHours = Math.floor(Date.now() / 1000) + 7200;
    const urls = stubFetch(() =>
      new Response(
        JSON.stringify({
          data: null,
          errors: [
            { type: 'RATE_LIMITED', message: 'API rate limit exceeded for installation.' }
          ]
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetInTwoHours)
          }
        }
      )
    );
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toHaveLength(1);
    expect(data).toBeNull();
    // `createGitHubClient`'s own "GitHub rate limit hit" log (pre-existing
    // REST instrumentation) also fires once; the assertion here is on
    // `graphql()`'s own MAT-133 warn, which must match the pre-Task-8 shape.
    expect(warnings).toContainEqual({
      message: 'GitHub GraphQL returned errors',
      payload: { messages: ['API rate limit exceeded for installation.'] }
    });
  });

  test('a 403 secondary rate limit swallows after exactly one fetch, not a real 30-120s wait', async () => {
    // Same shape as the RATE_LIMITED case above but on the HTTP-failure
    // path: before this fix this measured as 3 fetches and a real wait of
    // up to `retry-after` (or the 60s fallback) twice.
    // `onSecondaryRateLimit` now declines for a GraphQL request too.
    const urls = stubFetch(() =>
      new Response(
        JSON.stringify({
          message: 'You have exceeded a secondary rate limit. Please wait a few minutes.'
        }),
        {
          status: 403,
          headers: { 'content-type': 'application/json', 'retry-after': '30' }
        }
      )
    );
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toHaveLength(1);
    expect(data).toBeNull();
    expect(warnings).toContainEqual({
      message: 'GitHub GraphQL request failed',
      payload: { status: 403 }
    });
  });

  test('an empty errors array is read as success, not a GraphQL error, matching the old payload.errors?.length check', async () => {
    // `@octokit/graphql` throws `GraphqlResponseError` whenever the response
    // body has an `errors` key at all (`if (response.data.errors)`, true
    // even for `[]`), but the old bare-fetch code tested
    // `payload.errors?.length`, so an empty array read as success.
    stubFetch(() => jsonResponse({ data: { ok: true }, errors: [] }));
    const { warnings, logger } = makeLogSpy();

    const provider = new GitHubProvider('https://github.com', 'tok', { logger });
    // A GraphQL POST is a write for throttling purposes, so this shares the
    // same real-time backlog every other `graphql()` test in this suite
    // hits -- see the "two review pages aggregate" test's comment above.
    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { x }', {})
    );

    expect(data).toEqual({ ok: true });
    expect(warnings).toEqual([]);
  });

  test('a 200 with no data key returns null, not undefined, matching the declared Promise<T | null>', async () => {
    stubFetch(() => jsonResponse({}));
    const provider = new GitHubProvider('https://github.com', 'tok');

    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { x }', {})
    );

    expect(data).toBeNull();
  });
});

describe('GitHubProvider transport: GraphQL detection matches pathname, not substring', () => {
  /**
   * The interpolated request URL a rate-limit hook sees is not a route
   * template -- `GET /repos/{owner}/{repo}/pulls` has already become
   * `/repos/graphql/graphql-js/pulls` by the time `isGraphQLRequest` runs.
   * A plain `.includes('/graphql')` check would misread any REST path
   * containing that substring as GraphQL: the real `graphql` GitHub org and
   * its `graphql-js` repo, any repository or branch literally named
   * "graphql", or a caller-supplied `restRequest` path. These tests pin
   * both directions: REST paths that merely contain "graphql" must still
   * get the REST rate-limit retry Octokit was adopted for, and both real
   * GraphQL endpoints (github.com and GHES) must still be recognized so
   * `graphql()`'s MAT-133 swallow still fires promptly for them.
   */
  function rateLimited403(): Response {
    return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60)
      }
    });
  }

  test('a REST path containing "graphql" as a path segment still gets the REST rate-limit retry (3 fetches)', async () => {
    // The real GitHub org + repo this collision is not theoretical for.
    const urls = stubFetch(() => rateLimited403());
    const provider = new GitHubProvider('https://github.com', 'tok');

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/graphql/graphql-js/pulls')
    );

    // retryCount < 2 means two retries beyond the first attempt.
    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('a branch literally named "graphql" still gets the REST rate-limit retry (3 fetches)', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = new GitHubProvider('https://github.com', 'tok');

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/acme/repo/git/refs/heads/graphql')
    );

    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('an ordinary REST path retries identically (3 fetches), as the control for the two tests above', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = new GitHubProvider('https://github.com', 'tok');

    const res = await withInstantTimers(() =>
      provider.restRequest('GET', '/repos/acme/repo/pulls')
    );

    expect(urls).toHaveLength(3);
    expect(res.status).toBe(403);
  });

  test('the real GraphQL endpoint on github.com still swallows immediately under a rate limit (1 fetch)', async () => {
    const urls = stubFetch(() => rateLimited403());
    const provider = new GitHubProvider('https://github.com', 'tok');

    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toHaveLength(1);
    expect(data).toBeNull();
  });

  test('the real GraphQL endpoint on a GHES host still swallows immediately under a rate limit (1 fetch)', async () => {
    // GHES's rewritten GraphQL URL is absolute (`.../api/graphql`), unlike
    // github.com's relative `/graphql` -- both forms must resolve to the
    // same pathname check.
    const urls = stubFetch(() => rateLimited403());
    const provider = new GitHubProvider('https://ghe.corp.example', 'tok');

    const data = await withInstantTimers(() =>
      (provider as any).graphql('query { viewer { login } }', {})
    );

    expect(urls).toHaveLength(1);
    expect(data).toBeNull();
  });
});
