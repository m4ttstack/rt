/**
 * Octokit construction and error translation for GitHubProvider.
 *
 * The provider used a bare fetch before this, which meant no retry, no
 * throttling, pagination that silently truncated on a failed page, and no
 * request instrumentation at all on the GitHub side.
 */
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
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        opts.log.warn('GitHub rate limit hit', {
          method: options.method,
          url: options.url,
          retryAfter,
          retryCount
        });
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

function emit(
  hook: OnRequestHook,
  started: WeakMap<object, number>,
  options: { method?: string; url?: string },
  status: number
): void {
  const at = started.get(options as object);
  safeEmit(hook, {
    op: `gh.${options.method ?? 'GET'} ${options.url ?? ''}`.trim(),
    transport: 'rest',
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

function bodyText(err: RequestError): string {
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
