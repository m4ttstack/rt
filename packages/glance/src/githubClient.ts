/**
 * Octokit construction and error translation for GitHubProvider.
 *
 * The provider used a bare fetch before this, which meant no retry, no
 * throttling, pagination that silently truncated on a failed page, and no
 * request instrumentation at all on the GitHub side.
 */
import { createHash } from 'node:crypto';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { RequestError } from '@octokit/request-error';
import { safeEmit, type OnRequestHook } from './instrumentation.ts';
import type { ForgeLogger } from './logger.ts';

const GlanceOctokitBase = Octokit.plugin(paginateRest, retry, throttling);

export type GlanceOctokit = InstanceType<typeof GlanceOctokitBase>;

/**
 * GitHub Enterprise serves REST under /api/v3 but GraphQL under /api/graphql,
 * not beneath the REST root, so the two cannot be derived from one prefix.
 *
 * `graphqlURL` is no longer read anywhere in `src/` -- `GitHubProvider`'s
 * `graphql()` now calls `octokit.graphql`, which derives the same value
 * itself from the REST `apiBase` (see `@octokit/graphql`'s
 * `GHES_V3_SUFFIX_REGEX`). It stays here, and its own test in
 * `github-client.test.ts` stays with it, as a standalone spec of the split
 * this function's docstring describes: it is the value `octokit.graphql`
 * is expected to arrive at independently, and losing this pin would remove
 * the one place that fact is written down and checked.
 */
export function resolveGitHubUrls(baseURL: string): {
  apiBase: string;
  graphqlURL: string;
} {
  if (baseURL === 'https://github.com' || baseURL === 'https://www.github.com') {
    return {
      apiBase: 'https://api.github.com',
      graphqlURL: 'https://api.github.com/graphql'
    };
  }
  return {
    apiBase: `${baseURL}/api/v3`,
    graphqlURL: `${baseURL}/api/graphql`
  };
}

export function createGitHubClient(opts: {
  baseURL: string;
  token: string;
  log: ForgeLogger;
  onRequest?: OnRequestHook;
}): GlanceOctokit {
  const { apiBase } = resolveGitHubUrls(opts.baseURL);

  const octokit = new GlanceOctokitBase({
    auth: opts.token,
    baseUrl: apiBase,
    throttle: {
      // `@octokit/plugin-throttling` keys its rate-limit Bottleneck groups
      // in module-scope singletons (`groups.write`, `groups.global`, ...),
      // defaulting every caller to the same `id: "no-id"` when none is
      // given. Without a per-instance id here, two `GitHubProvider`s for
      // different hosts and tokens would throttle and pace each other
      // process-wide even though they share no actual rate-limit budget.
      // This only decouples that bookkeeping; the pacing rules themselves
      // (minTime, maxConcurrent) are unchanged. The token is hashed rather
      // than embedded raw: Bottleneck's `Group` keeps this id as an
      // enumerable key (`group.limiters()`), and although the plugin never
      // logs it, this repo is public and the package is published, so the
      // key must not carry a live credential even in a form nothing
      // currently prints.
      id: `${apiBase}::${hashToken(opts.token)}`,
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        if (isGraphQLRequest(options)) {
          // `graphql()`'s documented contract (MAT-133, owned by phase 4)
          // is to swallow this outcome and return null immediately, the
          // same way it swallows an HTTP failure or a GraphQL-level error.
          // Retrying would wait out `x-ratelimit-reset` in real time --
          // up to roughly two hours for a primary rate limit, twice, since
          // the retry plugin's cap is 2 -- before returning the exact same
          // null, which helps no caller and only delays it.
          return false;
        }
        // Two attempts absorb a quota window boundary. Retrying indefinitely
        // would turn a quota exhaustion into a hang with no upper bound.
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub secondary rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
        if (isGraphQLRequest(options)) {
          // Same reasoning as `onRateLimit` above: `graphql()` swallows this
          // by design, so waiting out `retry-after` (or the 60s fallback),
          // up to twice, serves nobody.
          return false;
        }
        return retryCount < 2;
      }
    }
  });

  // The retry plugin defaults to retrying 5xx responses for every verb,
  // including POST/PUT/PATCH/DELETE. A write that reaches GitHub and then
  // drops the response on a 502 gets retried, which can create a duplicate
  // PR, a duplicate approval, or a second merge attempt on top of one that
  // already succeeded. A duplicate write is a worse failure mode than a
  // request that surfaces as failed and must be retried by the caller, so
  // only the idempotent verbs (GET, HEAD) keep automatic retry; everything
  // else is forced to retries: 0 here, centrally, so no call site has to
  // remember to opt out.
  octokit.hook.before('request', options => {
    // endpoint.merge does not normalize case, so a caller that passes a
    // lowercase method (e.g. restRequest('get', ...)) would otherwise
    // silently keep retries enabled instead of falling into this guard.
    // Every in-repo call site already uses uppercase; this is defensive
    // for restRequest's external, undocumented-case contract.
    const method = options.method?.toUpperCase();
    if (method && method !== 'GET' && method !== 'HEAD') {
      options.request = { ...options.request, retries: 0 };
    }
  });

  if (opts.onRequest) {
    const started = new WeakMap<object, number>();
    octokit.hook.before('request', options => {
      started.set(options, performance.now());
    });
    octokit.hook.after('request', (response, options) => {
      emit(opts.onRequest!, started, options, response.status);
    });
    octokit.hook.error('request', (error, options) => {
      emit(
        opts.onRequest!,
        started,
        options,
        error instanceof RequestError ? error.status : 0
      );
      throw error;
    });
  }

  return octokit;
}

/**
 * A GraphQL request's URL is either the relative `/graphql` (github.com) or
 * the rewritten absolute `.../api/graphql` (GHES) -- see
 * `resolveGitHubUrls`'s docstring and `@octokit/graphql`'s
 * `GHES_V3_SUFFIX_REGEX`. This has to match the *pathname* exactly, not just
 * check whether the URL contains the substring "/graphql": at this hook,
 * `options.url` is already interpolated with real path segments, not a
 * route template, so a REST request can legitimately contain that substring
 * -- `GET /repos/graphql/graphql-js/pulls` (a real GitHub org and repo), any
 * repository or branch literally named "graphql" (e.g.
 * `/git/refs/heads/graphql`), or any caller-supplied `restRequest` path.
 * A substring match on those would wrongly skip the REST rate-limit retry
 * this phase adopted Octokit for, and wrongly label them `transport:
 * 'graphql'`. Matching the exact pathname is the same check the throttling
 * plugin itself uses (`pathname.startsWith('/graphql')` in
 * `wrap-request.js`), just also covering the GHES `/api/graphql` form.
 */
function isGraphQLRequest(options: { url?: string }): boolean {
  const { pathname } = new URL(options.url ?? '', 'http://placeholder.invalid');
  return pathname === '/graphql' || pathname.endsWith('/api/graphql');
}

/**
 * A non-secret discriminator for the throttle group key -- see the
 * `throttle.id` comment above. Any stable hash works here; a short prefix of
 * a fast, non-cryptographic-strength digest is enough, since this only needs
 * to distinguish tokens from each other, not resist attack.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function emit(
  hook: OnRequestHook,
  started: WeakMap<object, number>,
  options: { method?: string; url?: string },
  status: number
): void {
  const at = started.get(options as object);
  safeEmit(hook, {
    op: `gh.${options.method ?? 'GET'} ${options.url ?? ''}`.trim(),
    transport: isGraphQLRequest(options) ? 'graphql' : 'rest',
    method: options.method ?? 'GET',
    path: options.url ?? '',
    durationMs: at === undefined ? 0 : performance.now() - at,
    status
  });
}

/**
 * Translate a thrown Octokit error into the message shape callers already
 * match on.
 *
 * The live conformance harness pattern-matches three of these to distinguish a
 * transient failure from a permanent one, so a reworded message disables a
 * check silently instead of failing it. `style` picks between the two formats
 * the hand-rolled code used: most methods emitted status plus body, five
 * emitted status, statusText, and body.
 */
export function ghError(
  op: string,
  err: unknown,
  style: 'plain' | 'statusText' = 'plain'
): Error {
  if (!(err instanceof RequestError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const body = bodyText(err);
  if (style === 'statusText') {
    // The dash here is GitHub-facing text this SDK has always emitted in these
    // five messages, and the harness matches on the prefix before it.
    return new Error(
      `${op} failed: ${err.status} ${statusText(err)}${body ? ` — ${body}` : ''}`
    );
  }
  return new Error(`${op} failed: ${err.status} ${body}`);
}

/**
 * Exported so `deleteMergedSourceBranch` in GitHubProvider.ts can build its
 * "merged but could not delete source branch" message with the same body
 * text `ghError` would use, without going through `ghError` itself: that
 * message's prefix is not `${op} failed:`, so `ghError`'s shape does not fit.
 */
export function bodyText(err: RequestError): string {
  const data = err.response?.data;
  if (data === undefined || data === null) {
    // A network-level failure (DNS, connection refused, and so on) has no
    // response at all, so the only surviving diagnostic is the message
    // Octokit itself threw with. Losing it here would make this branch
    // strictly worse than the non-RequestError branch above, which keeps it.
    return err.response === undefined ? err.message : '';
  }
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Reason phrases for the statuses this SDK actually surfaces.
 *
 * Octokit's fetch wrapper reads `fetchResponse.statusText` only to build its
 * thrown error and never copies it onto `response.headers`, so there is no
 * "404 Not Found" style header to recover it from at this point, unlike the
 * hand-rolled fetch code this replaces. These five messages are quoted
 * verbatim in two specs documents, so the text is reconstructed from the
 * status code instead of read off a header that no longer exists.
 */
const REASON_PHRASES: Record<number, string> = {
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable'
};

function statusText(err: RequestError): string {
  return reasonPhrase(err.status);
}

/**
 * Exported so `api()` in GitHubProvider.ts can populate `Response.statusText`
 * without duplicating this map. `new Response(body, { status })` leaves
 * `statusText` empty, and the messages this SDK emits read
 * `${res.status} ${res.statusText}`, so an empty statusText renders a double
 * space and drops the reason phrase.
 */
export function reasonPhrase(status: number): string {
  // An unmapped status degrades to the current (empty) behavior rather than
  // inventing text for a status this SDK has not been observed to surface.
  return REASON_PHRASES[status] ?? '';
}
